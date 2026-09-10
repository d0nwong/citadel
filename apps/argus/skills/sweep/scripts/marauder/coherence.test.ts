/**
 * coherence.ts — is this still one thing? (ARG-158)
 *
 * The check prints and stops, so what there is to test is which workstreams it asks about
 * and which it leaves alone: busy enough to hide a second capability, not parked, and not
 * already carrying a split someone has yet to answer.
 *
 *   bun test skills/sweep/scripts/marauder/coherence.test.ts
 */

import { test, expect, describe } from "bun:test";
import { busy, formatCheck, BUSY_EVENTS } from "./coherence.ts";
import type { UnsortedItem, Workstream, WorkstreamEvent } from "./record.ts";

const NOW = "2026-09-09T13:00:00Z";

const ev = (at: string, ref: string): WorkstreamEvent => ({
  at, kind: "verified-landing", side: "fe", summary: `Sam landed ${ref}.`,
  source: { type: "pr", ref }, attached: { how: "ref", confidence: "certain" },
});

const w = (slug: string, events: WorkstreamEvent[], over: Partial<Workstream> = {}): Workstream => ({
  slug, name: slug, features: ["admin/invoicing"], wants: [],
  done: "It is done when a bookkeeper stops asking.",
  stage: { fe: "building" }, overlay: null, parked: false, milestone: null,
  keys: { tickets: [], prs: [], threads: ["1"], vocab: [], people: [] },
  open_questions: [], facts: [], events, opened: "2026-09-01", updated: NOW, ...over,
});

const recently = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => ev(`2026-09-0${from + (i % 8)}T09:00:00Z`, `fe#${400 + i}`));

describe("which workstreams it asks about", () => {
  test("one busy enough to hide a second thing", () => {
    expect(busy([w("invoicing", recently(BUSY_EVENTS))], [], NOW).map((b) => b.workstream.slug)).toEqual(["invoicing"]);
  });

  test("one just under the bar is left alone", () => {
    expect(busy([w("quiet", recently(BUSY_EVENTS - 1))], [], NOW)).toEqual([]);
  });

  test("events older than the fortnight do not count", () => {
    const old = Array.from({ length: 8 }, (_, i) => ev(`2026-08-1${i}T09:00:00Z`, `fe#${300 + i}`));
    expect(busy([w("old", old)], [], NOW)).toEqual([]);
  });

  test("a parked workstream is not asked about", () => {
    expect(busy([w("parked", recently(BUSY_EVENTS), { parked: true })], [], NOW)).toEqual([]);
  });

  test("a workstream already carrying a split is not asked a second time", () => {
    const pending: UnsortedItem = { id: "split/invoicing", kind: "split", slug: "invoicing", summary: "x", candidates: [], suggest: null, at: NOW };
    expect(busy([w("invoicing", recently(BUSY_EVENTS))], [pending], NOW)).toEqual([]);
  });

  test("the busiest comes first", () => {
    const list = busy([w("small", recently(BUSY_EVENTS)), w("big", recently(BUSY_EVENTS + 4))], [], NOW);
    expect(list.map((b) => b.workstream.slug)).toEqual(["big", "small"]);
  });
});

describe("what it prints", () => {
  test("each event carries the name split would take", () => {
    const out = formatCheck(busy([w("invoicing", recently(BUSY_EVENTS))], [], NOW));
    expect(out).toContain("## invoicing");
    expect(out).toContain("done means:");
    expect(out).toContain("fe#400");
    expect(out).toContain("marauder propose-split");
  });

  test("two events sharing a source are still told apart", () => {
    const same = [...recently(BUSY_EVENTS), ev("2026-09-08T10:00:00Z", "fe#400")];
    expect(formatCheck(busy([w("invoicing", same)], [], NOW))).toContain("fe#400~2");
  });

  test("a quiet fortnight says so rather than printing an empty list", () => {
    expect(formatCheck([])).toContain("nothing has been busy enough");
  });
});
