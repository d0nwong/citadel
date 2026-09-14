# syntax=docker/dockerfile:1
# Built from citadel's root (compose's context is ../..): the workspace's one bun.lock
# installs it, and argus's code comes along, because Pensieve runs argus's verbs and Ask
# works in argus's directory — argus's own dependencies (the tickets package included,
# CTD-198) come with it.
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/argus/package.json apps/argus/
COPY apps/foundry/package.json apps/foundry/
COPY apps/foundry/web/package.json apps/foundry/web/
COPY apps/pensieve/package.json apps/pensieve/
COPY packages/tickets/package.json packages/tickets/
RUN bun install --frozen-lockfile
COPY apps/argus apps/argus
COPY apps/pensieve apps/pensieve
COPY packages/tickets packages/tickets
RUN cd apps/pensieve && bun run build

FROM oven/bun:1.4-slim
# Ask spawns the `claude` CLI — a node program — and the adapter's node runner, and lets
# it run `git log` / `git show` over argus's data and the product checkouts, which are
# mounted and owned by the host's user, hence the system-wide safe.directory.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code && npm cache clean --force \
  && git config --system --add safe.directory '*'
# argus's .mcp.json reaches Slack and Linear through a headersHelper, which Claude Code runs
# only in a trusted folder; nobody is here to accept the dialog, so the image trusts argus.
RUN printf '%s\n' '{"projects":{"/app/apps/argus":{"hasTrustDialogAccepted":true}}}' > /root/.claude.json
WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/argus apps/argus
COPY --from=build /app/packages/tickets packages/tickets
COPY --from=build /app/apps/pensieve/package.json apps/pensieve/
COPY --from=build /app/apps/pensieve/node_modules apps/pensieve/node_modules
COPY --from=build /app/apps/pensieve/dist apps/pensieve/dist
COPY --from=build /app/apps/pensieve/server.ts apps/pensieve/
WORKDIR /app/apps/pensieve
ENV NODE_ENV=production PORT=3778 WORKSPACE_DIR=/argus-data ARGUS_DIR=/app/apps/argus PENSIEVE_HOME=/data
# argus's data is mounted, never baked in: it changes every sweep tick. /data is Ask's
# conversations; /root/.claude holds the transcripts a conversation resumes from.
VOLUME ["/argus-data", "/data", "/root/.claude"]
EXPOSE 3778
CMD ["bun", "server.ts"]
