/**
 * The shared half of the corrections contract (LIA-160, LIA-162, ARG-167): the fold from an
 * entry's id to a decision file's name, the refusals both the row and the writer apply, and
 * how an event is named — a copy of argus's `eventKeys` rule, since the record carries no
 * id and both sides must derive the same one or a Verify confirms the wrong event.
 */

import { describe, expect, test } from "bun:test";
import {
  CONFIRMED,
  checkDraft,
  decisionSlug,
  eventId,
  eventKeys,
  isFeature,
  isMarauderId,
  MARAUDER_ACTIONS,
  marauderId,
  needsVerify,
  UNSORTED_ACTIONS,
} from "./marauder";

describe("the file a decision is written under", () => {
  test.each([
    ["fe#417", "fe-417"],
    ["1788927279211769.230119", "1788927279211769-230119"],
    ["1788927279211769#2", "1788927279211769-2"],
    ["LIA-116", "lia-116"],
  ])("%s becomes %s", (id, slug) => {
    expect(decisionSlug(id)).toBe(slug);
    expect(isMarauderId(marauderId(id))).toBe(true);
  });

  test("an id of nothing but punctuation folds to nothing, and is refused", () => {
    expect(decisionSlug("///")).toBe("");
    expect(
      checkDraft({ action: "attach", feature: "admin/usage", id: "///" })
    ).toMatch(/not an entry id/);
  });
});

describe("a feature key", () => {
  test.each(["tasks", "admin/invoicing", "shared/date-picker", "a.b/c_d"])(
    "%p is one",
    (f) => {
      expect(isFeature(f)).toBe(true);
    }
  );
  test.each([
    "",
    "..",
    "../x",
    "admin/../x",
    "/admin",
    "admin/",
    "admin//x",
    ".hidden",
    "a b",
  ])("%p is not", (f) => {
    expect(isFeature(f)).toBe(false);
  });
});

describe("what may be written", () => {
  test("attach needs a feature", () => {
    expect(checkDraft({ action: "attach", id: "fe#417" })).toMatch(
      /choose the feature/
    );
    expect(
      checkDraft({ action: "attach", feature: "../x", id: "fe#417" })
    ).toMatch(/choose the feature/);
    expect(
      checkDraft({ action: "attach", feature: "admin/usage", id: "fe#417" })
    ).toBeUndefined();
  });

  test("dismiss needs a reason — it is all a later reader has", () => {
    expect(checkDraft({ action: "dismiss", id: "fe#417" })).toMatch(/say why/);
    expect(
      checkDraft({ action: "dismiss", id: "fe#417", reason: "chat" })
    ).toBeUndefined();
  });

  test.each(["new", "stage", "split"])(
    "AC4 — %p went with the workstreams",
    (action) => {
      expect(checkDraft({ action, id: "fe#417" })).toMatch(
        /went with the workstreams/
      );
    }
  );

  test.each(["", "ignore"])("%p is not an action", (action) => {
    expect(checkDraft({ action, id: "fe#417" })).toBeTruthy();
  });
});

// ── naming an event, so both sides confirm the same one (LIA-162 AC3) ──────────

describe("how an event is named", () => {
  test("by the source it came from, else the instant it happened", () => {
    expect(eventId({ at: "2026-09-09T12:00:00.000Z" })).toBe(
      "2026-09-09T12:00:00.000Z"
    );
    expect(
      eventId({ at: "2026-09-09T12:00:00.000Z", source: { ref: "LIA-133" } })
    ).toBe("LIA-133");
  });

  test("two out of one source are told apart by a counter, as argus's eventKeys does", () => {
    expect(
      eventKeys([
        { at: "a", source: { ref: "huddle-2026-09-09" } },
        { at: "b", source: { ref: "huddle-2026-09-09" } },
        { at: "c", source: { ref: "huddle-2026-09-09" } },
        { at: "d" },
      ])
    ).toEqual([
      "huddle-2026-09-09",
      "huddle-2026-09-09~2",
      "huddle-2026-09-09~3",
      "d",
    ]);
  });
});

describe("which events Verify is offered on", () => {
  const asked = {
    kind: "directed-at-person",
    summary: "2 edits to LIA-133 are waiting on you.",
    to: ["you"],
  };
  test("an unanswered ask aimed at the user, and nothing else", () => {
    expect(needsVerify(asked)).toBe(true);
    // A fact is not a question, whoever it names.
    expect(needsVerify({ ...asked, kind: "verified-landing" })).toBe(false);
    // Nor is an ask aimed at someone else, or at nobody.
    expect(needsVerify({ ...asked, to: ["sam"] })).toBe(false);
    expect(needsVerify({ ...asked, to: undefined })).toBe(false);
  });
  test("one already stamped by a confirmation is not offered again", () => {
    expect(
      needsVerify({
        ...asked,
        action: `${CONFIRMED} make the edit it named — Liam Leung`,
      })
    ).toBe(false);
    // An `action` that is not a confirmation is just what the event did to the record.
    expect(needsVerify({ ...asked, action: "held the diff" })).toBe(true);
  });
});

describe("verified is a decision, and the Unsorted page offers only two verbs", () => {
  test("`verified` needs nothing but the id", () => {
    expect(checkDraft({ action: "verified", id: "LIA-133" })).toBeUndefined();
    expect(checkDraft({ action: "verified", id: "" })).toBe(
      "the entry has no id"
    );
  });
  test("the triage list's verbs are attach and dismiss", () => {
    expect([...UNSORTED_ACTIONS]).toEqual(["attach", "dismiss"]);
    expect([...MARAUDER_ACTIONS]).toEqual(["attach", "dismiss", "verified"]);
  });
});
