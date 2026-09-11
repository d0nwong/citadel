import { expect, test } from "bun:test";
import { gatewayToken } from "./mcp-headers.ts";

test("gatewayToken: the value, unquoted; blank or absent is none; the last line wins", () => {
  expect(gatewayToken("SLACK_TOKEN=x\nMCP_GATEWAY_TOKEN=abc\n")).toBe("abc");
  expect(gatewayToken('MCP_GATEWAY_TOKEN="q"')).toBe("q");
  expect(gatewayToken("MCP_GATEWAY_TOKEN=\n")).toBeUndefined();
  expect(gatewayToken("SLACK_TOKEN=x")).toBeUndefined();
  expect(gatewayToken("MCP_GATEWAY_TOKEN=a\nMCP_GATEWAY_TOKEN=b")).toBe("b");
});
