#!/usr/bin/env bash
# Ensure a static HTTP server is serving the office-hours output dir.
# Idempotent: if something is already listening on the port, do nothing.
#
# Usage: serve.sh [PORT] [ROOT]
#   PORT default 54321, ROOT default /tmp/office-hours
set -u
PORT="${1:-54321}"
ROOT="${2:-/tmp/office-hours}"
mkdir -p "$ROOT"

# Already listening? (bash /dev/tcp probe — no external deps)
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3>&- 3<&-
  echo "server already up: http://localhost:$PORT/"
  exit 0
fi

# Start our server (static files + POST /api/post) rooted at the output dir.
DIR="$(cd "$(dirname "$0")" && pwd)"
nohup python3 "$DIR/serve.py" "$PORT" "$ROOT" >"$ROOT/.server.log" 2>&1 &
disown 2>/dev/null || true
sleep 0.5
echo "started server (pid $!): http://localhost:$PORT/  (POST /api/post enabled)"
