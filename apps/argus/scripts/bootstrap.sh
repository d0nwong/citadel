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
# argus's env file — the checkout's own .env, seeded from .env.example; KEY=value lines,
# mode 600. It holds the upstream keys (SLACK_TOKEN, LINEAR_API_KEY) once, for slack-pull
# and for the MCP gateway (infra/), and the gateway token every Claude session presents.
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"

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
  tool claude "the sweep is a Claude Code session (/loop 15m /sweep)"             "curl -fsSL https://claude.ai/install.sh | bash"
  tool gh     "office-hours and prototyping open PRs on github.com"              "brew install gh" opt
  tool docker "the MCP gateway runs as a container (infra/compose.yaml)"         "" "" "install OrbStack: brew install orbstack"
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

# The upstream keys live in .env and nowhere else: slack-pull reads SLACK_TOKEN from the
# environment, which Bun fills from .env for every `bun …` script, and the MCP gateway
# gets both through compose's --env-file. Nothing is exported in the shell, so no other
# process, Claude sessions included, inherits a key. Never printed.
cmd_env() {
  info "env file"
  if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE exists"
    [ "$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE")" = 600 ] || warn "$ENV_FILE is not mode 600 — chmod 600 $ENV_FILE"
  elif [ "$CHECK" = 1 ]; then
    warn "$ENV_FILE missing — rerun without --check to create it from .env.example"; FAIL=1; return 0
  else
    (umask 077; cp "$ENV_EXAMPLE" "$ENV_FILE")
    chmod 600 "$ENV_FILE"
    ok "created $ENV_FILE ${c_dim}(from .env.example, mode 600)${c_0}"
  fi
  env_key SLACK_TOKEN "slack-pull (the sweep's Slack intake) and the gateway's Slack server cannot reach Slack" "the Slack user token, xoxp-…"
  env_key LINEAR_API_KEY "the gateway's Linear server has no key" "a personal API key: linear.app → Settings → Security & access"
}

# One key: reported when set, else prompted for without echo (a terminal only).
# $1 the key  $2 what breaks without it  $3 what to paste
env_key() {
  local k="$1"
  if grep -Eq "^$k=.+" "$ENV_FILE"; then ok "$k set"; return 0; fi
  warn "$k empty — $2"
  if [ "$CHECK" = 1 ] || [ ! -t 0 ]; then
    say "  ${c_dim}./scripts/bootstrap.sh env${c_0}   from a terminal, to be prompted"
    FAIL=1; return 0
  fi
  if confirm "enter $k ($3) now?"; then
    local v; read -rsp "  $k: " v; echo >&2
    [ -n "$v" ] || { warn "empty — nothing written"; FAIL=1; return 0; }
    write_env "$k" "$v"; ok "stored $k in $ENV_FILE"
  else FAIL=1; fi
}

# The MCP gateway (infra/compose.yaml): mcp-proxy with the upstream keys, serving Slack's
# and Linear's MCP servers on :9090 behind MCP_GATEWAY_TOKEN, minted here when absent.
# It moved here from Foundry's infra/; while foundry-mcp still holds the port this phase
# says so and stops, and never stops another project's container itself.
cmd_mcp() {
  info "mcp gateway"
  local names; names="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
  if printf '%s\n' "$names" | grep -qx argus-mcp && curl -fsS -m 3 "$MCP_URL/_readyz" >/dev/null 2>&1; then
    ok "argus-mcp ready ${c_dim}($MCP_URL)${c_0}"; return 0
  fi
  if printf '%s\n' "$names" | grep -qx foundry-mcp; then
    warn "foundry-mcp still serves :9090 — the gateway is argus's now: docker stop foundry-mcp, then ./scripts/bootstrap.sh mcp"
    FAIL=1; return 0
  fi
  { have docker && docker info >/dev/null 2>&1; } || { warn "docker unreachable — start OrbStack"; FAIL=1; return 0; }
  [ -f "$ENV_FILE" ] || { warn "$ENV_FILE missing — run the env phase first"; FAIL=1; return 0; }
  grep -Eq '^(SLACK_TOKEN|LINEAR_API_KEY)=.+' "$ENV_FILE" || { warn "no SLACK_TOKEN or LINEAR_API_KEY in $ENV_FILE — nothing to serve"; FAIL=1; return 0; }
  if [ "$CHECK" = 1 ]; then warn "argus-mcp not running — ./scripts/bootstrap.sh mcp"; FAIL=1; return 0; fi
  if ! grep -Eq '^MCP_GATEWAY_TOKEN=.+' "$ENV_FILE"; then
    have openssl || { warn "openssl missing — cannot mint MCP_GATEWAY_TOKEN"; FAIL=1; return 0; }
    write_env MCP_GATEWAY_TOKEN "$(openssl rand -hex 24)"
    ok "generated MCP_GATEWAY_TOKEN — Foundry's FOUNDRY_MCP_TOKEN must hold the same value"
  fi
  (cd "$ROOT/infra" && docker compose --env-file "$ENV_FILE" up -d --wait --wait-timeout 90) \
    || { warn "docker compose up failed — docker logs argus-mcp"; FAIL=1; return 0; }
  ok "argus-mcp ready ${c_dim}($MCP_URL)${c_0}"
}

# One key into .env, replacing an existing line for it — the same shape as Foundry's
# write_env against its own file. Atomic: a sibling temp file, then mv.
write_env() {
  local k="$1" v="$2" tmp; tmp="$(mktemp "$ROOT/.env.XXXXXX")"
  { [ -f "$ENV_FILE" ] && grep -v "^$k=" "$ENV_FILE"; printf '%s=%s\n' "$k" "$v"; } > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}

# A session's Linear and Slack MCP servers (.mcp.json) are the local gateway's (mcp-proxy
# on :9090, which holds the upstream keys); a session presents MCP_GATEWAY_TOKEN through
# scripts/mcp-headers.ts. The gateway must be up, the token set, and each server must
# answer `claude mcp get <name>` with Connected; its phrasing is advisory, so anything
# else is reported as-is.
MCP_URL="${MCP_GATEWAY_URL:-http://localhost:9090}"
cmd_check() {
  info "mcp servers"
  if curl -fsS -m 3 "$MCP_URL/_readyz" >/dev/null 2>&1; then ok "gateway ready ${c_dim}($MCP_URL)${c_0}"
  else warn "no MCP gateway at $MCP_URL — ./scripts/bootstrap.sh mcp"; FAIL=1; return 0; fi
  grep -Eq '^MCP_GATEWAY_TOKEN=.+' "$ENV_FILE" 2>/dev/null || { warn "MCP_GATEWAY_TOKEN empty in $ENV_FILE — the value of Foundry's FOUNDRY_MCP_TOKEN"; FAIL=1; return 0; }
  have claude || { warn "claude missing — run the prereqs phase first"; FAIL=1; return 0; }
  local s out
  for s in linear slack; do
    out="$(cd "$ROOT" && claude mcp get "$s" 2>&1 || true)"
    if printf '%s' "$out" | grep -q "Connected"; then ok "$s mcp connected ${c_dim}(claude mcp get $s)${c_0}"
    else warn "$s mcp not connected — claude mcp get $s said:"; printf '%s\n' "$out" | sed 's/^/    /' >&2; FAIL=1; fi
  done
}

summary() {
  say ""
  if [ "$FAIL" = 0 ]; then ok "host is ready"
  else warn "something is missing — see above"; fi
  say ""
  say "  bun run sweep               ${c_dim}# the loop: claude '/loop 15m /sweep' on Sonnet${c_0}"
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
  cmd_mcp
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
    env        the checkout's .env, created from .env.example; prompts for SLACK_TOKEN and LINEAR_API_KEY
    mcp        the MCP gateway (infra/compose.yaml) on :9090; mints MCP_GATEWAY_TOKEN when absent
    check      is the MCP gateway up, and are .mcp.json's linear and slack connected through it?

Secrets stay yours: this script never prints a token. So are the product
repos: nothing here knows a remote or clones one — the manifests say where a checkout
should be, and you put it there.
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
  mcp)      cmd_mcp;     summary ;;
  check)    cmd_check;   summary ;;
  *) die "unknown command '$1' (bootstrap.sh --help)" ;;
esac
