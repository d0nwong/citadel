# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3778 WORKSPACE_DIR=/workspace PENSIEVE_HOME=/data
# Ask spawns the `claude` CLI — a node program — and the adapter's node runner, and lets
# it run `git log` / `git show` over the checkout. Same Debian base as the node image.
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
  && npm install -g @anthropic-ai/claude-code && npm cache clean --force
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY server.ts ./
# The blackboard is mounted, never baked in — it changes every sweep tick. The sweep owns
# every file in it except decisions/, which this app writes (see compose.yaml). /data is
# Ask's own state: one conversation per file.
VOLUME ["/workspace", "/data"]
EXPOSE 3778
CMD ["bun", "server.ts"]
