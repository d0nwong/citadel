/**
 * correct.ts — the corrections, over features (ARG-158, ARG-164).
 *
 * Attaching an item and learning enough from it that the next one attaches itself,
 * attaching to a feature that had nothing going on, refusing a feature no app has, and
 * every verb doing nothing the second time.
 *
 *   bun test skills/sweep/scripts/marauder/correct.test.ts
 */

import { test, expect, describe } from "bun:test";
import { attach, learn, suggest, type State, type Who } from "./correct.ts";
import { slackCandidates, type SlackItem } from "./ingest-slack.ts";
import { validate, type FeatureRef, type UnsortedItem, type Work } from "./record.ts";

const WHO: Who = { by: "Liam Leung", reason: "it is the billing fields thread", at: "2026-09-09T14:00:00Z" };

const FEATURES: FeatureRef[] = ["admin/invoicing", "admin/usage", "entities"].map((feature) => ({ feature, app: "alden/alden-portal", aliases: [] }));

const w = (over: Partial<Work> = {}): Work => ({
  feature: "admin/invoicing",
  keys: { tickets: [], prs: [], threads: [], vocab: [] },
  open_questions: [],
  events: [{ at: "2026-09-09T04:00:00Z", kind: "contract-change", summary: "Sam added the field.", source: { type: "pr", ref: "be#765" }, attached: { how: "ref", confidence: "certain" } }],
  updated: "2026-09-09T04:00:00Z",
  ...over,
});

const item = (over: Partial<UnsortedItem> = {}): UnsortedItem => ({
  id: "1788927279.211769",
  kind: "slack",
  summary: "Sam O: In a PR but that should be up today.",
  text: "@Liam Leung @Carlos Lopes\n\nIn a PR but that should be up today. ALD-2 covers it.\n`billedBy` and `sendAutomatedEmails` on PATCH `/api/v1/invoices/entity/{entityId}/billed-by`",
  source: { type: "slack", ref: "1788927279.211769", url: "https://alden-studios.slack.com/archives/C07KG06L601/p1788927279211769?thread_ts=1788921273.173019&cid=C07KG06L601" },
  candidates: [],
  suggest: null,
  needs: "read",
  at: "2026-09-09T04:14:00Z",
  ...over,
});

const state = (over: Partial<State> = {}): State => ({ work: [w()], unsorted: [item()], milestones: {}, features: FEATURES, ...over });

describe("attach", () => {
  test("it moves the item onto the feature and says who decided", () => {
    const { state: next, changed } = attach(state(), item().id, "admin/invoicing", WHO);
    expect(changed).toBe(true);
    expect(next.unsorted).toEqual([]);
    const e = next.work[0]!.events.at(-1)!;
    expect(e.attached).toEqual({ how: "human", confidence: "certain", by: "Liam Leung" });
    expect(e.action).toBe(WHO.reason);
    expect(validate(next.work[0]!, "admin/invoicing")).toEqual([]);
  });

  test("it learns the thread, the ticket and the identifiers the item used", () => {
    const keys = attach(state(), item().id, "admin/invoicing", WHO).state.work[0]!.keys;
    expect(keys.threads).toEqual(["1788921273.173019"]);
    expect(keys.tickets).toEqual(["ALD-2"]);
    expect(keys.vocab).toContain("billedBy");
    expect(keys.vocab).toContain("sendAutomatedEmails");
    expect(keys.vocab).toContain("billed-by");
  });

  test("after it, a later reply in that thread attaches on its own", () => {
    const taught = attach(state(), item().id, "admin/invoicing", WHO).state.work;
    const reply = { id: "1788999999.1", ts: "1788999999.1", threadTs: "1788921273.173019", text: "done", author: "Sam O", authorIsUser: false, mentionsUser: false, to: [], at: "2026-09-09T15:00:00Z", permalink: "https://x", day: "2026-09-09" } as SlackItem;
    expect(slackCandidates(reply, taught)[0]).toMatchObject({ feature: "admin/invoicing", how: "thread" });
  });

  test("a token another feature already claims is not learned, and it says so", () => {
    const other = w({ feature: "admin/usage", keys: { ...w().keys, vocab: ["billedBy"] } });
    const { state: next, notes } = attach(state({ work: [w(), other] }), item().id, "admin/invoicing", WHO);
    expect(next.work[0]!.keys.vocab).not.toContain("billedBy");
    expect(notes.join(" ")).toContain('"billedBy" is left out — admin/usage already claims it');
  });

  test("a feature with nothing going on gets its record from the first item attached to it", () => {
    const { state: next, changed } = attach(state(), item().id, "entities", WHO);
    expect(changed).toBe(true);
    const made = next.work.find((x) => x.feature === "entities")!;
    expect(made.events).toHaveLength(1);
    expect(made.keys.tickets).toEqual(["ALD-2"]);
    expect(validate(made, "entities")).toEqual([]);
  });

  test("--auto records the sweep's own reading, not a person's decision", () => {
    const { state: next } = attach(state(), item().id, "admin/invoicing", { ...WHO, auto: true, kind: "contract-change" });
    expect(next.work[0]!.events.at(-1)!.attached).toEqual({ how: "read", confidence: "guess" });
  });

  test("attaching twice changes nothing the second time", () => {
    const once = attach(state(), item().id, "admin/invoicing", WHO).state;
    const twice = attach(once, item().id, "admin/invoicing", WHO);
    expect(twice.changed).toBe(false);
    expect(twice.notes[0]).toContain("already on admin/invoicing");
  });

  test("a feature no app has, or an unknown item, is refused, not guessed at", () => {
    const r = attach(state(), item().id, "invoicing-page-defects", WHO);
    expect(r.changed).toBe(false);
    expect(r.notes[0]).toContain("there is no feature invoicing-page-defects");
    expect(attach(state(), "nope", "admin/invoicing", WHO).changed).toBe(false);
  });
});

describe("suggest", () => {
  test("it leaves the item in the queue and says where it probably goes", () => {
    const { state: next, changed } = suggest(state(), item().id, "admin/invoicing");
    expect(changed).toBe(true);
    expect(next.unsorted[0]!.suggest).toBe("admin/invoicing");
    expect(suggest(next, item().id, "admin/invoicing").changed).toBe(false);
    expect(suggest(state(), item().id, "nowhere").changed).toBe(false);
  });
});

describe("learn", () => {
  test("a landing teaches its PR, and no thread", () => {
    const l = item({ id: "fe#417", kind: "landing", text: "You landed the columns.", source: { type: "pr", ref: "fe#417", url: "https://bitbucket.org/x/pull-requests/417" } });
    expect(learn(l)).toMatchObject({ threads: [], prs: ["fe#417"] });
  });

  test("a canvas item teaches the notes it came out of, not its own line", () => {
    const c = item({ id: "1788921273.173019#4", source: { type: "huddle", ref: "1788921273.173019#4", url: "https://x/p1788921273173019" }, text: "Angie ruled on the retainer" });
    expect(learn(c).threads).toEqual(["1788921273.173019"]);
  });

  test("nothing about who said it is learned — the author rung is gone", () => {
    expect(learn(item())).not.toHaveProperty("people");
  });
});
