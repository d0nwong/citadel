# syntax=docker/dockerfile:1
# The sweep: Claude Code running argus's /sweep over argus's data, every SWEEP_INTERVAL seconds
# (infra/sweep/loop.sh). Built from citadel's root (compose's context is ../../..), so the
# workspace's bun.lock installs argus's dependencies — typescript, which accio's analyzer
# uses, and the tickets package (CTD-198), which reconcile reads Linear through.
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
COPY packages/tickets packages/tickets

FROM oven/bun:1.4-slim
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code && npm cache clean --force \
  && git config --system --add safe.directory '*'
WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/argus apps/argus
COPY --from=build /app/packages/tickets packages/tickets
# Claude refuses --dangerously-skip-permissions as root, so the sweep runs as the image's `bun`
# user (uid 1000). It trusts argus's directory, since nobody is here to accept the dialog; the
# linear and slack servers are approved in apps/argus/.claude/settings.json.
RUN mkdir -p /home/bun/git /home/bun/.claude \
  && printf '%s\n' '{"projects":{"/app/apps/argus":{"hasTrustDialogAccepted":true}}}' > /home/bun/.claude.json \
  && chown -R bun:bun /home/bun
USER bun
ENV HOME=/home/bun ARGUS_ROOT=/argus-data
WORKDIR /app/apps/argus
VOLUME ["/argus-data", "/home/bun/git", "/home/bun/.claude"]
ENTRYPOINT ["/app/apps/argus/infra/sweep/loop.sh"]
CMD ["loop"]
