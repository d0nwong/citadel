/**
 * huddle.ts — a meeting's key points, as the sweep read them, onto the record (ARG-163, ARG-164 AC4).
 *
 * The cases run against a points file written from the real 2026-09-09 morning canvas
 * (`fixtures/huddle-2026-09-09.md`): a point the reader placed on a feature, one the ladder
 * can confirm, a deadline, a decision nobody would bet on a feature for, an ask aimed at
 * the reader, small talk, and the re-read that replaces an earlier bullet-by-bullet split
 * without touching what a person placed.
 *
 *   bun test skills/sweep/scripts/marauder/huddle.test.ts
 */

import { test, expect, describe } from "bun:test";
import { NOTHING_TO_RECORD, applyHuddle, validatePoints, type Notes, type Point } from "./huddle.ts";
import { unreadCanvasWhy } from "./ingest-slack.ts";
import type { State } from "./correct.ts";
import { validate, type FeatureRef, type UnsortedItem, type Work } from "./record.ts";

const HERE = new URL(".", import.meta.url).pathname;
const NOTES: Notes = await Bun.file(`${HERE}fixtures/huddle-2026-09-09.points.json`).json();
const TS = "1788921273.173019";
const WHO = { by: "the sweep", reason: "read the 09:34 huddle", at: "2026-09-09T03:00:00Z" };

const FEATURES: FeatureRef[] = ["admin/invoicing", "admin/usage", "tasks"].map((feature) => ({ feature, app: "alden/alden-portal", aliases: [] }));

const invoicing = (over: Partial<Work> = {}): Work => ({
  feature: "admin/invoicing",
  keys: { tickets: ["ALD-22"], prs: [], threads: [], vocab: ["rolloverCredits"] },
  open_questions: [],
  events: [],
  updated: "2026-09-07",
  ...over,
});
const holder = (id: string, url: string): UnsortedItem => ({ id, kind: "slack", summary: "Slackbot: ", text: "", source: { type: "slack", ref: id, url }, candidates: [], why: unreadCanvasWhy(TS), suggest: null, needs: "read", at: "2026-09-09T02:34:00Z" });
const state = (over: Partial<State> = {}): State => ({ work: [invoicing()], unsorted: [holder(TS, NOTES.url!)], milestones: {}, features: FEATURES, ...over });
const point = (over: Partial<Point>): Point => ({ kind: "contract-change", feature: "admin/invoicing", summary: "Sam moves the retainer line to the foot.", ...over });
const known = FEATURES.map((f) => f.feature);

describe("what the reader may write", () => {
  test("a kind outside the closed set, a feature no app has, a workstream slug, and Slackbot are refused by name", () => {
    const problems = validatePoints({ points: [
      point({ kind: "ruling" as never }),
      point({ feature: "nowhere" }),
      { ...point({ feature: null }), slug: "rollover-credits" } as Point,
      point({ summary: "Slackbot: review pages pushed by." }),
    ] }, known);
    expect(problems).toEqual([
      expect.stringMatching(/^point 1: "ruling" is not a kind/),
      "point 2: there is no feature nowhere under any app's features/",
      'point 3: "slug" named a workstream, and there are none — name the feature instead',
      "point 4: names Slackbot, and a person said this",
    ]);
  });

  test("a feature with nothing going on yet is a feature all the same", () => {
    expect(validatePoints({ points: [point({ feature: "tasks" })] }, known)).toEqual([]);
  });

  test("the sentence rules are the page's, counted with the date the page puts in front: no id first, no dialect", () => {
    const long = `Foong ${"really ".repeat(20)}wants it.`;
    const problems = validatePoints({ points: [point({ summary: long }), point({ summary: "ALD-22 is what Foong wants fixed." }), point({ summary: "Foong made a point about the tick." })] }, known);
    expect(problems.some((p) => /over the 25-word ceiling once the page puts the date in front/.test(p))).toBe(true);
    expect(validatePoints({ points: [point({ summary: `Foong ${"really ".repeat(17)}wants it.` })] }, known)).toEqual([]);
    expect(problems.some((p) => /starts with an id/.test(p))).toBe(true);
    expect(problems.filter((p) => /dialect/.test(p))).toHaveLength(2);
  });

  test("a deadline needs a name, a date and an owner; a summary needs a full stop", () => {
    const problems = validatePoints({ points: [point({ kind: "deadline", feature: null, summary: "Foong launches tomorrow" })] }, known);
    expect(problems).toEqual([
      "point 1: the summary is not a sentence — it needs a full stop",
      "point 1: a deadline needs a date as YYYY-MM-DD",
      "point 1: a deadline needs an owner",
      "point 1: a deadline needs a name (Launch, Demo, …)",
    ]);
  });

  test("a bad file records nothing and says why", () => {
    expect(() => applyHuddle(state(), TS, { points: [point({ feature: "nowhere" })] }, WHO)).toThrow(/there is no feature nowhere/);
  });
});

describe("recording the reading", () => {
  const { state: after, changed, notes } = applyHuddle(state(), TS, NOTES, WHO);
  const inv = after.work.find((x) => x.feature === "admin/invoicing")!;

  test("a placed point is an event in the reader's words, marked as the sweep's own reading", () => {
    expect(changed).toBe(true);
    expect(inv.events).toHaveLength(2);
    expect(inv.events[0]).toMatchObject({
      at: "2026-09-09T02:34:33Z",
      kind: "contract-change",
      summary: NOTES.points[0]!.summary,
      source: { type: "huddle", ref: `${TS}#1`, url: NOTES.url },
      attached: { how: "read", confidence: "guess" },
      action: "Angie's ruling on the retainer top-up",
    });
    expect(inv.updated).toBe("2026-09-09T02:34:33Z");
  });

  test("a point whose words name a ticket the feature holds is certain, not a guess, and carries who it is for", () => {
    expect(inv.events[1]).toMatchObject({ kind: "new-ask", to: ["you"], attached: { how: "ref", confidence: "certain" } });
  });

  test("a deadline is a milestone for everyone, and one naming no feature is only that", () => {
    expect(after.milestones["launch-2026-09-10"]).toEqual({ name: "Launch", date: "2026-09-10", owner: "Foong Leung" });
    expect(after.unsorted.some((u) => u.id === `${TS}#3`)).toBe(false);
  });

  test("a decision naming no feature is a plain queue entry in the reader's words; an ask aimed at you stays with its addressee", () => {
    const decision = after.unsorted.find((u) => u.id === `${TS}#4`)!;
    expect(decision).toMatchObject({ kind: "slack", summary: NOTES.points[3]!.summary, source: { type: "huddle" }, needs: "read", suggest: null });
    expect(decision).not.toHaveProperty("name");
    expect(decision.summary.startsWith("Slackbot")).toBe(false);
    expect(after.unsorted.find((u) => u.id === `${TS}#5`)).toMatchObject({ kind: "slack", to: ["you"], why: "nothing claims it" });
  });

  test("a point naming no feature carries the features the ladder would look at", () => {
    const withAliases = state({ features: [...FEATURES.filter((f) => f.feature !== "tasks"), { feature: "tasks", app: "alden/alden-portal", aliases: ["rendering credit"] }] });
    const { state: s } = applyHuddle(withAliases, TS, { url: NOTES.url, points: [point({ feature: null, summary: "Foong wants a new rendering credit input for file size." })] }, WHO);
    expect(s.unsorted[0]).toMatchObject({ kind: "slack", features: ["tasks"], suggest: "tasks", candidates: [{ feature: "tasks", how: "vocab" }] });
  });

  test("small talk is not recorded anywhere, and the holder leaves the queue", () => {
    expect(after.unsorted.map((u) => u.id)).toEqual([`${TS}#4`, `${TS}#5`]);
    expect(notes.filter((n) => /not about the work/.test(n))).toHaveLength(2);
    expect(notes.some((n) => /1 queue entry for these notes cleared/.test(n))).toBe(true);
  });

  test("the feature learns what attach would: the point's tickets, and the notes as a thread", () => {
    expect(inv.keys.tickets).toEqual(["ALD-22"]);
    expect(inv.keys.threads).toEqual([TS]);
    for (const x of after.work) expect(validate(x, x.feature)).toEqual([]);
  });

  test("a point on a feature with nothing going on opens its record", () => {
    const { state: s } = applyHuddle(state(), TS, { url: NOTES.url, points: [point({ feature: "tasks", summary: "Foong wants the task card to show the credit split." })] }, WHO);
    const tasks = s.work.find((x) => x.feature === "tasks")!;
    expect(tasks.events).toHaveLength(1);
    expect(validate(tasks, "tasks")).toEqual([]);
  });

  test("the same reading a second time changes nothing", () => {
    const again = applyHuddle(after, TS, NOTES, WHO);
    expect(again.changed).toBe(false);
    expect(again.state).toBe(after);
  });
});

describe("reading again", () => {
  const url = NOTES.url!;
  const before = state({
    work: [
      invoicing({ events: [
        { at: "2026-09-09T02:34:33Z", kind: "contract-change", summary: "Slackbot: must restructure invoice to move retainer line items.", source: { type: "huddle", ref: `${TS}#7`, url }, attached: { how: "vocab", confidence: "likely" } },
        { at: "2026-09-09T02:34:33Z", kind: "contract-change", summary: "Liam moved this here by hand.", source: { type: "huddle", ref: `${TS}#8`, url }, attached: { how: "human", confidence: "certain", by: "Liam Leung" } },
        { at: "2026-09-09T02:34:33Z", kind: "contract-change", summary: "Angie ruled on the retainer.", source: { type: "huddle", ref: TS, url }, attached: { how: "thread", confidence: "certain" } },
      ] }),
    ],
    unsorted: [
      holder(TS, url),
      { id: `${TS}#3`, kind: "slack", summary: "Slackbot: plans to create release notes.", candidates: [], why: "nothing claims it", suggest: null, needs: "read", at: "2026-09-09T02:34:33Z", source: { type: "huddle", ref: `${TS}#3`, url } },
      holder("1788922000.000001", `${url}?thread_ts=${TS}&cid=C07KG06L601`),
      { id: "be#771", kind: "landing", summary: "Sam landed the prod website.", candidates: [], suggest: null, needs: "read", at: "2026-09-10T07:26:46Z" },
    ],
  });

  test("every point recorded before goes unless a person placed it; an event on the notes as a whole stays; other queue entries are untouched", () => {
    const { state: after, notes } = applyHuddle(before, TS, NOTES, WHO);
    const inv = after.work.find((x) => x.feature === "admin/invoicing")!;
    expect(inv.events.map((e) => e.summary)).toEqual(["Liam moved this here by hand.", "Angie ruled on the retainer.", NOTES.points[0]!.summary, NOTES.points[1]!.summary]);
    expect(after.unsorted.map((u) => u.id)).toEqual([`${TS}#4`, `${TS}#5`, "be#771"]);
    expect(notes.some((n) => /1 earlier reading\(s\) of these notes replaced/.test(n))).toBe(true);
    expect(notes.some((n) => /3 queue entries for these notes cleared/.test(n))).toBe(true);
  });

  test("a meeting with nothing in it for the record leaves the holder asking to be dismissed", () => {
    const { state: after } = applyHuddle(state(), TS, { url, points: [point({ kind: "chat", feature: null, summary: "Everyone compared tennis rackets." })] }, WHO);
    expect(after.unsorted).toHaveLength(1);
    expect(after.unsorted[0]).toMatchObject({ id: TS, needs: "ask", why: NOTHING_TO_RECORD });
    expect(after.milestones).toEqual({});
  });
});
