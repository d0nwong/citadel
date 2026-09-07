#!/usr/bin/env bash
# bootstrap — take a brand-new Mac to a running Pensieve.
#
# The README's "Running" assumes bun, a `.env`, the argus checkout at the path
# WORKSPACE_DIR names, `~/.pensieve` for Ask's conversations, a Foundry token minted in
# another repo and a `claude login` are all already there. Three of those fail quietly:
# without the token Send is off, without the login Ask is off, and without the checkout
# every page is empty. This is the step that makes them so, in the same shape as
# foundry's and argus's scripts/bootstrap.sh: phases that run alone, --check that
# changes nothing, a prompt before every install, and a no-op when a step is already done.
#
#   ./scripts/bootstrap.sh              # the whole thing, prompting before each install
#   ./scripts/bootstrap.sh --check      # report only, change nothing
#   ./scripts/bootstrap.sh envfiles     # just one phase (see --help)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="$ROOT/.env"
# The shared credentials file — the secrets more than one of argus / Foundry / Pensieve
# needs (SLACK_TOKEN, LINEAR_API_KEY, FOUNDRY_API_TOKEN), typed once per machine.
# KEY=value lines, mode 600; `foundry auth` writes it and src/server/foundry.ts reads it.
SHARED_ENV="${LIAMAI_ENV:-$HOME/.config/liamai/env}"
FOUNDRY_URL_DEFAULT="http://localhost:3777"
# Any well-formed id: without a bearer Foundry answers before it ever looks one up.
PROBE_JOB_ID="00000000-0000-0000-0000-000000000000"

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_bld=$'\033[1m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$c_bld" "$c_0" "$*" >&2; }
ok()   { printf '%s ok %s %s\n' "$c_grn" "$c_0" "$*" >&2; }
warn() { printf '%s warn%s %s\n' "$c_yel" "$c_0" "$*" >&2; }
die()  { printf '%sbootstrap:%s %s\n' "$c_red" "$c_0" "$*" >&2; exit 1; }

CHECK=0   # --check: report, never mutate
YES=0     # --yes: install without asking (and the default when there is no TTY)
FAIL=0    # anything a phase found wanting

have() { command -v "$1" >/dev/null 2>&1; }

# Ask before installing. Non-interactive runs never prompt: with --yes they
# install, without it they report and move on, so CI can use this as a check.
confirm() {
  [ "$YES" = 1 ] && return 0
  [ -t 0 ] || return 1
  local ans; read -rp "  $1 [Y/n] " ans
  case "$ans" in [nN]*) return 1 ;; *) return 0 ;; esac
}

# One host tool: report it, and offer to install it when it is missing.
# $1 name  $2 human description  $3 install command ("" = no automated install)
# $4 "opt" marks it optional — a miss is a warning, not a failure.
# $5 overrides what the hint prints, for an install that is a shell function
# rather than a command a human could paste.
tool() {
  local name="$1" desc="$2" install="${3:-}" opt="${4:-}" hint="${5:-${3:-}}"
  if have "$name"; then ok "$name ${c_dim}($(command -v "$name"))${c_0}"; return 0; fi
  if [ "$CHECK" = 1 ] || [ -z "$install" ]; then
    warn "$name missing — $desc ${c_dim}(${hint:-install by hand})${c_0}"
    [ "$opt" = opt ] || FAIL=1
    return 0
  fi
  warn "$name missing — $desc"
  say "  ${c_dim}$hint${c_0}"
  if confirm "install $name?"; then
    eval "$install" || { warn "installing $name failed"; [ "$opt" = opt ] || FAIL=1; return 0; }
    have "$name" && ok "$name installed" || warn "$name installed but not on this shell's PATH — open a new terminal"
  else
    [ "$opt" = opt ] || FAIL=1
  fi
}

# ------------------------------------------------------------------ .env, by key
#
# Never `source` either file: the shared one holds Slack and Linear tokens this script
# has no business knowing, and one bad line would run as shell. One key at a time, by
# sed, is enough for everything below.

# The last value for a key in a KEY=value file, or "" (absent file included).
env_get() {
  local key="$1" file="${2:-$ENV_FILE}"
  [ -f "$file" ] || return 0
  sed -n "s/^$key=//p" "$file" | tail -1
}

# What the app will see for a variable: the environment wins (that is Bun's precedence
# for a .env), then .env, then the built-in default.
env_effective() {
  local key="$1" fallback="${2:-}" from_shell
  from_shell="$(printenv "$key" 2>/dev/null || true)"
  [ -n "$from_shell" ] && { printf '%s' "$from_shell"; return 0; }
  local from_file; from_file="$(env_get "$key")"
  printf '%s' "${from_file:-$fallback}"
}

# Set a key in .env. An existing line for it is rewritten where it stands — .env.example
# is mostly comments, and a key that jumped to the bottom would be explained by a
# paragraph twenty lines above it. Only a key the file has never had is appended.
# Nothing is echoed, so this is safe for the token.
env_set() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "$ROOT/.env.XXXXXX")"
  if [ -f "$ENV_FILE" ] && grep -q "^$key=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      index($0, k "=") == 1 && !seen { print k "=" v; seen = 1; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
  else
    { [ -f "$ENV_FILE" ] && cat "$ENV_FILE"; printf '%s=%s\n' "$key" "$value"; } > "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  # .env may now hold the Foundry token; keep it as private as the file it came from.
  chmod 600 "$ENV_FILE"
}

# ------------------------------------------------------------------ phases

# Homebrew is the vehicle for git and tailscale, so it is checked first and is the one
# thing this script will not install unattended — it changes /opt and asks for sudo,
# which belongs to the user rather than to a setup script.
cmd_prereqs() {
  info "host tooling"
  [ "$(uname -s)" = Darwin ] || warn "this script targets macOS — install the tools below by hand"

  if ! have brew; then
    warn "Homebrew missing — git and tailscale below install through it"
    say "  ${c_dim}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${c_0}"
  else
    ok "brew ${c_dim}($(command -v brew))${c_0}"
  fi

  tool bun    "the dev server, the build, bun test — every script here"      "curl -fsSL https://bun.sh/install | bash"
  tool claude "Ask spawns it over the checkout; without it Ask is off"       "curl -fsSL https://claude.ai/install.sh | bash"
  tool git    "the workspace phase reads the argus checkout's branch"        "brew install git"
  tool tailscale "'bun run serve' — Pensieve at this machine's MagicDNS name" "brew install --cask tailscale" opt
}

# The blackboard Pensieve reads. Reporting only, and read-only at that: the checkout is
# argus's, the sweep runs in it, and its branch is whatever the sweep left it on — so
# this never runs a git write command there, and never clones (the remote and the
# credentials are yours, exactly as Foundry's bootstrap leaves cloning to you).
cmd_workspace() {
  info "argus checkout"
  local dir; dir="$(env_effective WORKSPACE_DIR "$HOME/git/argus")"
  say "  ${c_dim}WORKSPACE_DIR=$dir${c_0}"
  if ! [ -d "$dir" ]; then
    warn "$dir missing — clone argus there (left to you), or set WORKSPACE_DIR in .env"
    FAIL=1; return 0
  fi
  if ! have git; then warn "git missing — run the prereqs phase first"; FAIL=1; return 0; fi
  if git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
    ok "argus checkout ${c_dim}($dir, on $(git -C "$dir" branch --show-current 2>/dev/null || echo '?'))${c_0}"
  else
    warn "$dir is not a git checkout — Pensieve reads the argus repo, not a copy of its files"
    FAIL=1; return 0
  fi
  local sub
  for sub in reports skills; do
    if [ -d "$dir/$sub" ]; then ok "$sub/ present"
    else warn "$dir/$sub missing — is this the argus checkout? every page reads it"; FAIL=1; fi
  done
}

# .env is gitignored and created by nobody. FOUNDRY_API_TOKEN is copied from the shared
# credentials file rather than typed: `foundry auth --api` mints it in the Foundry repo
# and writes it there, and this script only ever reads that one key — never printed,
# never the others. src/server/foundry.ts reads the shared file itself as a fallback, so
# the copy is a convenience; when the two diverge the copy would win, and that is worth
# saying out loud rather than silently rewriting a token someone set by hand.
cmd_envfiles() {
  info "config files"
  if [ -f "$ENV_FILE" ]; then
    ok ".env exists"
  elif [ "$CHECK" = 1 ]; then
    warn ".env missing — cp .env.example .env"; FAIL=1
  else
    cp "$ROOT/.env.example" "$ENV_FILE"
    ok "created .env from .env.example ${c_dim}(gitignored)${c_0}"
  fi

  # AC5: a value already in .env is never overwritten — only an absent or empty one is filled.
  local url; url="$(env_get FOUNDRY_URL)"
  if [ -n "$url" ]; then
    ok "FOUNDRY_URL=$url"
  elif [ "$CHECK" = 1 ]; then
    warn "FOUNDRY_URL unset — rerun without --check to write $FOUNDRY_URL_DEFAULT"
  else
    env_set FOUNDRY_URL "$FOUNDRY_URL_DEFAULT"; ok "FOUNDRY_URL=$FOUNDRY_URL_DEFAULT ${c_dim}(Foundry's dev server)${c_0}"
  fi

  cmd_envfiles_token
}

# The one secret this script handles. Values are compared, never printed.
cmd_envfiles_token() {
  local mine theirs
  mine="$(env_get FOUNDRY_API_TOKEN)"
  theirs="$(env_get FOUNDRY_API_TOKEN "$SHARED_ENV")"

  if [ -n "$mine" ]; then
    if [ -z "$theirs" ] || [ "$mine" = "$theirs" ]; then
      ok "FOUNDRY_API_TOKEN set in .env"
    else
      warn "FOUNDRY_API_TOKEN in .env differs from $SHARED_ENV — .env wins, so a rotated token would not be picked up"
      say "  ${c_dim}clear the .env line to fall back to the shared file, or rerun \`foundry auth --api\`${c_0}"
    fi
    return 0
  fi

  if [ -n "$theirs" ]; then
    if [ "$CHECK" = 1 ]; then
      ok "FOUNDRY_API_TOKEN available from $SHARED_ENV ${c_dim}(rerun without --check to copy it into .env)${c_0}"
    else
      env_set FOUNDRY_API_TOKEN "$theirs"
      ok "FOUNDRY_API_TOKEN copied from $SHARED_ENV ${c_dim}(.env is now mode 600)${c_0}"
    fi
    return 0
  fi

  warn "FOUNDRY_API_TOKEN not set here or in $SHARED_ENV — the Points page can ignore a point but not Send it"
  say "  ${c_dim}cd ~/git/foundry && foundry auth --api${c_0}   mints it and writes the shared file; then rerun this phase"
  FAIL=1
}

# Ask's state: one JSON file per conversation, outside the blackboard so the "argus owns
# every file it shows" rule holds. Nothing creates it, and the store's first write is
# inside a streaming run — a failure there surfaces as a broken answer, not as setup.
cmd_home() {
  info "ask state"
  local home; home="$(env_effective PENSIEVE_HOME "$HOME/.pensieve")"
  local convos="$home/conversations"
  if [ -d "$convos" ]; then
    ok "$convos ${c_dim}($(find "$convos" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ') conversations)${c_0}"
    [ -w "$convos" ] || { warn "$convos is not writable — Ask cannot save a conversation"; FAIL=1; }
    return 0
  fi
  if [ "$CHECK" = 1 ]; then warn "$convos missing — mkdir -p $convos"; FAIL=1; return 0; fi
  mkdir -p "$convos" || { warn "could not create $convos"; FAIL=1; return 0; }
  ok "created $convos"
}

# bun install only when it would change something: node_modules missing, or the
# lockfile newer than the install that last read it.
cmd_deps() {
  info "dependencies"
  have bun || { warn "bun missing — run the prereqs phase first"; FAIL=1; return 0; }
  if [ -d "$ROOT/node_modules" ] && [ ! "$ROOT/bun.lock" -nt "$ROOT/node_modules" ]; then
    ok "node_modules current with bun.lock"; return 0
  fi
  if [ "$CHECK" = 1 ]; then warn "node_modules missing or older than bun.lock — bun install"; FAIL=1; return 0; fi
  (cd "$ROOT" && bun install) || { warn "bun install failed"; FAIL=1; return 0; }
  touch "$ROOT/node_modules"   # bun rewrites bun.lock after creating the dir; mark the install as current
  ok "bun install"
}

# The two things that are configured elsewhere and fail quietly here: Foundry running,
# and a Claude credential. Both are probes of the outside world, so both are read-only
# in every mode — `check` is the same work with or without --check.
cmd_check() {
  info "services"
  check_foundry
  check_claude
}

# Reachability, not authorization: `foundry auth --api` owns the token, and 401 (wrong
# bearer) and 503 (Foundry has no token configured) both prove something answered on
# that port. Only a connection failure is a miss.
check_foundry() {
  local url; url="$(env_effective FOUNDRY_URL "$FOUNDRY_URL_DEFAULT")"
  if ! have curl; then warn "curl missing — cannot probe $url"; return 0; fi
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url/api/jobs/$PROBE_JOB_ID" 2>/dev/null || true)"
  case "$code" in
    ""|000)
      warn "$url unreachable — Send would fail; start Foundry (cd ~/git/foundry && bun run web:dev), or fix FOUNDRY_URL in .env"
      FAIL=1 ;;
    401|503)
      ok "Foundry reachable ${c_dim}($url answered $code — the trigger API is up)${c_0}" ;;
    *)
      ok "Foundry reachable ${c_dim}($url answered $code)${c_0}" ;;
  esac
}

# ANTHROPIC_API_KEY wins at runtime (src/server/ask.ts authMode), so it is reported
# first. Otherwise it is the host login, and `claude auth status` is advisory: anything
# that is not clear JSON is "cannot tell", not a failure — the first Ask run's own error
# is a better message than a guess here.
check_claude() {
  if [ -n "$(env_effective ANTHROPIC_API_KEY)" ]; then
    ok "ANTHROPIC_API_KEY set ${c_dim}(Ask runs bill the key, not this machine's login)${c_0}"
    return 0
  fi
  if ! have claude; then
    warn "claude missing — Ask is off; see the prereqs phase"; FAIL=1; return 0
  fi
  local out; out="$(claude auth status 2>/dev/null || true)"
  case "$out" in
    *'"loggedIn": true'*|*'"loggedIn":true'*)
      ok "claude logged in ${c_dim}($(printf '%s' "$out" | sed -n 's/.*"authMethod": *"\([^"]*\)".*/\1/p' | head -1))${c_0}" ;;
    *'"loggedIn": false'*|*'"loggedIn":false'*)
      warn "claude not logged in — Ask is off; run \`claude login\`, or set ANTHROPIC_API_KEY in .env"; FAIL=1 ;;
    *)
      warn "could not tell whether claude is logged in ${c_dim}(claude auth status said nothing usable)${c_0}"
      say "  ${c_dim}claude login${c_0}   if Ask reports itself off, this is why" ;;
  esac
}

summary() {
  say ""
  if [ "$FAIL" = 0 ]; then ok "host is ready"
  else warn "something is missing — see above"; fi
  say ""
  say "  bun run dev                 ${c_dim}# http://localhost:3778${c_0}"
  say "  bun run serve               ${c_dim}# on the tailnet, https://<host>.ts.net:3778${c_0}"
  say "  bun test                    ${c_dim}# decisions, the Foundry client, Ask's store and run${c_0}"
  return "$FAIL"
}

cmd_all() {
  cmd_prereqs
  cmd_workspace
  cmd_envfiles
  cmd_home
  cmd_deps
  cmd_check
  summary
}

usage() {
cat >&2 <<'USAGE'
bootstrap — take a brand-new Mac to a running Pensieve

  ./scripts/bootstrap.sh [--check|--yes] [phase]

  (no args)    every phase in order, prompting before each install
  --check      report what is missing and change nothing (usable in CI)
  --yes        install without prompting

  phases, runnable on their own:
    prereqs    host tooling: bun, claude, git (tailscale optional)
    workspace  the argus checkout WORKSPACE_DIR names is a git repo with reports/ and
               skills/ — reported, never cloned and never written to
    envfiles   .env from .env.example; FOUNDRY_URL, and FOUNDRY_API_TOKEN copied from
               the shared credentials file when it has one
    home       PENSIEVE_HOME/conversations/, where Ask keeps its threads
    deps       bun install, when node_modules is missing or older than bun.lock
    check      is Foundry answering, and is there a Claude credential? (read-only)

Secrets stay yours: this script never prints a token, never mints one — `foundry auth
--api` in the Foundry repo does that — and never touches a key in the shared file other
than FOUNDRY_API_TOKEN. So is the blackboard: nothing here clones argus or runs a git
write command inside it.

  WORKSPACE_DIR                       the argus checkout (default ~/git/argus)
  PENSIEVE_HOME                       Ask's state (default ~/.pensieve)
  LIAMAI_ENV                          the shared credentials file (default ~/.config/liamai/env)
USAGE
}

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*) die "unknown flag: $1 (bootstrap.sh --help)" ;;
    *) args+=("$1"); shift ;;
  esac
done
set -- "${args[@]+"${args[@]}"}"

case "${1:-}" in
  ""|all)    cmd_all ;;
  prereqs)   cmd_prereqs;   summary ;;
  workspace) cmd_workspace; summary ;;
  envfiles)  cmd_envfiles;  summary ;;
  home)      cmd_home;      summary ;;
  deps)      cmd_deps;      summary ;;
  check)     cmd_check;     summary ;;
  *) die "unknown command '$1' (bootstrap.sh --help)" ;;
esac
