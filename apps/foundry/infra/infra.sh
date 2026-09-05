#!/usr/bin/env bash
# infra — the local development stack behind foundry (postgres, for now).
# Driven from the repo root: `bun run infra:up`, `infra:down`, `infra:psql`, …
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVFILE="$HERE/.env"
EXAMPLE="$HERE/.env.example"
# foundry's credential store (`foundry auth`), in two files: the gateway token
# in ~/.foundry/env, the upstream keys in the shared ~/.config/liamai/env that
# argus and Pensieve read too (LIAMAI_ENV overrides the path). Never infra/.env.
FOUNDRY_ENV="${FOUNDRY_HOME:-$HOME/.foundry}/env"
SHARED_ENV="${LIAMAI_ENV:-$HOME/.config/liamai/env}"
SERVICE=postgres

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_bld=$'\033[1m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$c_bld" "$c_0" "$*" >&2; }
ok()   { printf '%s ok %s %s\n' "$c_grn" "$c_0" "$*" >&2; }
warn() { printf '%s warn%s %s\n' "$c_yel" "$c_0" "$*" >&2; }
die()  { printf '%sinfra:%s %s\n' "$c_red" "$c_0" "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || die "'docker' not found on PATH"
  docker info >/dev/null 2>&1 || die "docker daemon unreachable — is OrbStack running?"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 required"
}

ensure_env() {
  [ -f "$ENVFILE" ] && return 0
  cp "$EXAMPLE" "$ENVFILE"
  info "created infra/.env from .env.example ${c_dim}(gitignored)${c_0}"
}

# Read a key from infra/.env, falling back to the compose default.
env_get() {
  local key="$1" fallback="$2" val=""
  [ -f "$ENVFILE" ] && val=$(grep -E "^${key}=" "$ENVFILE" | tail -1 | cut -d= -f2- || true)
  printf '%s' "${val:-$fallback}"
}

# Export both env files into this process so compose can expand the upstream
# keys (${LINEAR_API_KEY}, ${SLACK_TOKEN}) and ${FOUNDRY_MCP_TOKEN} for the
# gateway. The shared file is sourced last so its value wins on a clash.
# Values stay out of infra/.env.
load_foundry_env() {
  local f
  for f in "$FOUNDRY_ENV" "$SHARED_ENV"; do
    if [ -f "$f" ]; then
      # shellcheck disable=SC1090
      set -a; . "$f"; set +a
    fi
  done
}

# The gateway only makes sense with an upstream credential behind it, so the
# `mcp` profile follows the upstream keys (Linear and/or Slack) rather than a flag.
mcp_enabled() { [ -n "${LINEAR_API_KEY:-}${SLACK_TOKEN:-}" ] && [ -n "${FOUNDRY_MCP_TOKEN:-}" ]; }
mcp_port()    { env_get MCP_PORT 9090; }

pg_user() { env_get POSTGRES_USER foundry; }
pg_db()   { env_get POSTGRES_DB   foundry; }
pg_port() { env_get POSTGRES_PORT 5432; }
pg_url()  { printf 'postgresql://%s:%s@localhost:%s/%s' \
              "$(pg_user)" "$(env_get POSTGRES_PASSWORD foundry)" "$(pg_port)" "$(pg_db)"; }

# Everything runs with infra/ as the compose project directory, so relative
# paths in compose.yaml and the .env pickup both behave.
dc() { (cd "$HERE" && docker compose "$@"); }
# Every profile, for the commands that must see the whole stack (down, ps, logs).
dc_all() { dc --profile mcp "$@"; }

cmd_up() {
  require_docker; ensure_env; load_foundry_env
  mcp_enabled && export COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}mcp"
  info "starting the foundry stack"
  dc up -d --wait --wait-timeout 90 "$@"
  ok "postgres ready on port $(pg_port)  ${c_dim}(postgres.foundry.local)${c_0}"
  if mcp_enabled; then
    ok "mcp gateway on http://localhost:$(mcp_port)  ${c_dim}(mcp.foundry.local; forges use host.docker.internal:$(mcp_port))${c_0}"
  else
    say "  ${c_dim}mcp gateway not started — 'foundry auth --linear' (or --slack) gives forges access${c_0}"
  fi
  say ""
  say "  DATABASE_URL=$(pg_url)"
  say "  ${c_dim}bun run infra:psql   # a psql shell in the container${c_0}"
}

cmd_down() {
  require_docker
  local purge=0
  for a in "$@"; do [ "$a" = "--purge" ] && purge=1; done
  if [ "$purge" = 1 ]; then
    dc_all down -v
    ok "stack down, ${c_bld}data volume deleted${c_0}"
  else
    dc_all down
    ok "stack down ${c_dim}(data kept in the foundry-pgdata volume; --purge to delete)${c_0}"
  fi
}

cmd_reset() {
  require_docker
  warn "this deletes every row in the local database"
  cmd_down --purge
  cmd_up
}

cmd_status() {
  require_docker
  dc_all ps
  if [ "$(dc ps -q "$SERVICE" 2>/dev/null)" != "" ]; then
    say ""
    say "  DATABASE_URL=$(pg_url)"
  fi
  if [ "$(dc_all ps -q mcp 2>/dev/null)" != "" ]; then
    say "  MCP gateway: http://localhost:$(mcp_port)/_readyz"
  fi
}

cmd_logs()  { require_docker; dc_all logs -f --tail 100 "${@:-$SERVICE}"; }
cmd_url()   { printf '%s\n' "$(pg_url)"; }

cmd_psql() {
  require_docker
  [ -n "$(dc ps -q "$SERVICE" 2>/dev/null)" ] || die "postgres is not running — bun run infra:up"
  dc exec "$SERVICE" psql -U "$(pg_user)" -d "$(pg_db)" ${@+"$@"}
}

usage() {
cat >&2 <<'USAGE'
infra — foundry's local development stack

  bun run infra:up                start it (waits until postgres is healthy)
  bun run infra:down [-- --purge] stop it; --purge also deletes the data volume
  bun run infra:reset             wipe the database and start clean
  bun run infra:status            what is running, and the connection string
  bun run infra:logs [-- mcp]     tail postgres (or the MCP gateway) logs
  bun run infra:psql              psql shell inside the container
  bun run infra:url               print DATABASE_URL (for scripts / .env files)

Settings live in infra/.env, created from infra/.env.example on first up.
The MCP gateway (service "mcp") starts alongside postgres once `foundry auth
--linear` (or `foundry auth --slack`) has stored an upstream key in the shared
~/.config/liamai/env (LIAMAI_ENV) and the gateway token in ~/.foundry/env.
USAGE
}

case "${1:-}" in
  up)      shift; cmd_up "$@" ;;
  down)    shift; cmd_down "$@" ;;
  reset)   shift; cmd_reset "$@" ;;
  status)  shift; cmd_status "$@" ;;
  logs)    shift; cmd_logs "$@" ;;
  psql)    shift; cmd_psql "$@" ;;
  url)     shift; cmd_url "$@" ;;
  ""|-h|--help|help) usage ;;
  *) die "unknown command '$1' (infra.sh --help)" ;;
esac
