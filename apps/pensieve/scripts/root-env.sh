#!/usr/bin/env bash
# root-env — run a command with Pensieve's settings from citadel's one .env.
#
# The root .env holds every app's keys, and an Ask run inherits Pensieve's environment, so
# only the keys Pensieve reads are exported: never the Slack token or the gateway token.
# A value already in the environment (the shell, or Pensieve's own .env, which Bun loads
# before a package script runs) wins.
set -euo pipefail
root_env="${CITADEL_ENV:-$(cd "$(dirname "$0")/../../.." && pwd)/.env}"
keys="LINEAR_API_KEY TRELLO_API_KEY TRELLO_TOKEN FOUNDRY_API_TOKEN FOUNDRY_URL WORKSPACE_DIR ARGUS_DIR PORT PENSIEVE_HOME ALDEN_FE_REPO ALDEN_BE_REPO ASK_DEBUG"
if [[ -f "$root_env" ]]; then
  for k in $keys; do
    if [[ -n "${!k:-}" ]]; then continue; fi
    v="$(grep -E "^$k=" "$root_env" | tail -1 | cut -d= -f2- || true)"
    if [[ -n "$v" ]]; then export "$k=$v"; fi
  done
fi
exec "$@"
