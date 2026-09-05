import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv, sharedEnv } from "./shared-env.ts";

describe("parseEnv — the KEY=value shape shared with ~/.foundry/env", () => {
  test("one key per line, comments and blanks skipped, value kept verbatim", () => {
    const env = parseEnv(`# shared credentials
SLACK_TOKEN=xoxp-1-2-3

LINEAR_API_KEY=lin_api_abc=def
lowercase=ignored
not a line
`);
    expect(env).toEqual({ SLACK_TOKEN: "xoxp-1-2-3", LINEAR_API_KEY: "lin_api_abc=def" });
  });
  test("a later line for the same key wins (write_env appends the replacement)", () => {
    expect(parseEnv("A=1\nA=2\n").A).toBe("2");
  });
});

describe("sharedEnv — the file on disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-env-"));
  const file = join(dir, "env");
  writeFileSync(file, "SLACK_TOKEN=xoxp-test\n");
  test("reads the given path", () => {
    expect(sharedEnv(file).SLACK_TOKEN).toBe("xoxp-test");
  });
  test("a missing file is an empty object, not an error", () => {
    expect(sharedEnv(join(dir, "nope"))).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});
