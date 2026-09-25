/**
 * The unplaced row's suggestion (CTD-290, board S-26/S-27/S-28): the three pure pieces
 * `UnplacedRow` derives from `item.suggestion` and renders — the picker's starting
 * value, its options, and the suggestion line's own words — tested directly since the
 * repo has no DOM runner to render the row itself.
 */

import { describe, expect, test } from "bun:test";
import type { Unplaced } from "#/lib/ledger";
import { suggestedDir, suggestedOptions, suggestionLine } from "./home";

const item = (over: Partial<Unplaced> = {}): Unplaced => ({
  at: "2026-09-11",
  batch: "b",
  by: "Sam O",
  candidates: ["tasks"],
  id: "1",
  kind: "message",
  text: "x",
  url: "u",
  ...over,
});

describe("suggestedDir", () => {
  test("C1: a suggestion naming a feature starts the picker on it", () => {
    const u = item({
      suggestion: { confidence: 0.82, feature: "admin/invoicing", model: "jev-v1" },
    });
    expect(suggestedDir(u)).toBe("admin/invoicing");
  });

  test("C2: a suggestion of nothing leaves the picker empty", () => {
    const u = item({
      suggestion: { confidence: 0.6, feature: null, model: "jev-v1" },
    });
    expect(suggestedDir(u)).toBe("");
  });

  test("C3: no suggestion leaves the picker empty, as before", () => {
    expect(suggestedDir(item())).toBe("");
  });
});

describe("suggestedOptions", () => {
  test("C1: the suggested feature is offered even with no ledger and no candidate naming it", () => {
    const u = item({
      candidates: ["tasks"],
      suggestion: { confidence: 0.5, feature: "admin/usage", model: "jev-v1" },
    });
    expect(suggestedOptions(u, ["home"])).toEqual(["tasks", "home", "admin/usage"]);
  });

  test("C1: a suggested feature already among the candidates is not duplicated", () => {
    const u = item({
      candidates: ["tasks"],
      suggestion: { confidence: 0.5, feature: "tasks", model: "jev-v1" },
    });
    expect(suggestedOptions(u, ["home"])).toEqual(["tasks", "home"]);
  });

  test("C2: a nothing suggestion adds no option", () => {
    const u = item({
      candidates: ["tasks"],
      suggestion: { confidence: 0.5, feature: null, model: "jev-v1" },
    });
    expect(suggestedOptions(u, ["home"])).toEqual(["tasks", "home"]);
  });

  test("C3: with no suggestion the options are candidates then the ledger's features, as before", () => {
    expect(suggestedOptions(item({ candidates: ["tasks"] }), ["home", "tasks"])).toEqual([
      "tasks",
      "home",
    ]);
  });
});

describe("suggestionLine", () => {
  // 0.876 rounds up, so this fails under a floor or a truncation as well as under no
  // conversion at all — 0.824 would have passed all three.
  test("C1: names the feature and its confidence as a whole percentage", () => {
    const u = item({
      suggestion: { confidence: 0.876, feature: "admin/invoicing", model: "jev-v1" },
    });
    expect(suggestionLine(u)).toEqual({ label: "admin/invoicing", pct: 88 });
  });

  test("C2: names nothing and its confidence as a whole percentage", () => {
    const u = item({
      suggestion: { confidence: 0.6, feature: null, model: "jev-v1" },
    });
    expect(suggestionLine(u)).toEqual({ label: "nothing", pct: 60 });
  });

  test("C3: shows no suggestion", () => {
    expect(suggestionLine(item())).toBeNull();
  });
});
