#!/usr/bin/env bash
# The sweep, in the stack: clone the data repo and the product checkouts when they are missing,
# then run argus's /sweep every SWEEP_INTERVAL seconds, never two at once, and push the data repo
# after each tick (`argus commit` never pushes).
#
#   loop.sh loop              the service: forever
#   loop.sh once              one tick, the way the loop runs it (just sweep-once)
#   loop.sh once --dry-run    set up, take the lock, run `argus pull --dry-run`; changes nothing
set -euo pipefail

DATA="${ARGUS_ROOT:-/argus-data}"
say() { printf '%s sweep: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# Git asks each helper only about its own host and stores nothing. Bitbucket's read-only token
# comes from the environment; GitHub's push token from a secret file, and only if there is one.
git config --global credential.https://bitbucket.org.helper \
  '!f() { echo "username=${BITBUCKET_GIT_USERNAME:-x-bitbucket-api-token-auth}"; echo "password=${BITBUCKET_TOKEN:-}"; }; f'
git config --global credential.https://github.com.helper \
  '!f() { [ -s /run/secrets/gh_token ] || exit 0; echo username=x-access-token; echo "password=$(cat /run/secrets/gh_token)"; }; f'
git config --global user.name "${SWEEP_GIT_NAME:-argus sweep}"
git config --global user.email "${SWEEP_GIT_EMAIL:-sweep@citadel.local}"

# argus's deploy check reads Bitbucket's pipelines with bb's config file; write one from the pair.
if [ -n "${BITBUCKET_USERNAME:-}" ] && [ -n "${BITBUCKET_TOKEN:-}" ]; then
  export BITBUCKET_CONFIG="$HOME/.bitbucket-rest-cli-config.json"
  (umask 077; printf '{"auth":{"username":"%s","appPassword":"%s"}}\n' "$BITBUCKET_USERNAME" "$BITBUCKET_TOKEN" > "$BITBUCKET_CONFIG")
fi

clone() { # url dir
  [ -d "$2/.git" ] && return 0
  if [ -n "$(ls -A "$2" 2>/dev/null)" ]; then say "$2 is not empty and not a git checkout; leaving it"; return 1; fi
  say "cloning $1 into $2"
  git clone --quiet --filter=blob:none "$1" "$2"
}

setup() {
  clone "${ARGUS_DATA_REPO:-https://github.com/d0nwong/citadel-data.git}" "$DATA"
  clone "${FE_REPO_URL:-https://bitbucket.org/aldenstudios/alden-portal-fe.git}" "${FE_REPO:-$HOME/git/alden-portal-fe}"
  clone "${BE_REPO_URL:-https://bitbucket.org/aldenstudios/alden-connect-portal-be.git}" "${BE_REPO:-$HOME/git/alden-connect-portal-be}"
}

tick() {
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
  ( flock -n 9 || { say "another sweep holds the lock; skipping"; exit 3; }; tick "$@" ) 9>"$DATA/.git/sweep.lock"
}

setup
case "${1:-loop}" in
  once) shift; locked "$@" ;;
  loop) while true; do locked || true; sleep "${SWEEP_INTERVAL:-900}"; done ;;
  *) say "usage: loop.sh loop | once [--dry-run]"; exit 2 ;;
esac
