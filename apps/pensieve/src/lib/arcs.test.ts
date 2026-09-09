/**
 * The two shared rules an arc's page reads by: where a Landed row's Evidence points inside
 * Pensieve (LIA-149 AC2), and the order arcs are listed in wherever they are listed (AC1).
 * The paths are the sweep's own — `landedFromEntry` and `landedFromPoint` in argus
 * `skills/sweep/scripts/arcs.ts` write them — so these are that writer's output.
 */

import { describe, expect, test } from "bun:test";
import { byLastRewrite, evidenceOf } from "./arcs";

describe("evidenceOf", () => {
  test("a journal entry resolves to its Pensieve id, app and all", () => {
    expect(
      evidenceOf(
        "alden/alden-portal/features/invoicing/journal/2026-09-08-reminders.md"
      )
    ).toEqual({
      id: "alden/alden-portal/invoicing/2026-09-08-reminders",
      kind: "journal",
      path: "alden/alden-portal/features/invoicing/journal/2026-09-08-reminders.md",
    });
  });

  test("a dated sub-directory in the journal path is not part of the id", () => {
    expect(
      evidenceOf("pensieve/features/ask/journal/2026-09/cards.md")
    ).toMatchObject({ id: "pensieve/ask/cards", kind: "journal" });
  });

  test("the backticks the table cell wears come off", () => {
    expect(evidenceOf("`decisions/decide/lia-132-is-ready.json`")).toEqual({
      kind: "decision",
      path: "decisions/decide/lia-132-is-ready.json",
      point: "decide/lia-132-is-ready",
    });
  });

  test("anything else is shown as it is, never guessed at", () => {
    expect(evidenceOf("reports/2026-09-09.md").kind).toBe("plain");
    expect(evidenceOf("decided").kind).toBe("plain");
    expect(evidenceOf("").kind).toBe("plain");
  });
});

describe("byLastRewrite", () => {
  test("the arc rewritten last comes first; a tie is settled by title", () => {
    const arcs = [
      { title: "Entity billing", updated: "2026-09-02" },
      { title: "Usage page", updated: "2026-09-09" },
      { title: "Invoice emails", updated: "2026-09-09" },
    ];
    expect([...arcs].sort(byLastRewrite).map((a) => a.title)).toEqual([
      "Invoice emails",
      "Usage page",
      "Entity billing",
    ]);
  });

  test("an arc with no stamp sorts last rather than throwing the order", () => {
    const arcs = [
      { title: "Fresh", updated: "" },
      { title: "Moving", updated: "2026-09-09" },
    ];
    expect([...arcs].sort(byLastRewrite).map((a) => a.title)).toEqual([
      "Moving",
      "Fresh",
    ]);
  });
});
