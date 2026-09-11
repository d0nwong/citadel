#!/usr/bin/env bash
# Runs as PID 1 on every container start. Wires up identity + credentials,
# then hands off to CMD.
set -euo pipefail

if [ -n "${GIT_AUTHOR_NAME:-}" ]; then
  git config --global user.name  "$GIT_AUTHOR_NAME"
  git config --global user.email "${GIT_AUTHOR_EMAIL:-dev@localhost}"
fi
git config --global init.defaultBranch main
git config --global --add safe.directory '*'

# Let git push over https using the injected GitHub token, if present.
if [ -n "${GH_TOKEN:-}" ]; then
  git config --global credential."https://github.com".helper '!f() { echo username=x-access-token; echo password=$GH_TOKEN; }; f'
fi

mkdir -p "$HOME/.claude"

# Refresh foundry-managed skills on every start so recreate picks up new
# versions; skills the user added themselves are left alone.
if [ -d /opt/foundry/skills ]; then
  mkdir -p "$HOME/.claude/skills"
  cp -R /opt/foundry/skills/. "$HOME/.claude/skills/"
fi

# MCP through the host gateway (infra/ `mcp` service). The forge holds a
# gateway token, never the upstream (Linear/Slack) credentials. The host says
# which upstreams it actually has via FOUNDRY_MCP_SERVERS; stale ones from a
# previous config are removed first. Registered at user scope so interactive
# sessions, `foundry run` and headless job runs all see it; ~/.claude.json
# lives in the container layer, so redo it on every start.
if [ -n "${FOUNDRY_MCP_URL:-}" ] && [ -n "${FOUNDRY_MCP_TOKEN:-}" ]; then
  for server in linear slack; do
    claude mcp remove -s user "$server" >/dev/null 2>&1 || true
  done
  IFS=',' read -ra servers <<< "${FOUNDRY_MCP_SERVERS:-linear}"
  for server in "${servers[@]}"; do
    claude mcp add-json -s user "$server" "$(jq -cn \
        --arg url "${FOUNDRY_MCP_URL%/}/$server/mcp" \
        --arg auth "Bearer $FOUNDRY_MCP_TOKEN" \
        '{type: "http", url: $url, headers: {Authorization: $auth}}')" >/dev/null \
      || echo "box-init: failed to register the $server MCP server" >&2
  done
fi

exec "$@"
