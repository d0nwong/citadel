#!/usr/bin/env bash
# The sweep, in the stack: clone the data repo, then (every tick) every repo projects.json
# names — cloning one that's missing, fetching the ones argus pull doesn't fetch itself — then
# run argus's /sweep every SWEEP_INTERVAL seconds, never two at once, and push the data repo
# after each tick (`argus commit` never pushes).
#
#   loop.sh loop              the service: forever
#   loop.sh once              one tick, the way the loop runs it (just sweep-once)
#   loop.sh once --dry-run    set up, take the lock, run `argus pull --dry-run`; changes nothing
set -euo pipefail

DATA="${ARGUS_ROOT:-/argus-data}"
# What Pensieve's top bar reads: whether a tick is running, when the last one ended and when the
# next is due, and the running (or last) tick's output. Beside the lock, so git never sees them.
STATUS="$DATA/.git/sweep-status.json"
LOG="$DATA/.git/sweep.log"
say() { printf '%s sweep: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# Git asks each helper only about its own host and stores nothing. Bitbucket's read-only token
# comes from the environment; GitHub's push token from a secret file, and only if there is one.
git config --global credential.https://bitbucket.org.helper \
  '!f() { echo "username=${BITBUCKET_GIT_USERNAME:-x-bitbucket-api-token-auth}"; echo "password=${BITBUCKET_TOKEN:-}"; }; f'
git config --global credential.https://github.com.helper \
  '!f() { [ -s /run/secrets/gh_token ] || exit 0; echo username=x-access-token; echo "password=$(cat /run/secrets/gh_token)"; }; f'
# No global git identity: `argus commit` sets it per commit (SWEEP_GIT_NAME/SWEEP_GIT_EMAIL,
# defaulted in commit.ts), so nothing else in this container commits as the sweep by accident.

# argus's deploy check reads Bitbucket's pipelines with bb's config file; write one from the pair.
if [ -n "${BITBUCKET_USERNAME:-}" ] && [ -n "${BITBUCKET_TOKEN:-}" ]; then
  export BITBUCKET_CONFIG="$HOME/.bitbucket-rest-cli-config.json"
  (umask 077; printf '{"auth":{"username":"%s","appPassword":"%s"}}\n' "$BITBUCKET_USERNAME" "$BITBUCKET_TOKEN" > "$BITBUCKET_CONFIG")
fi

# Merge key=value pairs into the status file: `now` is the current time, `nextIn=<s>` sets
# nextRunAt that far ahead, and a value that parses as JSON (true, 0) is stored as such.
status() {
  bun -e '
    const [path, ...pairs] = process.argv.slice(1);
    const file = Bun.file(path);
    const s = (await file.exists()) ? await file.json().catch(() => ({})) : {};
    const now = new Date();
    for (const pair of pairs) {
      const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
      if (k === "nextIn") s.nextRunAt = new Date(now.getTime() + Number(v) * 1000).toISOString();
      else if (v === "now") s[k] = now.toISOString();
      else { try { s[k] = JSON.parse(v); } catch { s[k] = v; } }
    }
    await Bun.write(path, JSON.stringify(s, null, 2) + "\n");
  ' "$STATUS" "$@" || say "could not write $STATUS"
}

clone() { # url dir
  [ -d "$2/.git" ] && return 0
  if [ -n "$(ls -A "$2" 2>/dev/null)" ]; then say "$2 is not empty and not a git checkout; leaving it"; return 1; fi
  say "cloning $1 into $2"
  git clone --quiet --filter=blob:none "$1" "$2"
}

# The data repo alone: projects.json (CTD-265) lives at its root, so it has to exist before
# anything else can be discovered, let alone cloned or fetched.
setup() {
  clone "${ARGUS_DATA_REPO:-https://github.com/d0nwong/citadel-data.git}" "$DATA"
}

# Every repo projects.json names (CTD-269): clone one that's missing, and fetch every one a
# record-job project's own `argus pull` doesn't already fetch itself (pull.ts's
# defaultSources, via pr-facts.ts's repoFor). Read straight from the loader argus/projects.ts
# already exports, the way status() above already shells out to bun for JSON work, rather than
# a script of its own. Runs at the start of every tick, so a repo or project added to
# projects.json is picked up by the next one, with no code, image or compose change.
#
# A repo whose clone or fetch fails here is recorded by id to sweep-tick-unreachable.json,
# fresh every tick (CTD-272): the docs step reads it and skips that repo's areas this tick,
# rather than refreshing docs against a stale or missing checkout. `argus pull` (inside the
# tick proper) adds its own runtime failures to the same file, for the repos left to it.
sync_repos() {
  local unreachable=()
  while IFS=$'\t' read -r id url path pulled; do
    [ -z "$url" ] && continue
    if [ -z "$path" ]; then say "no local path configured for $url; skipping"; continue; fi
    path="${path/#\~/$HOME}"
    if ! clone "$url" "$path"; then unreachable+=("$id"); continue; fi
    [ "$pulled" = "1" ] && continue
    if ! git -C "$path" fetch --quiet origin; then say "fetch failed for $path; the next tick retries"; unreachable+=("$id"); fi
  done < <(bun -e '
    const { loadProjects } = await import("./scripts/argus/projects.ts");
    const config = await loadProjects();
    for (const p of config.projects) for (const r of p.repos)
      console.log([r.id, r.cloneUrl, r.path, p.jobs.includes("record") ? "1" : "0"].join("\t"));
  ' || true)
  bun -e '
    await Bun.write(process.argv[1], JSON.stringify(process.argv.slice(2)) + "\n");
  ' "$DATA/.git/sweep-tick-unreachable.json" "${unreachable[@]+"${unreachable[@]}"}"
}

tick() {
  # Marks this run as a tick: `claude`'s own shell calls inherit it, so `argus commit` run from
  # inside the /sweep skill authors its commit "argus sweep" and advances the Slack cursor.
  export ARGUS_SWEEP_TICK=1
  sync_repos
  if [ "${1:-}" = "--dry-run" ]; then
    bun scripts/argus.ts pull --dry-run
    return
  fi
  # stream-json prints each event as it happens, so `just logs sweep` shows a tick live rather
  # than only its final answer.
  claude -p "/sweep" --model "${SWEEP_MODEL:-claude-sonnet-5}" --dangerously-skip-permissions \
    --output-format stream-json --verbose
  if [ -s /run/secrets/gh_token ]; then
    git -C "$DATA" push --quiet origin HEAD || say "push failed; the next tick retries"
  fi
}

# One tick under the lock. The lock lives in the data repo's .git, so every container on this
# data shares it and git status never shows it; the subshell releases it when the tick ends.
locked() {
  ( flock -n 9 || { say "another sweep holds the lock; skipping"; exit 3; }
    status running=true startedAt=now
    set +e
    tick "$@" 2>&1 | tee "$LOG"
    code=$?
    set -e
    status running=false lastRunAt=now lastExit="$code"
    exit "$code"
  ) 9>"$DATA/.git/sweep.lock"
}

setup
# A container that died mid-tick left running=true; nothing holds the lock now, so it is stale.
( flock -n 9 && status running=false ) 9>"$DATA/.git/sweep.lock"
case "${1:-loop}" in
  once) shift; locked "$@" ;;
  loop) while true; do locked || true; status nextIn="${SWEEP_INTERVAL:-900}"; sleep "${SWEEP_INTERVAL:-900}"; done ;;
  *) say "usage: loop.sh loop | once [--dry-run]"; exit 2 ;;
esac
