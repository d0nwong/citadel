#!/usr/bin/env bash
# argus-env — run a command with LINEAR_API_KEY from argus's .env when the environment
# lacks it.
#
# argus's .env is the one place the upstream keys live (it feeds the MCP gateway), and
# Pensieve reads LINEAR_API_KEY from its environment and nowhere else (LIA-113 AC2). So
# this puts that one key into the environment and execs the command. Bun has loaded
# Pensieve's own .env before a package script runs, so a key set there, or in the shell,
# still wins. Nothing else from argus's .env is exported: an Ask run inherits this
# environment, and the Slack token has no business in it.
set -euo pipefail
argus_env="${WORKSPACE_DIR:-$HOME/git/argus}/.env"
if [[ -z "${LINEAR_API_KEY:-}" && -f "$argus_env" ]]; then
  key="$(grep -E '^LINEAR_API_KEY=' "$argus_env" | tail -1 | cut -d= -f2- || true)"
  if [[ -n "$key" ]]; then export LINEAR_API_KEY="$key"; fi
fi
exec "$@"
