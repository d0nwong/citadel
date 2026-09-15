#!/usr/bin/env bash
# serve — share the web dev server with the rest of your tailnet.
# Driven from citadel's root: `just serve-app foundry up|down|status|url`.
set -euo pipefail

PORT="${FOUNDRY_WEB_PORT:-3777}"   # matches `vite dev --port 3777`

c_dim=$'\033[2m'; c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_bld=$'\033[1m'; c_0=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
info() { printf '%s==>%s %s\n' "$c_bld" "$c_0" "$*" >&2; }
ok()   { printf '%s ok %s %s\n' "$c_grn" "$c_0" "$*" >&2; }
warn() { printf '%s warn%s %s\n' "$c_yel" "$c_0" "$*" >&2; }
die()  { printf '%sserve:%s %s\n' "$c_red" "$c_0" "$*" >&2; exit 1; }

require_tailscale() {
  command -v tailscale >/dev/null 2>&1 || die "'tailscale' not found on PATH"
  tailscale status --json 2>/dev/null | grep -q '"BackendState": "Running"' \
    || die "tailscale is not running — start the app and log in"
}

# The node's own MagicDNS name, minus the trailing dot. Parsed rather than piped
# through jq, which is not on every Mac.
ts_host() {
  tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\(.*\)\.".*/\1/p' | head -1
}

serve_url() {
  local host; host="$(ts_host)"
  [ -n "$host" ] || die "could not read this node's MagicDNS name"
  printf 'https://%s' "$host"
}

cmd_up() {
  require_tailscale
  # Serve config can legitimately precede the dev server, so this is a nudge.
  nc -z localhost "$PORT" >/dev/null 2>&1 || warn "nothing listening on :$PORT yet ${c_dim}(cd web && bun run dev)${c_0}"
  info "serving localhost:$PORT to the tailnet"
  # The full URL, not a bare port: a bare port is normalised to 127.0.0.1, and
  # `vite dev` binds ::1 only — which proxies as a 502. "localhost" is resolved
  # per request instead, so it reaches whichever family vite actually got.
  tailscale serve --bg "http://localhost:$PORT" >/dev/null
  ok "$(serve_url)  ${c_dim}(tailnet only — not public)${c_0}"
  say ""
  say "  ${c_dim}just serve-app foundry down   # stop sharing${c_0}"
}

cmd_down() {
  require_tailscale
  # `off` targets just the https:443 handler. Older/newer CLIs have shuffled
  # this syntax about, so fall back to reset — which clears *everything* the
  # node serves, hence the warning.
  if tailscale serve --https=443 off >/dev/null 2>&1; then
    ok "stopped serving"
  else
    warn "'serve --https=443 off' rejected — falling back to 'serve reset'"
    warn "that clears every serve handler on this node, not just foundry's"
    tailscale serve reset >/dev/null
    ok "serve config reset"
  fi
}

cmd_status() { require_tailscale; tailscale serve status; }
cmd_url()    { require_tailscale; printf '%s\n' "$(serve_url)"; }

usage() {
cat >&2 <<'USAGE'
serve — share the foundry web UI over tailscale

  just serve-app foundry up        share localhost:3777 with your tailnet over HTTPS
  just serve-app foundry down      stop sharing
  just serve-app foundry status    what this node is currently serving
  just serve-app foundry url       print the https URL (for scripts)

Tailnet only — nothing here exposes the dev server to the public internet.
`tailscale funnel` does that, deliberately by hand.

Override the port with FOUNDRY_WEB_PORT.
USAGE
}

case "${1:-}" in
  up)      shift; cmd_up "$@" ;;
  down)    shift; cmd_down "$@" ;;
  status)  shift; cmd_status "$@" ;;
  url)     shift; cmd_url "$@" ;;
  ""|-h|--help|help) usage ;;
  *) die "unknown command '$1' (serve.sh --help)" ;;
esac
