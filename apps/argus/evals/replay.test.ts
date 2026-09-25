/**
 * Task 289's scoring layer: Jev's Choice scored against the declined set (AC2, S-23), and
 * `score`'s own "reply in a placed thread" exclusion reused for it.
 */

import { describe, expect, test } from "bun:test";
import type { SuggestResult } from "../scripts/argus/suggest.ts";
import { type Band, formatSuggestions, modeOf, scoreSuggestions } from "./replay.ts";

const answer = (choice: string, confidence: number, model = "jev-1.13.1"): SuggestResult => ({ choice, probabilities: {}, confidence, model });

type Item = { id: string; by: string; text: string; thread?: string };
const item = (id: string, thread?: string): Item => ({ id, by: "Sam O", text: "x", ...(thread ? { thread } : {}) });

describe("scoreSuggestions (AC2, S-23)", () => {
  test("C2: the share of on-a-feature items whose suggestion is that feature, and of nowhere items whose suggestion is nothing", () => {
    const declinedThread = new Map([
      ["m1", "t1"], // expected widgets, suggested widgets: hit
      ["m2", "t2"], // expected widgets, suggested sweep: miss
      ["m3", "t3"], // expected nowhere, suggested nothing: hit
      ["m4", "t4"], // expected nowhere, suggested widgets: miss
    ]);
    const suggestions = new Map([
      ["t1", answer("widgets", 0.9)],
      ["t2", answer("sweep", 0.8)],
      ["t3", answer("nothing", 0.7)],
      ["t4", answer("widgets", 0.6)],
    ]);
    const want = new Map<string, string | null>([["m1", "widgets"], ["m2", "widgets"], ["m3", null], ["m4", null]]);
    const items = [item("m1"), item("m2"), item("m3"), item("m4")];
    const s = scoreSuggestions({ declinedThread, suggestions }, want, items);
    expect(s.feature).toEqual({ hit: 1, total: 2 });
    expect(s.none).toEqual({ hit: 1, total: 2 });
    expect(s.declined).toBe(4);
  });

  test("C2: a reply whose thread is expected on a feature is left out of the nowhere share, as attribution's own score() does", () => {
    const declinedThread = new Map([["reply1", "t1"]]);
    const suggestions = new Map([["t1", answer("nothing", 0.9)]]);
    const want = new Map<string, string | null>([["root1", "widgets"], ["reply1", null]]);
    const items = [item("root1"), item("reply1", "root1")];
    const s = scoreSuggestions({ declinedThread, suggestions }, want, items);
    expect(s.none).toEqual({ hit: 0, total: 0 });
    expect(s.declined).toBe(1);
  });

  test("C2: splits again at the median confidence; a guess at the median counts as the high band", () => {
    const declinedThread = new Map([["m1", "t1"], ["m2", "t2"], ["m3", "t3"]]);
    const suggestions = new Map([
      ["t1", answer("widgets", 0.2)], // low
      ["t2", answer("widgets", 0.5)], // median → high, per the spec's guess-counts-as-above rule
      ["t3", answer("widgets", 0.9)], // high
    ]);
    const want = new Map<string, string | null>([["m1", "widgets"], ["m2", "widgets"], ["m3", "widgets"]]);
    const items = [item("m1"), item("m2"), item("m3")];
    const s = scoreSuggestions({ declinedThread, suggestions }, want, items);
    expect(s.high.feature).toEqual({ hit: 2, total: 2 });
    expect(s.low.feature).toEqual({ hit: 1, total: 1 });
  });

  test("C2: a band with no messages reports empty, not a false 0%", () => {
    // every confidence ties, so every row counts as "high" and the low band is empty
    const declinedThread = new Map([["m1", "t1"], ["m2", "t2"]]);
    const suggestions = new Map([
      ["t1", answer("widgets", 0.5)],
      ["t2", answer("nothing", 0.5)],
    ]);
    const want = new Map<string, string | null>([["m1", "widgets"], ["m2", null]]);
    const items = [item("m1"), item("m2")];
    const s = scoreSuggestions({ declinedThread, suggestions }, want, items);
    expect(s.low.feature).toEqual({ hit: 0, total: 0 });
    expect(s.low.none).toEqual({ hit: 0, total: 0 });
    expect(formatSuggestions(s)).toContain("low confidence: on a feature empty, nothing empty");
    expect(s.high.feature.total + s.high.none.total).toBe(2);
  });

  test("C2: the model reported is the version that answered, not a pinned constant", () => {
    const declinedThread = new Map([["m1", "t1"]]);
    const suggestions = new Map([["t1", answer("widgets", 0.9, "jev-1.14.0")]]);
    const want = new Map<string, string | null>([["m1", "widgets"]]);
    const s = scoreSuggestions({ declinedThread, suggestions }, want, [item("m1")]);
    expect(s.model).toBe("jev-1.14.0");
  });

  test("C2: a message whose thread never got an answer (unasked, or the call failed) is not scored, but still counts as declined", () => {
    const declinedThread = new Map([["m1", "t1"], ["m2", "t2"]]);
    const suggestions = new Map([["t1", answer("widgets", 0.9)]]); // t2 never answered
    const want = new Map<string, string | null>([["m1", "widgets"], ["m2", "widgets"]]);
    const s = scoreSuggestions({ declinedThread, suggestions }, want, [item("m1"), item("m2")]);
    expect(s.feature).toEqual({ hit: 1, total: 1 });
    expect(s.declined).toBe(2);
    expect(s.model).toBe("jev-1.13.1");
  });

  test("C2: with nothing declined, every band is empty and the model is unanswered", () => {
    const s = scoreSuggestions({ declinedThread: new Map(), suggestions: new Map() }, new Map(), []);
    expect(s.declined).toBe(0);
    expect(s.model).toBeNull();
    expect(formatSuggestions(s)).toContain("jev none answered");
  });
});

describe("modeOf (AC1, S-22)", () => {
  test("C1: --no-reader is a model run with the reader off, over the same batches and days as the full run", () => {
    expect(modeOf(["--no-reader"])).toMatchObject({ isModel: true, noReader: true, suggest: false, days: undefined, label: "model, no reader" });
    // the same days the full run takes: --days is read the same way in either mode
    expect(modeOf(["--model", "--days", "2"]).days).toBe(2);
    expect(modeOf(["--no-reader", "--days", "2"])).toMatchObject({ isModel: true, noReader: true, days: 2, label: "model (2 days), no reader" });
  });

  test("C2: --suggest is a model run that also turns the reader off, so both arms share the seeded ledgers", () => {
    expect(modeOf(["--suggest"])).toMatchObject({ isModel: true, suggest: true, label: "model, suggest" });
  });

  test("C1: with no flags the run is deterministic, and --model alone still runs the reader", () => {
    expect(modeOf([])).toMatchObject({ isModel: false, noReader: false, suggest: false, label: "deterministic" });
    expect(modeOf(["--model"])).toMatchObject({ isModel: true, noReader: false, suggest: false, label: "model" });
  });
});

describe("formatSuggestions", () => {
  test("C2: reports a populated band as a rounded percentage with its count", () => {
    const band = (hit: number, total: number): Band => ({ hit, total });
    const s = { declined: 10, feature: band(3, 4), none: band(2, 3), high: band(2, 2), low: band(1, 2), model: "jev-1.13.1" };
    const out = formatSuggestions({ ...s, high: { feature: band(2, 2), none: band(1, 1) }, low: { feature: band(1, 2), none: band(1, 2) } });
    expect(out).toContain("on a feature 75% (3/4)");
    expect(out).toContain("nothing 67% (2/3)");
    expect(out).toContain("10 declined");
    expect(out).toContain("jev jev-1.13.1");
  });
});
