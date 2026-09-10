/**
 * The ledger's shape. `parseLedger` accepts the valid fixture and every rule fixture (those
 * are structurally fine and `validate.ts` refuses them), and refuses the shape fixtures by
 * path. `emptyLedger` is a valid ledger. `serializeLedger` round-trips.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { emptyLedger, parseLedger, SchemaError, serializeLedger, STORY_KEYS } from "./schema.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const load = (name: string) => Bun.file(`${FIX}${name}`).json();

const SHAPE_FIXTURES: Record<string, string> = {
  "unknown-status.json": "ledger.requirements[0].status",
  "on-you-written.json": "ledger.story.on_you",
  "blocker-without-cleared.json": "ledger.tickets[0].blockers[1].cleared",
};

describe("parseLedger", () => {
  test("accepts the valid fixture and keeps every field", async () => {
    const raw = await load("valid.json");
    const l = parseLedger(raw);
    expect(l.feature).toBe("admin/invoicing");
    expect(Object.keys(l.story)).toEqual([...STORY_KEYS]);
    expect(l.requirements.map((r) => r.id)).toEqual(["R-1", "R-2", "R-3"]);
    expect(l.asks[0]?.history).toHaveLength(3);
    expect(l.tickets[0]?.blockers[0]?.kind).toBe("landing");
    expect(l.proposals[0]?.kind).toBe("ticket");
    expect(JSON.parse(serializeLedger(l))).toEqual(raw);
  });

  test("story has no on_you field to write", () => {
    expect("on_you" in emptyLedger("x").story).toBe(false);
  });

  test("an empty ledger parses", () => {
    const e = emptyLedger("tasks", "Tasks and subtasks.", "2026-09-10T00:00:00Z");
    expect(parseLedger(JSON.parse(serializeLedger(e)))).toEqual(e);
  });

  for (const [name, path] of Object.entries(SHAPE_FIXTURES))
    test(`refuses ${name} at ${path}`, async () => {
      const raw = await load(name);
      let err: unknown;
      try {
        parseLedger(raw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SchemaError);
      expect((err as SchemaError).path).toBe(path);
    });

  test("every rule fixture is structurally valid (validate.ts owns their refusal)", async () => {
    const rule = readdirSync(FIX).filter((f) => f.endsWith(".json") && !(f in SHAPE_FIXTURES) && f !== "valid.json");
    expect(rule.length).toBeGreaterThanOrEqual(10);
    for (const f of rule) expect(() => parseLedger(null), f).toThrow();
    for (const f of rule) {
      const raw = await load(f);
      expect(() => parseLedger(raw), f).not.toThrow();
    }
    for (const f of ["prev.json", "next.json", "older.json"]) {
      const raw = await load(`reused-id/${f}`);
      expect(() => parseLedger(raw), f).not.toThrow();
    }
  });

  test("names the path of a wrong evidence kind", async () => {
    const raw = await load("valid.json");
    raw.asks[0].history[0].evidence[0].kind = "hearsay";
    expect(() => parseLedger(raw)).toThrow("ledger.asks[0].history[0].evidence[0].kind");
  });
});
