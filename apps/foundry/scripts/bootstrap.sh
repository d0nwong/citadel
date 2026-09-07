#!/usr/bin/env bash
# bootstrap — take a brand-new Mac to a working foundry.
#
# `foundry setup` starts one step too late: it *checks* for docker, bun and gh
# and dies when they are missing, and it never writes the config files that
# nothing else writes either (web/.env, the PATH symlink). This is the step
# before it — install the host tooling, settle the
# identity and the config, then hand over to `foundry setup` for the parts it
# already does well (credentials, image, deps, infra, schema).
#
#   ./scripts/bootstrap.sh              # the whole thing, prompting before each install
#   ./scripts/bootstrap.sh --check      # report only, change nothing
#   ./scripts/bootstrap.sh prereqs      # just one phase (see --help)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BINDIR="${FOUNDRY_BINDIR:-$HOME/.local/bin}"

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_bld=$'\033[1m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$c_bld" "$c_0" "$*" >&2; }
ok()   { printf '%s ok %s %s\n' "$c_grn" "$c_0" "$*" >&2; }
warn() { printf '%s warn%s %s\n' "$c_yel" "$c_0" "$*" >&2; }
die()  { printf '%sbootstrap:%s %s\n' "$c_red" "$c_0" "$*" >&2; exit 1; }

CHECK=0   # --check: report, never mutate
YES=0     # --yes: install without asking (and the default when there is no TTY)
FAIL=0    # anything --check found wanting

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
  if confirm "install $name?"; then
    say "  ${c_dim}$hint${c_0}"
    eval "$install" || { warn "installing $name failed"; [ "$opt" = opt ] || FAIL=1; return 0; }
    have "$name" && ok "$name installed" || warn "$name installed but not on this shell's PATH — open a new terminal"
  else
    [ "$opt" = opt ] || FAIL=1
  fi
}

# ------------------------------------------------------------------ phases

# Homebrew is the vehicle for most of the rest, so it goes first and is the one
# thing this script will not install unattended — it changes /opt and asks for
# sudo, which belongs to the user rather than to a setup script.
cmd_prereqs() {
  info "host tooling"
  [ "$(uname -s)" = Darwin ] || warn "this script targets macOS — install the tools below by hand"

  if ! have brew; then
    warn "Homebrew missing — most installs below need it"
    say "  ${c_dim}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${c_0}"
  else
    ok "brew ${c_dim}($(command -v brew))${c_0}"
  fi

  tool git    "clones, branches, and every job's commit"        "brew install git"
  tool docker "OrbStack's docker CLI — forges are containers"   "brew install --cask orbstack"
  tool orb    "OrbStack itself"                                 "brew install --cask orbstack"
  tool bun    "the web app, migrations, and every bun run"      "curl -fsSL https://bun.sh/install | bash"
  tool claude "'claude setup-token' mints the forge credential" "curl -fsSL https://claude.ai/install.sh | bash"
  tool gh     "PRs on github.com origins, and --github forges"  "brew install gh"
  tool php    "the bb CLI is a PHP phar"                        "brew install php" opt
  tool bb     "PRs on bitbucket.org origins"                    "\"$HERE/setup-bb.sh\"" opt \
       "./scripts/setup-bb.sh"
  tool tailscale "'bun run web:serve', to reach the UI from your tailnet" "brew install --cask tailscale" opt
  have openssl && ok "openssl ${c_dim}(mints the gateway and API tokens)${c_0}" || warn "openssl missing"

  # The docker CLI without a daemon is the most common half-installed state, so
  # it gets its own check rather than hiding behind `command -v docker`.
  if have docker; then
    if docker info >/dev/null 2>&1; then
      ok "docker daemon ${c_dim}($(docker info --format '{{.OperatingSystem}}' 2>/dev/null))${c_0}"
      docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -qi orbstack \
        || warn "the active docker context is not OrbStack — docker context use orbstack"
    elif [ "$CHECK" = 1 ]; then
      warn "docker daemon unreachable — start OrbStack"; FAIL=1
    else
      warn "docker daemon unreachable"
      if confirm "launch OrbStack now?"; then
        open -a OrbStack 2>/dev/null || warn "could not launch OrbStack — start it from Applications"
        info "waiting for the docker daemon"
        local i=0
        while ! docker info >/dev/null 2>&1; do
          i=$((i + 1)); [ "$i" -gt 60 ] && { warn "gave up waiting — start OrbStack and rerun"; FAIL=1; break; }
          sleep 1
        done
        docker info >/dev/null 2>&1 && ok "docker daemon up"
      else FAIL=1; fi
    fi
  fi
}

# Every forge is created with the host's git identity baked in (`foundry new`
# reads it into GIT_AUTHOR_NAME/EMAIL). Unset, it silently becomes
# dev@localhost, and every commit a job makes is authored by a ghost.
cmd_identity() {
  info "git identity"
  local n e
  n=$(git config --global user.name  || true)
  e=$(git config --global user.email || true)
  if [ -n "$n" ] && [ -n "$e" ]; then ok "git identity: $n <$e>"; return 0; fi
  if [ "$CHECK" = 1 ]; then warn "git user.name/user.email unset — job commits would be authored dev@localhost"; FAIL=1; return 0; fi
  warn "git user.name/user.email unset — every forge inherits this"
  if [ -t 0 ]; then
    [ -z "$n" ] && { read -rp "  git user.name: " n;  [ -n "$n" ] && git config --global user.name  "$n"; }
    [ -z "$e" ] && { read -rp "  git user.email: " e; [ -n "$e" ] && git config --global user.email "$e"; }
    ok "git identity: $(git config --global user.name) <$(git config --global user.email)>"
  else
    say "  ${c_dim}git config --global user.name 'You'; git config --global user.email you@example.com${c_0}"
  fi
}

# The README suggests this symlink and `foundry setup` only warns when it is
# missing. bin/foundry resolves its own symlink, so the link works from anywhere.
cmd_link() {
  info "foundry on PATH"
  if have foundry; then ok "foundry ${c_dim}($(command -v foundry))${c_0}"; return 0; fi
  if [ "$CHECK" = 1 ]; then warn "foundry not on PATH — ln -s $ROOT/bin/foundry $BINDIR/foundry"; return 0; fi
  mkdir -p "$BINDIR"
  ln -sf "$ROOT/bin/foundry" "$BINDIR/foundry"
  ok "linked $BINDIR/foundry -> $ROOT/bin/foundry"
  case ":$PATH:" in
    *":$BINDIR:"*) ;;
    *) warn "$BINDIR is not on PATH — add: export PATH=\"$BINDIR:\$PATH\"" ;;
  esac
}

# infra/.env is created by infra.sh on first up; web/.env is created by nobody,
# which is fine until you move a port and the fallback URL points at nothing.
# The shared credential file — ~/.config/liamai/env, LIAMAI_ENV overrides it,
# the same file argus's and Pensieve's bootstraps know — is reported by key
# name, never by value, and created empty when absent so every writer finds
# the same 600 file. Filling it stays with `foundry auth`.
cmd_envfiles() {
  info "config files"
  local f
  for f in infra web; do
    local target="$ROOT/$f/.env" example="$ROOT/$f/.env.example"
    [ -f "$example" ] || continue
    if [ -f "$target" ]; then ok "$f/.env exists"
    elif [ "$CHECK" = 1 ]; then warn "$f/.env missing — cp $f/.env.example $f/.env"
    else cp "$example" "$target"; ok "created $f/.env from .env.example ${c_dim}(gitignored)${c_0}"; fi
  done
  local shared="${LIAMAI_ENV:-$HOME/.config/liamai/env}" k miss=""
  if [ -f "$shared" ]; then
    for k in SLACK_TOKEN LINEAR_API_KEY FOUNDRY_API_TOKEN; do
      if grep -q "^$k=." "$shared"; then ok "$k set in $shared"; else miss="${miss:+$miss, }$k"; fi
    done
    [ -z "$miss" ] || say "  ${c_dim}not set: $miss — foundry auth --slack / --linear / --api${c_0}"
  elif [ "$CHECK" = 1 ]; then
    warn "$shared missing — foundry auth --slack / --linear / --api"
  else
    mkdir -p "$(dirname "$shared")"; chmod 700 "$(dirname "$shared")"
    (umask 077; : > "$shared"); chmod 600 "$shared"
    ok "created empty $shared ${c_dim}(600 — foundry auth --slack / --linear / --api fill it)${c_0}"
  fi
}

# Everything above is the part `foundry setup` does not do; this is the handover.
# The API token is minted here because setup skips it and the trigger endpoint
# answers 503 without one.
cmd_foundry() {
  info "foundry setup"
  [ "$CHECK" = 1 ] && { say "  ${c_dim}skipped in --check${c_0}"; return 0; }
  "$ROOT/bin/foundry" setup "$@"
  info "trigger API token"
  "$ROOT/bin/foundry" auth --api
}

cmd_check() { CHECK=1; cmd_prereqs; cmd_identity; cmd_link; cmd_envfiles; summary; }

summary() {
  say ""
  if [ "$FAIL" = 0 ]; then ok "host is ready"
  else warn "some prerequisites are missing — see above"; fi
  say ""
  say "  ./scripts/db.sh migrate     ${c_dim}# apply the schema${c_0}"
  say "  bun run web:dev             ${c_dim}# http://localhost:3777${c_0}"
  say "  foundry doctor              ${c_dim}# credentials, image, gateway${c_0}"
  return "$FAIL"
}

cmd_all() {
  cmd_prereqs
  cmd_identity
  cmd_link
  cmd_envfiles
  [ "$FAIL" = 0 ] || die "fix the prerequisites above, then rerun"
  cmd_foundry "$@"
  cmd_left_to_you
  summary
}

cmd_left_to_you() {
  say ""
  info "left to you"
  say "  ${c_dim}gh auth login${c_0}                       github PRs, and --github forges"
  say "  ${c_dim}./scripts/setup-bb.sh${c_0}               bitbucket PRs — installs bb and verifies the token"
  say "  ${c_dim}clone your repos under ~/git${c_0}        the Repos page only scans there"
}

usage() {
cat >&2 <<'USAGE'
bootstrap — take a brand-new Mac to a working foundry

  ./scripts/bootstrap.sh [--check|--yes] [--linear|--no-linear]

  (no args)    every phase, then `foundry setup` and the API token
  --check      report what is missing and change nothing (usable in CI)
  --yes        install without prompting
  --linear     passed through to `foundry setup` (--no-linear to skip that prompt)

  phases, runnable on their own:
    prereqs    host tooling: orbstack, bun, claude, gh, php/bb, tailscale
    identity   git user.name / user.email — every forge inherits it
    link       symlink bin/foundry onto PATH
    envfiles   infra/.env and web/.env from their .env.example; the shared
               ~/.config/liamai/env (LIAMAI_ENV), reported by key name, created empty
    foundry    hand over to `foundry setup`, then mint FOUNDRY_API_TOKEN

Credentials themselves stay with `foundry auth` — this script never touches
~/.foundry/env, and only ever creates ~/.config/liamai/env empty.
USAGE
}

# --linear/--no-linear belong to `foundry setup`, not to this script, so they
# are collected separately and forwarded rather than parsed as a phase name.
args=(); PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --yes|-y) YES=1; shift ;;
    --linear|--no-linear) PASS+=("$1"); shift ;;
    -h|--help|help) usage; exit 0 ;;
    -*) die "unknown flag: $1 (bootstrap.sh --help)" ;;
    *) args+=("$1"); shift ;;
  esac
done
set -- "${args[@]+"${args[@]}"}"

case "${1:-}" in
  ""|all)   shift || true
            if [ "$CHECK" = 1 ]; then cmd_check; else cmd_all "${PASS[@]+"${PASS[@]}"}"; fi ;;
  prereqs)  shift; cmd_prereqs;  summary ;;
  identity) shift; cmd_identity; summary ;;
  link)     shift; cmd_link;     summary ;;
  envfiles) shift; cmd_envfiles; summary ;;
  foundry)  shift; cmd_foundry "${PASS[@]+"${PASS[@]}"}" ;;
  check)    shift; cmd_check ;;
  *) die "unknown command '$1' (bootstrap.sh --help)" ;;
esac
