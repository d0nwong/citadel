/**
 * A proposal's Technical Notes are grounded when each bullet names a repo path or is an
 * open question; the validator refuses a write that adds or rewrites one that is not, and
 * leaves what is already on disk alone.
 */

import { describe, expect, test } from "bun:test";
import { isGrounded, technicalNotes, ungroundedNotes } from "./grounding.ts";
import { applyPatch, parsePatch } from "./patch.ts";
import { type Ledger, parseLedger } from "./schema.ts";
import { validateLedger } from "./validate.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const valid = async (): Promise<Ledger> => parseLedger(await Bun.file(`${FIX}valid.json`).json());

const body = (notes: string) => `## Summary\n\nx.\n\n## Acceptance Criteria\n\n- [ ] AC1 — y.\n\n## Technical Notes\n\n${notes}\n\nVerified at FE staging@abc, BE dev@def.\n`;
const grounded = body(
  "- `src/components/modals/project-form-modal/use-project-form-modal.ts` sends the form;\n  add `clientStandard` — AC1.\n* Open question: does the edit route accept null?",
);
const productOnly = body("- Values: high x1.5, standard x1, low x0.8.\n- `src/hooks/projects/use-create-project.ts` posts the project — AC1.");

describe("grounding", () => {
  test("reads the bullets, joining continuation lines, and stops at the next heading", () => {
    expect(technicalNotes(grounded)).toEqual([
      "`src/components/modals/project-form-modal/use-project-form-modal.ts` sends the form; add `clientStandard` — AC1.",
      "Open question: does the edit route accept null?",
    ]);
    expect(technicalNotes(`${grounded}\n## Execution order\n\n- ALD-1 — x`)).toHaveLength(2);
    expect(technicalNotes("## Summary\n\nx")).toBeNull();
  });
  test("a note names a path or asks a question; a backticked identifier alone is not a file", () => {
    expect(isGrounded(grounded)).toBe(true);
    expect(ungroundedNotes(productOnly)).toEqual(["Values: high x1.5, standard x1, low x0.8."]);
    expect(ungroundedNotes(body("- `clientStandard` is new on POST"))).toHaveLength(1);
    expect(ungroundedNotes(body("- regen per `FORMAT.md` against `dev@abc`"))).toEqual([]);
    expect(isGrounded("## Summary\n\nno notes yet")).toBe(false);
    expect(isGrounded(body(""))).toBe(false);
  });
});

describe("the validator on proposals", () => {
  const at = "2026-09-11";
  test("a new proposal with a product-only note is refused, naming it; one with no notes is accepted", async () => {
    const prev = await valid();
    const bad = applyPatch(prev, parsePatch({ proposals: { add: [{ kind: "ticket", title: "[FE] x", body: productOnly, asks: ["A-2"], at }] } }));
    bad.proposals[1]!.id = "P-2";
    expect(validateLedger(bad, { prev, actor: "model" })).toEqual([
      { path: "ledger.proposals[1].body", rule: 'P-2: a Technical Notes bullet names no file: "Values: high x1.5, standard x1, low x0.8."' },
    ]);
    const bare = applyPatch(prev, parsePatch({ proposals: { add: [{ kind: "ticket", title: "[FE] x", body: "## Summary\n\nx.\n", asks: ["A-2"], at }] } }));
    bare.proposals[1]!.id = "P-2";
    expect(validateLedger(bare, { prev, actor: "model" })).toEqual([]);
  });
  test("the grounding step replaces a body; an unchanged ungrounded one on disk still validates", async () => {
    const prev = await valid();
    prev.proposals[0]!.body = productOnly;
    expect(validateLedger(prev, { prev, actor: "model" })).toEqual([]);
    expect(validateLedger(prev)).toEqual([]);
    const next = applyPatch(prev, parsePatch({ proposals: { update: [{ id: "P-1", body: grounded }] } }));
    expect(next.proposals[0]!.body).toBe(grounded);
    expect(validateLedger(next, { prev, actor: "model" })).toEqual([]);
    const worse = applyPatch(prev, parsePatch({ proposals: { update: [{ id: "P-1", body: `${productOnly}\n` }] } }));
    expect(validateLedger(worse, { prev, actor: "model" })).toHaveLength(1);
  });
  test("an update to an unknown proposal, or without a body, is refused by path", async () => {
    const l = await valid();
    expect(() => applyPatch(l, parsePatch({ proposals: { update: [{ id: "P-9", body: grounded }] } }))).toThrow("P-9 is not a proposal");
    expect(() => parsePatch({ proposals: { update: [{ id: "P-1" }] } })).toThrow("patch.proposals.update[0]");
  });
});
