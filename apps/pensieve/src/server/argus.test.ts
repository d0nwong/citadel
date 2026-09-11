/**
 * The CLI spawner against a stub `scripts/argus.ts` in a temp directory: the JSON answer
 * comes back as data, a refusal comes back as problems, a crash comes back as an error,
 * and nothing throws.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argus, argusNote } from "./argus";

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "pensieve-argus-"));
  await mkdir(join(cwd, "scripts"), { recursive: true });
  await writeFile(
    join(cwd, "scripts/argus.ts"),
    `const [verb, ...rest] = process.argv.slice(2);
if (verb === "close") { console.log("noise line"); console.log(JSON.stringify({ ok: true, wrote: true, diff: ["A-2 asked → closed"], args: rest })); process.exit(0); }
if (verb === "write") { console.log(JSON.stringify({ ok: false, problems: [{ path: "ledger.asks[0].text", rule: "over the ceiling" }] })); process.exit(1); }
if (verb === "hang") { await Bun.sleep(5000); }
console.error("argus: unknown verb"); process.exit(1);`
  );
});
afterEach(() => rm(cwd, { force: true, recursive: true }));

describe("argus", () => {
  test("a verb's json answer, with --json appended and the args passed through", async () => {
    const r = await argus<{ diff: string[]; args: string[]; wrote: boolean }>(
      "close",
      ["admin/invoicing", "A-2", "--reason", "done"],
      { cwd }
    );
    expect(r).toEqual({
      args: ["admin/invoicing", "A-2", "--reason", "done", "--json"],
      diff: ["A-2 asked → closed"],
      ok: true,
      wrote: true,
    });
    expect(argusNote(r)).toBeNull();
  });
  test("a refusal is data", async () => {
    const r = await argus("write", ["tasks", "-"], { cwd });
    expect(r.ok).toBe(false);
    expect(argusNote(r)).toBe("ledger.asks[0].text: over the ceiling");
  });
  test("an unknown verb and a hang are errors, not exceptions", async () => {
    const r = await argus("frobnicate", [], { cwd });
    expect(r).toEqual({ error: "argus: unknown verb", ok: false });
    const h = await argus("hang", [], { cwd, timeoutMs: 300 });
    expect(h.ok).toBe(false);
    expect(argusNote(h)).toContain("longer than");
  });
});
