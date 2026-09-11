#!/usr/bin/env bun
/**
 * mcp-headers — the MCP gateway's Authorization header, for `.mcp.json`'s `headersHelper`.
 *
 * Claude Code runs this at connect time for the `linear` and `slack` servers, which reach
 * Linear's and Slack's hosted MCP servers through the local gateway (mcp-proxy, :9090).
 * The gateway holds the upstream keys; a session presents only MCP_GATEWAY_TOKEN. Claude Code
 * runs this helper without any variable that looks like a secret, so the token comes from a
 * file: the secret compose mounts in a container, or citadel's one .env at the repo root on a
 * host (resolved from this file, not the cwd), so nothing is exported into the shell. Prints
 * one JSON object on stdout and nothing else.
 */

import { join } from "node:path";

/** citadel's one .env: apps/argus/scripts → the repo root */
export const ENV_FILE = join(import.meta.dir, "..", "..", "..", ".env");

/** Where compose mounts the token in a container (a `secrets:` entry). */
export const SECRET_FILE = "/run/secrets/mcp_gateway_token";

/** MCP_GATEWAY_TOKEN from .env text; a blank value is no token */
export function gatewayToken(text: string): string | undefined {
  let token: string | undefined;
  for (const line of text.split("\n")) {
    const m = /^MCP_GATEWAY_TOKEN=(.*)$/.exec(line.trim());
    if (m) token = m[1]!.trim().replace(/^(["'])(.*)\1$/, "$2") || undefined;
  }
  return token;
}

/**
 * The environment (a caller other than Claude Code, which strips it), then the secret file (a
 * container), then the .env (a host). A blank anywhere falls through.
 */
export function resolveToken(
  env: Record<string, string | undefined>,
  secretText: string | undefined,
  envFileText: string | undefined
): string | undefined {
  return env.MCP_GATEWAY_TOKEN?.trim() || secretText?.trim() || (envFileText === undefined ? undefined : gatewayToken(envFileText));
}

if (import.meta.main) {
  const read = async (path: string) => {
    const f = Bun.file(path);
    return (await f.exists()) ? await f.text() : undefined;
  };
  const token = resolveToken(process.env, await read(SECRET_FILE), await read(ENV_FILE));
  if (!token) {
    console.error(`no MCP_GATEWAY_TOKEN in ${SECRET_FILE}, ${ENV_FILE} or the environment`);
    process.exit(1);
  }
  console.log(JSON.stringify({ Authorization: `Bearer ${token}` }));
}
