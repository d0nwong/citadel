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

exec "$@"
