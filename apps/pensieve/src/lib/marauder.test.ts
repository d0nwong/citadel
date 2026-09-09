/**
 * The shared half of the corrections contract (LIA-160): the fold from an Unsorted entry's
 * id to a decision file's name, and the refusals both the row and the writer apply.
 */

import { describe, expect, test } from "bun:test";
import { checkDraft, decisionSlug, isMarauderId, marauderId } from "./marauder";

describe("the file a decision is written under", () => {
  test.each([
    ["fe#417", "fe-417"],
    ["1788927279211769.230119", "1788927279211769-230119"],
    ["1788927279211769#2", "1788927279211769-2"],
    ["split/usage-page", "split-usage-page"],
    ["LIA-116", "lia-116"],
  ])("%s becomes %s", (id, slug) => {
    expect(decisionSlug(id)).toBe(slug);
    expect(isMarauderId(marauderId(id))).toBe(true);
  });

  test("an id of nothing but punctuation folds to nothing, and is refused", () => {
    expect(decisionSlug("///")).toBe("");
    expect(
      checkDraft({ action: "attach", id: "///", slug: "usage-page" })
    ).toMatch(/not an entry id/);
  });
});

describe("what may be written", () => {
  test("attach needs a workstream", () => {
    expect(checkDraft({ action: "attach", id: "fe#417" })).toMatch(
      /choose the workstream/
    );
    expect(
      checkDraft({ action: "attach", id: "fe#417", slug: "usage-page" })
    ).toBeUndefined();
  });

  test("new needs a name", () => {
    expect(checkDraft({ action: "new", id: "fe#417", name: "  " })).toMatch(
      /needs a name/
    );
    expect(
      checkDraft({ action: "new", id: "fe#417", name: "Due on receipt" })
    ).toBeUndefined();
  });

  test("dismiss needs a reason — it is all a later reader has", () => {
    expect(checkDraft({ action: "dismiss", id: "fe#417" })).toMatch(/say why/);
    expect(
      checkDraft({ action: "dismiss", id: "fe#417", reason: "chat" })
    ).toBeUndefined();
  });

  test("stage names a workstream, a side and a stage", () => {
    expect(
      checkDraft({ action: "stage", id: "fe#417", slug: "usage-page" })
    ).toMatch(/side is fe or be/);
    expect(
      checkDraft({
        action: "stage",
        id: "fe#417",
        side: "fe",
        slug: "usage-page",
        stage: "flying",
      })
    ).toMatch(/stage is one of/);
    expect(
      checkDraft({
        action: "stage",
        id: "fe#417",
        side: "fe",
        slug: "usage-page",
        stage: "landed",
      })
    ).toBeUndefined();
  });

  test.each(["", "ignore", "split"])("%p is not an action", (action) => {
    expect(checkDraft({ action, id: "fe#417" })).toBeTruthy();
  });
});
