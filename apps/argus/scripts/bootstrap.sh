#!/usr/bin/env bash
# bootstrap — take a brand-new Mac to a running sweep.
#
# The README's "Running it" assumes git, bun, the claude CLI, `bun install`, the two
# alden checkouts at the paths accio expects, the derived .state/ files, an
# authenticated Linear MCP server and SLACK_TOKEN are all already there. This is the
# step that makes them so, in the same shape as foundry's scripts/bootstrap.sh: phases
# that run alone, --check that changes nothing, a prompt before every install, and a
# no-op when a step is already done.
#
#   ./scripts/bootstrap.sh              # the whole thing, prompting before each install
#   ./scripts/bootstrap.sh --check      # report only, change nothing
#   ./scripts/bootstrap.sh repos        # just one phase (see --help)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SKILLS_DIR="$HOME/.claude/skills"
# The shared credentials file — the secrets more than one of argus / Foundry / Pensieve
# needs (SLACK_TOKEN, LINEAR_API_KEY, FOUNDRY_API_TOKEN), typed once per machine.
# KEY=value lines, mode 600; Foundry's `foundry auth` writes the same file.
SHARED_ENV="${LIAMAI_ENV:-$HOME/.config/liamai/env}"

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

# The checkouts the skills read are named by the feature manifests (`fe_repo` /
# `be_repo` in each */.doc-workspace/feature-manifest.json) — per-product data, not
# setup. This prints one "app<TAB>role<TAB>path" line per named checkout, ~ expanded.
manifest_repos() {
  have bun || return 0
  (cd "$ROOT" && bun -e '
    const files = [...new Bun.Glob("**/.doc-workspace/feature-manifest.json").scanSync({ cwd: ".", dot: true })].filter((f) => !f.includes("node_modules")).sort();
    for (const f of files) {
      const m = await Bun.file(f).json();
      for (const role of ["fe_repo", "be_repo"]) {
        if (m[role]) console.log([m.app ?? f, role.slice(0, 2).toUpperCase(), m[role].replace(/^~/, process.env.HOME)].join("\t"));
      }
    }')
}

# ------------------------------------------------------------------ phases

# Homebrew is the vehicle for git and gh, so it is checked first and is the one thing
# this script will not install unattended — it changes /opt and asks for sudo, which
# belongs to the user rather than to a setup script.
cmd_prereqs() {
  info "host tooling"
  [ "$(uname -s)" = Darwin ] || warn "this script targets macOS — install the tools below by hand"

  if ! have brew; then
    warn "Homebrew missing — git and gh below install through it"
    say "  ${c_dim}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${c_0}"
  else
    ok "brew ${c_dim}($(command -v brew))${c_0}"
  fi

  tool git    "the blackboard is a git repo; pr-facts reads the alden checkouts" "brew install git"
  tool bun    "accio, sync-skills, points, slack-pull — every script here"        "curl -fsSL https://bun.sh/install | bash"
  tool claude "the sweep is a Claude Code session (/loop 1h /sweep)"             "curl -fsSL https://claude.ai/install.sh | bash"
  tool gh     "office-hours and prototyping open PRs on github.com"              "brew install gh" opt
}

# The sweep's landings scan, stale pass and feature-docs read the product checkouts
# the manifests name. This only reports them: cloning a client's repo is yours (the
# remote, the credentials and the branch are none of this script's business), exactly
# as Foundry's bootstrap leaves "clone your repos under ~/git" to you. It never runs a
# git write command in any of them — the FE tree is shared and its branch is whatever
# you left it on.
cmd_repos() {
  info "product checkouts (named by the feature manifests)"
  have bun || { warn "bun missing — run the prereqs phase first"; FAIL=1; return 0; }
  local app role path origin n=0
  while IFS=$'\t' read -r app role path; do
    [ -n "$path" ] || continue; n=$((n + 1))
    if git -C "$path" rev-parse --git-dir >/dev/null 2>&1; then
      origin="$(git -C "$path" remote get-url origin 2>/dev/null || true)"
      if [ -n "$origin" ]; then ok "$app $role: $path ${c_dim}(on $(git -C "$path" branch --show-current 2>/dev/null || echo '?'))${c_0}"
      else warn "$app $role: $path has no origin — git -C $path remote add origin <url>"; FAIL=1; fi
    elif [ -e "$path" ]; then warn "$app $role: $path exists but is not a git checkout"; FAIL=1
    else warn "$app $role: $path missing — clone the $role repo there (left to you; pr-facts, accio and feature-docs read it)"; FAIL=1; fi
  done < <(manifest_repos)
  [ "$n" -gt 0 ] || ok "no manifest names a checkout"
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

# Skills become global by per-skill symlink (scripts/sync-skills.ts). It exits 2 when
# ~/.claude/skills does not exist — the case on a machine where claude has never run —
# so the directory is created first. A conflict (a foreign file or link with a skill's
# name) is never overwritten; it fails the phase and names itself.
cmd_skills() {
  info "global skills"
  have bun || { warn "bun missing — run the prereqs phase first"; FAIL=1; return 0; }
  if [ -L "$SKILLS_DIR" ] && [ ! -e "$SKILLS_DIR" ]; then
    warn "$SKILLS_DIR is a symlink to nowhere ($(readlink "$SKILLS_DIR")) — fix or remove it"; FAIL=1; return 0
  fi
  if [ ! -d "$SKILLS_DIR" ]; then
    if [ "$CHECK" = 1 ]; then warn "$SKILLS_DIR missing — mkdir -p $SKILLS_DIR"; FAIL=1; return 0; fi
    mkdir -p "$SKILLS_DIR"; ok "created $SKILLS_DIR"
  fi
  local rc=0
  if [ "$CHECK" = 1 ]; then
    (cd "$ROOT" && bun run --silent sync-skills --check >/dev/null 2>&1) || rc=$?
    case "$rc" in
      0) ok "skills linked into $SKILLS_DIR" ;;
      *) warn "skills out of sync or conflicting — bun run sync-skills"; FAIL=1 ;;
    esac
    return 0
  fi
  (cd "$ROOT" && bun run --silent sync-skills) || rc=$?
  case "$rc" in
    0) ok "skills linked into $SKILLS_DIR" ;;
    *) warn "sync-skills reported a conflict — nothing was overwritten; see its output above"; FAIL=1 ;;
  esac
}

# .state/openapi.json, accio-index.json and symbols.json are gitignored and derived from
# the FE checkout by `accio sync`, so this phase needs `repos` to have passed.
cmd_state() {
  info "derived state"
  if [ -f "$ROOT/.state/openapi.json" ]; then ok ".state/openapi.json present ${c_dim}(accio sync rebuilds it)${c_0}"; return 0; fi
  have bun || { warn "bun missing — run the prereqs phase first"; FAIL=1; return 0; }
  local fe_path; fe_path="$(manifest_repos | awk -F'\t' '$1 == "alden-portal" && $2 == "FE" { print $3 }')"
  if [ -z "$fe_path" ] || ! git -C "$fe_path" rev-parse --git-dir >/dev/null 2>&1; then
    warn ".state/openapi.json missing and the alden-portal FE checkout (${fe_path:-unnamed}) is not there — see the repos phase"; FAIL=1; return 0
  fi
  if [ "$CHECK" = 1 ]; then warn ".state/openapi.json missing — bun run accio sync"; FAIL=1; return 0; fi
  (cd "$ROOT" && bun run --silent accio sync) || { warn "accio sync failed"; FAIL=1; return 0; }
  ok "accio sync"
}

# SLACK_TOKEN is the one secret the loop needs. slack-pull reads it from the environment
# (Bun loads .env) and otherwise from the shared file itself, so nothing is exported in
# the shell — no other process, Claude sessions included, inherits it. Never printed.
cmd_env() {
  info "shared credentials"
  if [ -f "$SHARED_ENV" ]; then
    ok "$SHARED_ENV exists"
    [ "$(stat -f '%Lp' "$SHARED_ENV" 2>/dev/null || stat -c '%a' "$SHARED_ENV")" = 600 ] || warn "$SHARED_ENV is not mode 600 — chmod 600 $SHARED_ENV"
  elif [ "$CHECK" = 1 ]; then
    warn "$SHARED_ENV missing — rerun without --check to create it, or: foundry auth --slack"; FAIL=1; return 0
  else
    mkdir -p -m 700 "$(dirname "$SHARED_ENV")"
    (umask 077; : > "$SHARED_ENV")
    ok "created $SHARED_ENV ${c_dim}(mode 600, empty)${c_0}"
  fi
  if grep -Eq '^SLACK_TOKEN=.+' "$SHARED_ENV"; then ok "SLACK_TOKEN set"; return 0; fi
  warn "SLACK_TOKEN empty — slack-digest (and so the sweep's digest tick) cannot pull Slack"
  if [ "$CHECK" = 1 ] || [ ! -t 0 ]; then
    say "  ${c_dim}foundry auth --slack${c_0}                          if Foundry is set up here"
    say "  ${c_dim}./scripts/bootstrap.sh env${c_0}                    from a terminal, to be prompted"
    FAIL=1; return 0
  fi
  if confirm "enter the Slack user token (xoxp-…) now?"; then
    local tok; read -rsp "  SLACK_TOKEN: " tok; echo >&2
    [ -n "$tok" ] || { warn "empty — nothing written"; FAIL=1; return 0; }
    write_shared SLACK_TOKEN "$tok"; ok "stored SLACK_TOKEN in $SHARED_ENV"
  else FAIL=1; fi
}

# One key into the shared file, replacing an existing line for it — the same shape as
# Foundry's write_env, so either tool can maintain the file.
write_shared() {
  local k="$1" v="$2" tmp; tmp="$(mktemp "$(dirname "$SHARED_ENV")/.env.XXXXXX")"
  { [ -f "$SHARED_ENV" ] && grep -v "^$k=" "$SHARED_ENV"; printf '%s=%s\n' "$k" "$v"; } > "$tmp"
  mv "$tmp" "$SHARED_ENV"; chmod 600 "$SHARED_ENV"
}

# Linear MCP state lives with the claude CLI, not in this repo. `claude mcp get linear`
# runs a health check against .mcp.json's server; the phrasing it prints is advisory,
# so anything other than a clear Connected / Needs authentication is reported as-is.
cmd_check() {
  info "linear mcp"
  have claude || { warn "claude missing — run the prereqs phase first"; FAIL=1; return 0; }
  local out
  out="$(cd "$ROOT" && claude mcp get linear 2>&1 || true)"
  if printf '%s' "$out" | grep -q "Connected"; then
    ok "linear mcp authenticated ${c_dim}(claude mcp get linear)${c_0}"
  elif printf '%s' "$out" | grep -qi "needs authentication"; then
    warn "linear mcp not authenticated — the sweep's ticket pass and linear-ticket cannot write"
    linear_steps; FAIL=1
  elif printf '%s' "$out" | grep -qi "No MCP server found"; then
    warn "no 'linear' server known to claude — .mcp.json should be picked up when a session starts in $ROOT"
    linear_steps; FAIL=1
  else
    warn "could not tell — claude mcp get linear said:"; printf '%s\n' "$out" | sed 's/^/    /' >&2
    linear_steps
  fi
}

linear_steps() {
  say "  1. ${c_dim}cd $ROOT && claude${c_0}      open a Claude session in this directory"
  say "  2. ${c_dim}/mcp${c_0}                                 then choose ${c_bld}linear${c_0} → Authenticate"
  say "  3. finish the browser login; rerun ${c_dim}./scripts/bootstrap.sh check${c_0}"
}

summary() {
  say ""
  if [ "$FAIL" = 0 ]; then ok "host is ready"
  else warn "something is missing — see above"; fi
  say ""
  say "  bun run sweep               ${c_dim}# the loop: claude '/loop 1h /sweep' on Sonnet${c_0}"
  say "  claude → /sweep             ${c_dim}# one manual pass${c_0}"
  say "  bun run accio audit         ${c_dim}# reconcile without writing${c_0}"
  return "$FAIL"
}

cmd_all() {
  cmd_prereqs
  cmd_repos
  cmd_deps
  cmd_skills
  cmd_state
  cmd_env
  cmd_check
  summary
}

usage() {
cat >&2 <<'USAGE'
bootstrap — take a brand-new Mac to a running sweep

  ./scripts/bootstrap.sh [--check|--yes] [phase]

  (no args)    every phase in order, prompting before each install
  --check      report what is missing and change nothing (usable in CI)
  --yes        install without prompting

  phases, runnable on their own:
    prereqs    host tooling: git, bun, claude (gh optional)
    repos      the product checkouts the feature manifests name are present (report only)
    deps       bun install, when node_modules is missing or older than bun.lock
    skills     bun run sync-skills — every skills/<name>/ linked into ~/.claude/skills
    state      bun run accio sync, when .state/openapi.json is absent
    env        the shared credentials file ~/.config/liamai/env; prompts for SLACK_TOKEN
    check      is the Linear MCP server authenticated? prints the /mcp steps if not

Secrets stay yours: this script never prints a token, and the Linear login is a
browser flow inside a Claude session that it can only point you at. So are the product
repos: nothing here knows a remote or clones one — the manifests say where a checkout
should be, and you put it there.

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
  ""|all)   cmd_all ;;
  prereqs)  cmd_prereqs; summary ;;
  repos)    cmd_repos;   summary ;;
  deps)     cmd_deps;    summary ;;
  skills)   cmd_skills;  summary ;;
  state)    cmd_state;   summary ;;
  env)      cmd_env;     summary ;;
  check)    cmd_check;   summary ;;
  *) die "unknown command '$1' (bootstrap.sh --help)" ;;
esac
