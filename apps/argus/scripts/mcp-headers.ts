#!/usr/bin/env bun
/**
 * mcp-headers — the MCP gateway's Authorization header, for `.mcp.json`'s `headersHelper`.
 *
 * Claude Code runs this at connect time for the `linear` and `slack` servers, which reach
 * Linear's and Slack's hosted MCP servers through the local gateway (mcp-proxy, :9090).
 * The gateway holds the upstream keys; a session presents only MCP_GATEWAY_TOKEN, read
 * here from the checkout's own .env (resolved from this file, not the cwd), so nothing is
 * exported into the shell. Prints one JSON object on stdout and nothing else.
 */

import { join } from "node:path";

export const ENV_FILE = join(import.meta.dir, "..", ".env");

/** MCP_GATEWAY_TOKEN from .env text; a blank value is no token */
export function gatewayToken(text: string): string | undefined {
  let token: string | undefined;
  for (const line of text.split("\n")) {
    const m = /^MCP_GATEWAY_TOKEN=(.*)$/.exec(line.trim());
    if (m) token = m[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return token;
}

if (import.meta.main) {
  const f = Bun.file(ENV_FILE);
  const token = (await f.exists()) ? gatewayToken(await f.text()) : undefined;
  if (!token) {
    console.error(`MCP_GATEWAY_TOKEN is not set in ${ENV_FILE} — ./scripts/bootstrap.sh env`);
    process.exit(1);
  }
  console.log(JSON.stringify({ Authorization: `Bearer ${token}` }));
}
