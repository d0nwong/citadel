import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleKeys, parseEnv, setKey, writeKey } from "./bootstrap.ts";

test("parseEnv: KEY=value lines, the last wins, comments and blanks skipped, an empty value stays empty", () => {
  expect(parseEnv("# A=1\nA=2\n\nB=\nA=3\nnot a key\n")).toEqual({ A: "3", B: "" });
});

test("setKey: rewrites the key where it stands, drops its duplicates, appends a new one", () => {
  expect(setKey("# about A\nA=\nB=1\nA=old\n", "A", "x")).toBe("# about A\nA=x\nB=1\n");
  expect(setKey("B=1\n", "C", "2")).toBe("B=1\nC=2\n");
  expect(setKey("", "C", "2")).toBe("C=2\n");
});

test("writeKey: keeps the other lines and leaves the file mode 600", () => {
  const f = join(mkdtempSync(join(tmpdir(), "bootstrap-")), ".env");
  writeFileSync(f, "# keep\nA=1\n", { mode: 0o644 });
  writeKey(f, "B", "2");
  expect(readFileSync(f, "utf8")).toBe("# keep\nA=1\nB=2\n");
  expect(statSync(f).mode & 0o777).toBe(0o600);
});

test("exampleKeys: set and commented-out keys, never the prose", () => {
  expect(exampleKeys("# SLACK_TOKEN  what it is\nSLACK_TOKEN=\n# MCP_PORT=9090\n")).toEqual(new Set(["SLACK_TOKEN", "MCP_PORT"]));
});
