import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ENV_FILE, gatewayToken, resolveToken } from "./mcp-headers.ts";

test("gatewayToken: the value, unquoted; blank or absent is none; the last line wins", () => {
  expect(gatewayToken("SLACK_TOKEN=x\nMCP_GATEWAY_TOKEN=abc\n")).toBe("abc");
  expect(gatewayToken('MCP_GATEWAY_TOKEN="q"')).toBe("q");
  expect(gatewayToken("MCP_GATEWAY_TOKEN=\n")).toBeUndefined();
  expect(gatewayToken("SLACK_TOKEN=x")).toBeUndefined();
  expect(gatewayToken("MCP_GATEWAY_TOKEN=a\nMCP_GATEWAY_TOKEN=b")).toBe("b");
});

test("resolveToken: the environment, then the secret file, then the .env; a blank falls through", () => {
  expect(resolveToken({ MCP_GATEWAY_TOKEN: "env" }, "secret", "MCP_GATEWAY_TOKEN=file")).toBe("env");
  expect(resolveToken({}, "secret\n", "MCP_GATEWAY_TOKEN=file")).toBe("secret");
  expect(resolveToken({ MCP_GATEWAY_TOKEN: " " }, "  ", "MCP_GATEWAY_TOKEN=file")).toBe("file");
  expect(resolveToken({}, undefined, undefined)).toBeUndefined();
});

test("ENV_FILE is the citadel root's .env", async () => {
  const pkg = join(dirname(ENV_FILE), "package.json");
  expect(existsSync(pkg)).toBe(true);
  expect((await Bun.file(pkg).json()).name).toBe("citadel");
});
