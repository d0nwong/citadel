# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3778 WORKSPACE_DIR=/workspace
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY server.ts ./
# the blackboard is mounted, never baked in — it changes every sweep tick
VOLUME ["/workspace"]
EXPOSE 3778
CMD ["bun", "server.ts"]
