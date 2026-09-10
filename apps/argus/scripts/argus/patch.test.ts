import { describe, expect, test } from "bun:test";
import { applyPatch, parsePatch } from "./patch.ts";
import { type Ledger, parseLedger, SchemaError } from "./schema.ts";
import { validateLedger } from "./validate.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const valid = async (): Promise<Ledger> => parseLedger(await Bun.file(`${FIX}valid.json`).json());
const slack = (n: number) => ({ kind: "slack", url: `https://alden-studios.slack.com/archives/C07KG06L601/p17892000000000${n}` });

describe("patch", () => {
  test("adds, updates, clears and rewrites; the result validates", async () => {
    const l = await valid();
    const p = parsePatch({
      story: { health: { text: "Going well. Sam closed the last email defect this morning.", evidence: [slack(1)] } },
      requirements: { add: [{ text: "A retainer floor applies to hand-typed invoices.", status: "assumed", evidence: [{ kind: "assumption" }] }], update: [{ id: "R-3", status: "confirmed", by: "Foong Leung", at: "2026-09-11", evidence: [slack(2)] }] },
      asks: { add: [{ text: "Carlos asked for the export button.", by: "Carlos Lopes", to: "you", at: "2026-09-11", origin: { kind: "slack", url: "u", thread: "1789200000.000003" } }], update: [{ id: "A-2", status: "answered", at: "2026-09-11", evidence: [slack(4)] }] },
      tickets: { clear: [{ key: "ALD-41", blocker: 1, at: "2026-09-11", evidence: [slack(5)] }] },
      notes: ["could not tell who owns the CSV export"],
    });
    const next = applyPatch(l, p);
    expect(next.requirements).toHaveLength(4);
    expect(next.requirements[2]).toMatchObject({ status: "confirmed", by: "Foong Leung" });
    expect(next.requirements[2]?.evidence.map((e) => e.kind)).toEqual(["slack"]);
    expect(next.asks[2]?.id).toBe("");
    expect(next.asks[1]?.status).toBe("answered");
    expect(next.asks[1]?.history).toHaveLength(1);
    expect(next.tickets[0]?.blockers[1]?.cleared?.at).toBe("2026-09-11");
    // ids are allocated by write; give them here to validate the shape
    next.requirements[3]!.id = "R-4";
    next.asks[2]!.id = "A-3";
    expect(validateLedger(next, { prev: l, actor: "model" })).toEqual([]);
    expect(p.notes).toEqual(["could not tell who owns the CSV export"]);
  });

  test("refuses fields outside the shape and unknown ids, by path", async () => {
    expect(() => parsePatch({ delete: ["A-1"] })).toThrow(SchemaError);
    expect(() => parsePatch({ asks: { remove: [] } })).toThrow("patch.asks.remove");
    expect(() => parsePatch({ story: { on_you: { text: "x", evidence: [] } } })).toThrow("patch.story.on_you");
    expect(() => parsePatch({ asks: { update: [{ id: "A-1", status: "closed", at: "2026-09-11", evidence: [{ kind: "message", url: "u" }] }] } })).toThrow("patch.asks.update[0].evidence[0].kind");
    const l = await valid();
    expect(() => applyPatch(l, parsePatch({ asks: { update: [{ id: "A-9", status: "closed", at: "x", evidence: [slack(1)] }] } }))).toThrow("A-9 is not an ask");
  });

  test("an empty patch changes nothing", async () => {
    const l = await valid();
    expect(applyPatch(l, parsePatch({}))).toEqual(l);
  });
});
