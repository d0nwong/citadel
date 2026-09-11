#!/usr/bin/env bash
# Serve pensieve to the tailnet over HTTPS via `tailscale serve`.
#
#   scripts/serve.sh          production: build if needed, bun server.ts, proxy it
#   scripts/serve.sh dev      vite dev server (HMR works through the proxy)
#   scripts/serve.sh status   show what tailscale serve is currently exposing
#   scripts/serve.sh stop     undo a serve: kill running serve.sh trees + the proxy on our port
#
# Tailnet-only on purpose: the blackboard is private, so this never enables Funnel.
# The app runs in the background; `tailscale serve` runs in the foreground and both are
# torn down together on Ctrl-C. Reads PORT from .env (default 3778).
#
# Listens on https://<host>.ts.net:$TS_HTTPS_PORT (default = PORT) rather than 443, so it
# coexists with whatever else this node already serves on 443. TS_HTTPS_PORT=443 to take
# the root URL instead.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
PORT="${PORT:-3778}"
TS_HTTPS_PORT="${TS_HTTPS_PORT:-$PORT}"
MODE="${1:-start}"

die() { echo "serve: $*" >&2; exit 1; }

# Kill a process and its descendants. Needed because `bun run dev` spawns vite, and the
# macOS `tailscale` CLI is an sh wrapper around Tailscale.app's binary — killing only the
# direct child would orphan the real listener / proxy.
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

command -v tailscale >/dev/null || die "tailscale CLI not found"
command -v bun >/dev/null || die "bun not found"

stop() {
  local pid found=0
  # Running serve.sh instances (not this one): killing the tree runs their cleanup too.
  for pid in $(pgrep -f '[/]serve\.sh( |$)' 2>/dev/null); do
    [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
    echo "serve: stopping serve.sh ($pid)"; kill_tree "$pid"; found=1
  done
  # Orphaned proxies on our port (serve.sh died without its trap running).
  for pid in $(pgrep -f "tailscale serve --https=${TS_HTTPS_PORT} " 2>/dev/null); do
    echo "serve: stopping stray proxy ($pid)"; kill_tree "$pid"; found=1
  done
  # Only our port's mapping — never `serve reset`, which would drop everything else on this node.
  tailscale serve --https="${TS_HTTPS_PORT}" off >/dev/null 2>&1 || true
  sleep 0.5
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "serve: note — something not started by serve.sh still listens on :$PORT (left alone):"
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tail -n +2
  fi
  (( found )) && echo "serve: stopped" || echo "serve: nothing to stop"
}

case "$MODE" in
  status) exec tailscale serve status ;;
  stop)   stop; exit 0 ;;
  start|dev) ;;
  *) die "unknown mode '$MODE' (expected start | dev | status | stop)" ;;
esac

tailscale status --json 2>/dev/null | grep -q '"BackendState": *"Running"' \
  || die "tailscale is not running / logged in (try: tailscale up)"

dns_name="$(tailscale status --json | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
[[ -n "$dns_name" ]] || die "no MagicDNS name for this node — enable MagicDNS + HTTPS in the tailnet admin"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use — stop that process or set PORT (the proxy must point at *this* app)"
fi

if [[ "$MODE" == "start" ]]; then
  if [[ ! -f dist/server/server.js ]]; then
    echo "serve: no dist/ — running bun run build"
    bun run build
  fi
  scripts/argus-env.sh bun server.ts &
else
  bun run dev &
fi
app_pid=$!
ts_pid=""
cleanup() {
  trap - EXIT INT TERM
  [[ -n "$ts_pid" ]] && kill_tree "$ts_pid"
  kill_tree "$app_pid"
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

# Wait for the app to listen before exposing it; bail if it died instead (bad build, etc.).
for _ in $(seq 1 60); do
  kill -0 "$app_pid" 2>/dev/null || die "app exited before it started listening on $PORT"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 0.5
done
lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || die "app did not start listening on $PORT within 30s"

echo
url="https://${dns_name}"; [[ "$TS_HTTPS_PORT" == 443 ]] || url="${url}:${TS_HTTPS_PORT}"
echo "pensieve ($MODE) → ${url}/   (local http://localhost:${PORT})"
echo "Ctrl-C stops both the app and the tailscale proxy."
echo

# Non-`--bg` serve: the mapping lives only as long as this process. Backgrounded and
# waited on so bash can handle Ctrl-C / kill promptly and tear down both children.
tailscale serve --https="${TS_HTTPS_PORT}" "http://127.0.0.1:${PORT}" &
ts_pid=$!
wait "$ts_pid"
