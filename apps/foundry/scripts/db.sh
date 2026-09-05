#!/usr/bin/env bash
# db — the app schema, from the repo root and without going through bun run.
# The migrations themselves are TypeScript (web/src/db/), so bun still executes
# them; this is the shell entry point, matching infra.sh and web/serve.sh, so a
# fresh machine can be set up with shell scripts alone.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WEB="$ROOT/web"

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_bld=$'\033[1m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$c_bld" "$c_0" "$*" >&2; }
ok()   { printf '%s ok %s %s\n' "$c_grn" "$c_0" "$*" >&2; }
die()  { printf '%sdb:%s %s\n' "$c_red" "$c_0" "$*" >&2; exit 1; }

require() {
  command -v bun >/dev/null 2>&1 || die "'bun' not found on PATH"
  [ -d "$WEB/node_modules" ] || die "web deps not installed — run: (cd web && bun install)"
}

# Every command runs with web/ as cwd: bun picks up web/.env from there, which
# is where DATABASE_URL lives (falling back to the local stack's URL).
web() { (cd "$WEB" && "$@"); }

cmd_migrate() {
  require
  info "applying migrations"
  web bun run src/db/migrate.ts "$@"
  ok "schema up to date"
}

cmd_generate() {
  require
  info "generating a migration from src/db/schema.ts"
  web bunx drizzle-kit generate "$@"
  say "${c_dim}commit the new file in web/src/db/migrations/${c_0}"
}

cmd_studio() { require; web bunx drizzle-kit studio "$@"; }

cmd_url() { "$ROOT/infra/infra.sh" url; }

usage() {
cat >&2 <<'USAGE'
db — the foundry app schema

  ./scripts/db.sh migrate     apply web/src/db/migrations (idempotent; safe to rerun)
  ./scripts/db.sh generate    schema.ts -> a new migration file; commit it
  ./scripts/db.sh studio      drizzle studio
  ./scripts/db.sh url         print DATABASE_URL for the local stack

Needs postgres up: ./infra/infra.sh up
USAGE
}

case "${1:-}" in
  migrate)  shift; cmd_migrate "$@" ;;
  generate) shift; cmd_generate "$@" ;;
  studio)   shift; cmd_studio "$@" ;;
  url)      shift; cmd_url "$@" ;;
  ""|-h|--help|help) usage ;;
  *) die "unknown command '$1' (db.sh --help)" ;;
esac
