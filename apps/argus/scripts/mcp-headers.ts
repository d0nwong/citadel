#!/usr/bin/env bun
/**
 * mcp-headers — the MCP gateway's Authorization header, for `.mcp.json`'s `headersHelper`.
 *
 * Claude Code runs this at connect time for the `linear` and `slack` servers, which reach
 * Linear's and Slack's hosted MCP servers through the local gateway (mcp-proxy, :9090).
 * The gateway holds the upstream keys; a session presents only MCP_GATEWAY_TOKEN. A
 * container gets it as an environment variable; on a host it is read from citadel's one
 * .env at the repo root (resolved from this file, not the cwd), so nothing is exported into
 * the shell. Prints one JSON object on stdout and nothing else.
 */

import { join } from "node:path";

/** citadel's one .env: apps/argus/scripts → the repo root */
export const ENV_FILE = join(import.meta.dir, "..", "..", "..", ".env");

/** MCP_GATEWAY_TOKEN from .env text; a blank value is no token */
export function gatewayToken(text: string): string | undefined {
  let token: string | undefined;
  for (const line of text.split("\n")) {
    const m = /^MCP_GATEWAY_TOKEN=(.*)$/.exec(line.trim());
    if (m) token = m[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return token;
}

/** the environment wins (a container), then the file (a host) */
export function resolveToken(env: Record<string, string | undefined>, fileText: string | undefined): string | undefined {
  return env.MCP_GATEWAY_TOKEN?.trim() || (fileText === undefined ? undefined : gatewayToken(fileText));
}

if (import.meta.main) {
  const f = Bun.file(ENV_FILE);
  const token = resolveToken(process.env, (await f.exists()) ? await f.text() : undefined);
  if (!token) {
    console.error(`MCP_GATEWAY_TOKEN is not set in the environment or in ${ENV_FILE}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ Authorization: `Bearer ${token}` }));
}
