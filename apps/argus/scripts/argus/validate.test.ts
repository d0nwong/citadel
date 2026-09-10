/**
 * Every rule has a fixture that breaks it and nothing else, and the validator names that
 * fixture's path. The valid fixture passes against itself as `prev`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLedger } from "./schema.ts";
import { assertLedger, checkStyle, deriveReady, validateDoc, validateLedger, ValidationError } from "./validate.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const load = (name: string) => Bun.file(`${FIX}${name}`).json();

/** fixture → the path and a fragment of the rule it must trip, with nothing else tripped */
const RULES: Record<string, [path: string, rule: string]> = {
  "missing-evidence.json": ["ledger.requirements[0].evidence", "no evidence"],
  "missing-evidence-history.json": ["ledger.asks[0].history[1].evidence", "no evidence"],
  "missing-evidence-blocker.json": ["ledger.tickets[0].blockers[0].cleared.evidence", "no evidence"],
  "missing-evidence-story.json": ["ledger.story.health.evidence", "no evidence"],
  "assumption-on-confirmed.json": ["ledger.requirements[0].evidence[0]", "assumption is not evidence here"],
  "duplicate-id.json": ["ledger.asks[1].id", "appears twice"],
  "long-sentence.json": ["ledger.story.health.text", "over the 25-word ceiling"],
  "id-leading.json": ["ledger.story.health.text", "starts with an id"],
  "ready-with-blocker.json": ["ledger.tickets[0].ready", "ready must be false"],
  "dangling-requirement.json": ["ledger.asks[0].requirements", "R-99 is not a requirement"],
  "unknown-status.json": ["ledger.requirements[0].status", "expected one of"],
  "on-you-written.json": ["ledger.story.on_you", "derived"],
  "blocker-without-cleared.json": ["ledger.tickets[0].blockers[1].cleared", "expected an object or null"],
};

describe("validateLedger", () => {
  test("the valid fixture has no problems, alone and against itself", async () => {
    const v = await load("valid.json");
    expect(validateLedger(v)).toEqual([]);
    expect(validateLedger(v, { prev: parseLedger(v), actor: "model" })).toEqual([]);
  });

  for (const [name, [path, rule]] of Object.entries(RULES))
    test(`${name} trips only "${rule}" at ${path}`, async () => {
      const problems = validateLedger(await load(name));
      expect(problems).toHaveLength(1);
      expect(problems[0]?.path).toBe(path);
      expect(problems[0]?.rule).toContain(rule);
    });

  test("user evidence from the model is refused; from the user it is fine; carried over it is fine", async () => {
    const v = parseLedger(await load("valid.json"));
    const next = await load("user-evidence-from-model.json");
    const fromModel = validateLedger(next, { prev: v, actor: "model" });
    expect(fromModel.map((p) => p.path)).toEqual(["ledger.requirements[0].evidence[0]"]);
    expect(validateLedger(next, { prev: v, actor: "user" })).toEqual([]);
    expect(validateLedger(next, { prev: parseLedger(next), actor: "model" })).toEqual([]);
  });

  test("an id from the previous ledger cannot vanish or change origin, and a new id must be above the old maximum", async () => {
    const prev = parseLedger(await load("reused-id/prev.json"));
    const next = await load("reused-id/next.json");
    const rules = validateLedger(next, { prev }).map((p) => p.rule);
    expect(rules.some((r) => r.includes("A-3 changed origin"))).toBe(true);
    // and a next that dropped A-3 entirely
    const gone = { ...next, asks: next.asks.slice(0, 2) };
    expect(validateLedger(gone, { prev }).map((p) => p.rule)).toEqual(["A-3 was in the previous ledger and is gone; drop it instead"]);
    // and a next whose new ask reuses a number below the maximum
    const low = { ...next, asks: [...next.asks.slice(0, 2), { ...prev.asks[2], id: "A-4", status: "asked", history: [] }, { ...next.asks[2], id: "A-2" }] };
    expect(validateLedger(low, { prev }).some((p) => p.rule.includes("appears twice"))).toBe(true);
  });

  test("as_of cannot go backwards", async () => {
    const prev = parseLedger(await load("valid.json"));
    const older = await load("reused-id/older.json");
    expect(validateLedger(older, { prev }).map((p) => p.path)).toEqual(["ledger.as_of"]);
  });

  test("the model cannot reopen a closed ask; the user can", async () => {
    const prev = parseLedger(await load("valid.json"));
    const next = await load("valid.json");
    next.asks[0].status = "acknowledged";
    next.asks[0].history.pop();
    expect(validateLedger(next, { prev, actor: "model" }).map((p) => p.path)).toEqual(["ledger.asks[0].status"]);
    expect(validateLedger(next, { prev, actor: "user" })).toEqual([]);
  });

  test("an ask's status must agree with its history", async () => {
    const next = await load("valid.json");
    next.asks[1].status = "built";
    expect(validateLedger(next)[0]?.rule).toContain("no history");
    next.asks[1].status = "asked";
    next.asks[0].status = "built";
    expect(validateLedger(next)[0]?.rule).toContain("last history entry says closed");
  });

  test("assertLedger throws every problem at once", async () => {
    const next = await load("valid.json");
    next.requirements[0].evidence = [];
    next.story.health.evidence = [];
    expect(() => assertLedger(next)).toThrow(ValidationError);
    try {
      assertLedger(next);
    } catch (e) {
      expect((e as ValidationError).problems).toHaveLength(2);
    }
  });

  test("deriveReady repairs ready from the blockers", async () => {
    const l = parseLedger(await load("ready-with-blocker.json"));
    expect(validateLedger(deriveReady(l))).toEqual([]);
  });
});

describe("checkStyle", () => {
  test("clean prose passes", () => {
    expect(checkStyle("Sam landed the mailbox picker and the credit emails are going out.", "x")).toEqual([]);
  });
  test("an id at the start, a dialect word, and a long sentence each trip once", () => {
    expect(checkStyle("ALD-2 is done.", "x")).toHaveLength(1);
    expect(checkStyle("R-3 says so.", "x")).toHaveLength(1);
    expect(checkStyle("The next tick will do it.", "x")).toHaveLength(1);
    expect(checkStyle("One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty one two three four five six.", "x")).toHaveLength(1);
  });
  test("empty text is fine", () => expect(checkStyle("", "x")).toEqual([]));
});

describe("validateDoc", () => {
  test("refuses an arch doc over the cap and accepts one under it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-doc-"));
    const long = join(dir, "long.md");
    const short = join(dir, "short.md");
    writeFileSync(long, Array.from({ length: 251 }, (_, i) => `line ${i}`).join("\n") + "\n");
    // front matter, blank lines and generated regions do not count
    writeFileSync(short, "---\nid: x\n---\n" + Array.from({ length: 250 }, (_, i) => `line ${i}\n`).join("\n") + "<!-- accio:begin interfaces -->\n" + "generated\n".repeat(400) + "<!-- accio:end interfaces -->\n");
    expect(await validateDoc(long)).toHaveLength(1);
    expect(await validateDoc(short)).toEqual([]);
  });
});
