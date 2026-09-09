/**
 * ingest-slack.ts — what the channel said becomes events (LIA-157).
 *
 * The cases are the ticket's AC7, against the real 2026-09-09 pull and the real huddle
 * canvas of the same morning: the thread rung, the reference rung, the vocabulary match on
 * `billedBy`, the canvas split, the message with no anchor, and a re-run that writes
 * nothing. Nothing here touches Slack.
 *
 *   bun test skills/sweep/scripts/marauder/ingest-slack.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  addressees,
  applySlack,
  classify,
  isChat,
  itemsOf,
  milestoneOf,
  resolveMentions,
  slackCandidates,
  slackSummary,
  splitCanvas,
  type SlackItem,
} from "./ingest-slack.ts";
import type { Pull } from "../../../slack-digest/scripts/slack-pull.ts";
import { validate, type Workstream } from "./record.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PULL: Pull = await Bun.file(`${HERE}fixtures/pull-2026-09-09.json`).json();
const CANVAS = await Bun.file(`${HERE}fixtures/huddle-2026-09-09.md`).text();
const USERS = { U07NTTMRNBF: "Foong Leung", U07JF8MVB27: "Sam O", U09R2MYP6A0: "Liam Leung" };
const ME = "U09R2MYP6A0";

const w = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "entity-invoice-sender",
  name: "Each entity's own invoice sending address",
  features: ["admin/invoicing"],
  wants: [],
  done: "An entity picks the address its invoices come from.",
  stage: { fe: "asked", be: "landed" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: [], prs: [], threads: ["1788927279.211769"], vocab: ["billedBy", "isOnboarded"], people: ["Sam O"] },
  open_questions: [],
  facts: [],
  events: [],
  opened: "2026-09-09",
  updated: "2026-09-09",
  ...over,
});

const items = itemsOf(PULL);
const byTs = (ts: string) => items.find((i) => i.ts === ts)!;
/** Sam's 11:14, the one that names billedBy, isOnboarded and sendAutomatedEmails */
const BILLING = "1788927279.211769";
/** Sam's 17:31 subtask-history message, which is its own thread root */
const SUBTASKS = "1788949866.296519";
/** Foong's reply in that thread */
const REPLY = "1788950081.162459";

describe("the pull becomes items", () => {
  test("every message and new reply appears once, oldest first", () => {
    expect(items.length).toBeGreaterThan(5);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.map((i) => Number(i.ts))).toEqual([...items.map((i) => Number(i.ts))].sort((a, b) => a - b));
  });

  test("a reply carries the thread it was said in; a root does not", () => {
    expect(byTs(REPLY).threadTs).toBe(SUBTASKS);
    expect(byTs(BILLING).threadTs).toBeUndefined();
  });

  test("the huddle canvas comes through as a file nobody has read", () => {
    expect(items.some((i) => i.canvas)).toBe(true);
  });

  test("a message opening with names says who it is aimed at, the reader as `you`", () => {
    expect(byTs(BILLING).to).toEqual(["you", "Carlos Lopes"]);
    expect(addressees("@Liam Leung @Carlos Lopes\n\nIn a PR")).toEqual(["you", "Carlos Lopes"]);
  });
});

describe("the ladder", () => {
  test("a reply in a thread a workstream owns attaches for certain", () => {
    const owner = w({ slug: "history-subtask-rows", keys: { ...w().keys, threads: [SUBTASKS] } });
    expect(slackCandidates(byTs(REPLY), [owner])).toEqual([
      { slug: "history-subtask-rows", how: "thread", why: "it owns the thread this was said in" },
    ]);
  });

  test("a message naming a ticket a workstream owns attaches for certain", () => {
    const item = { ...byTs(BILLING), text: "this is the FE half of LIA-116" };
    const owner = w({ slug: "history-editing", keys: { ...w().keys, threads: [], tickets: ["LIA-116"], vocab: [] } });
    expect(slackCandidates(item, [owner])[0]).toMatchObject({ slug: "history-editing", how: "ref" });
  });

  test("a field name only one workstream claims attaches as likely", () => {
    const owner = w({ keys: { ...w().keys, threads: [] } });
    expect(slackCandidates(byTs(BILLING), [owner])[0]).toMatchObject({ slug: "entity-invoice-sender", how: "vocab" });
  });

  test("a token two workstreams both claim is worth nothing, so it does not attach to either", () => {
    const a = w({ slug: "one", keys: { ...w().keys, threads: [], vocab: ["billedBy"] } });
    const b = w({ slug: "two", keys: { ...w().keys, threads: [], vocab: ["billedBy"] } });
    expect(slackCandidates(byTs(BILLING), [a, b])).toEqual([]);
  });

  test("a message with no thread, no reference and no vocabulary claims nothing", () => {
    expect(slackCandidates(byTs("1788921243.757189"), [w({ keys: { ...w().keys, threads: [] } })])).toEqual([]);
  });
});

describe("what kind of thing it is", () => {
  test("a message naming the reader is aimed at them", () => {
    expect(classify(byTs(BILLING), [w()])).toBe("directed-at-person");
  });

  test("a message naming a route is a change to the contract", () => {
    const item = { ...byTs(BILLING), mentionsUser: false, text: "PATCH /api/v1/invoices/entity/{entityId}/billed-by now takes billedBy" };
    expect(classify(item, [w()])).toBe("contract-change");
  });

  test("a message claiming a PR is on a branch is a claimed landing", () => {
    const item = { ...byTs(BILLING), mentionsUser: false, text: "fe#417 is merged and on staging now" };
    expect(classify(item, [w()])).toBe("claimed-landing");
  });

  test("small talk is not recorded at all", () => {
    expect(isChat(byTs("1788921243.757189"), [w()])).toBe(true);
    expect(isChat(byTs(REPLY), [w()])).toBe(true);
    expect(isChat(byTs(BILLING), [w()])).toBe(false);
  });

  test("a message that is neither provable nor small talk is left for a reader", () => {
    const item = { ...byTs(BILLING), mentionsUser: false, to: [], text: "I think we should probably revisit how the invoice register orders its rows before Angie sees it" };
    expect(classify(item, [w()])).toBeNull();
    expect(isChat(item, [w()])).toBe(false);
  });
});

describe("the canvas", () => {
  const from = items.find((i) => i.canvas)!;
  const split = splitCanvas(CANVAS, from, USERS, ME);

  test("raw user ids become the names the channel uses, the reader among them", () => {
    expect(resolveMentions("<@U07JF8MVB27> and <@U09R2MYP6A0>", USERS, ME)).toBe("@Sam O and @Liam Leung");
  });

  test("the notes split into items, each with its own id under the canvas", () => {
    expect(split.length).toBeGreaterThan(10);
    expect(split.every((i) => i.id.startsWith(`${from.ts}#`))).toBe(true);
    expect(split.every((i) => !i.canvas)).toBe(true);
  });

  test("a group label with items under it is not itself an item", () => {
    expect(split.map((i) => i.text)).not.toContain("Personal Updates and Team Energy");
  });

  test("the action items are asks, and the meeting's small talk is dropped", () => {
    expect(split.filter((i) => i.section === "actions").every((i) => i.kind === "new-ask" || i.kind === "deadline")).toBe(true);
    const chatter = split.find((i) => /tennis racket/.test(i.text))!;
    expect(isChat(chatter, [w()])).toBe(true);
  });

  test("an item naming a date and an owner becomes a milestone", () => {
    const launch = split.find((i) => i.kind === "deadline")!;
    expect(milestoneOf(launch)).toEqual({ slug: "launch-2026-09-10", name: "Launch", date: "2026-09-10", owner: "Foong Leung" });
  });

  test("one canvas puts events on several workstreams and records the date", () => {
    const open = [
      w({ slug: "rollover-credits", keys: { ...w().keys, threads: ["1"], vocab: ["retainer"] } }),
      w({ slug: "rendering-credit-inputs", keys: { ...w().keys, threads: ["2"], vocab: ["rendering"] } }),
      w({ slug: "invoicing-page-defects", keys: { ...w().keys, threads: ["3"], vocab: ["invoicing page"] } }),
    ];
    const { workstreams, milestones, changes } = applySlack({ workstreams: open, items: split, unsorted: [], milestones: {} });
    expect(new Set(changes.filter((c) => c.kind === "attached").map((c) => (c as { slug: string }).slug)).size).toBeGreaterThan(1);
    expect(milestones["launch-2026-09-10"]!.date).toBe("2026-09-10");
    for (const x of workstreams) expect(validate(x, x.slug)).toEqual([]);
  });

  test("notes already taken in are not split into the record a second time", () => {
    const taken = w({ events: [{ at: "2026-09-09T02:34:00Z", kind: "contract-change", summary: "Angie ruled on the retainer.", source: { type: "huddle", ref: from.ts }, attached: { how: "thread", confidence: "certain" } }] });
    const { changes } = applySlack({ workstreams: [taken], items: split, unsorted: [], milestones: {} });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "skipped", why: "these huddle notes are already taken in" });
  });
});

describe("applying", () => {
  const open = [w()];

  test("an item that places and types cleanly becomes an event", () => {
    const { workstreams, changes } = applySlack({ workstreams: open, items: [byTs(BILLING)], unsorted: [], milestones: {} });
    expect(changes[0]).toMatchObject({ kind: "attached", slug: "entity-invoice-sender", how: "thread", confidence: "certain", eventKind: "directed-at-person" });
    const e = workstreams[0]!.events[0]!;
    expect(e.to).toEqual(["you", "Carlos Lopes"]);
    expect(e.source).toMatchObject({ type: "slack", ref: BILLING });
    expect(validate(workstreams[0]!, workstreams[0]!.slug)).toEqual([]);
  });

  test("an item nothing claims goes to unsorted, and no workstream changes", () => {
    const stray = { ...byTs(BILLING), ts: "1788999999.000001", id: "1788999999.000001", text: "Angie wants the register sorted by client before tonight, can someone take it?" } as SlackItem;
    const { workstreams, unsorted } = applySlack({ workstreams: [w({ keys: { ...w().keys, threads: [], vocab: [] } })], items: [stray], unsorted: [], milestones: {} });
    expect(workstreams[0]!.events).toEqual([]);
    expect(unsorted[0]).toMatchObject({ id: stray.id, needs: "read", suggest: null });
  });

  test("an ask nothing claims is proposed as a workstream, never created", () => {
    const ask = { ...byTs(BILLING), ts: "1788999999.000002", id: "1788999999.000002", kind: "new-ask" as const, text: "Someone should add a client column to the register" };
    const { workstreams, unsorted, changes } = applySlack({ workstreams: [w({ keys: { ...w().keys, threads: [], vocab: [] } })], items: [ask], unsorted: [], milestones: {} });
    expect(changes[0]!.kind).toBe("proposed");
    expect(unsorted[0]).toMatchObject({ kind: "new", name: "Someone should add a client column to the register" });
    expect(workstreams).toHaveLength(1);
  });

  test("the whole day, run twice, writes nothing the second time", () => {
    const first = applySlack({ workstreams: open, items, unsorted: [], milestones: {} });
    const second = applySlack({ workstreams: first.workstreams, items, unsorted: first.unsorted, milestones: first.milestones });
    expect(second.workstreams).toEqual(first.workstreams);
    expect(second.unsorted).toEqual(first.unsorted);
    expect(second.changes.every((c) => c.kind === "skipped")).toBe(true);
  });

  test("the summary frames a person doing something and stays inside the ceiling", () => {
    const line = slackSummary(byTs(BILLING), "directed-at-person");
    expect(line).toStartWith("Sam O asked you and Carlos:");
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
});
