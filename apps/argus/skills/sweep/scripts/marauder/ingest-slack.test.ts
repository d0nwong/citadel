/**
 * ingest-slack.ts — what the channel said becomes events (ARG-157).
 *
 * The cases are the ticket's AC7, against the real 2026-09-09 pull: the thread rung, the
 * reference rung, the vocabulary match on `billedBy`, the huddle canvas left for a reader,
 * the message with no anchor, and a re-run that writes nothing. Nothing here touches
 * Slack. What a reader does with the canvas is `huddle.test.ts`.
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
  slackCandidates,
  slackSummary,
  unreadCanvasWhy,
  type SlackItem,
} from "./ingest-slack.ts";
import type { Pull } from "./slack-pull.ts";
import { validate, type Workstream } from "./record.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PULL: Pull = await Bun.file(`${HERE}fixtures/pull-2026-09-09.json`).json();

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
    const item = { ...byTs(BILLING), text: "this is the FE half of ALD-2" };
    const owner = w({ slug: "history-editing", keys: { ...w().keys, threads: [], tickets: ["ALD-2"], vocab: [] } });
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

  test("notes nobody has read go to the queue, asking for marauder huddle", () => {
    const { unsorted, workstreams, changes } = applySlack({ workstreams: [w()], items: [from], unsorted: [], milestones: {} });
    expect(changes[0]).toMatchObject({ kind: "unsorted", why: "a huddle canvas, unread" });
    expect(unsorted[0]).toMatchObject({ id: from.id, needs: "read", why: unreadCanvasWhy(from.threadTs ?? from.ts) });
    expect(workstreams[0]!.events).toEqual([]);
  });

  test("notes already read are not asked about again — an event or a proposal under them is enough", () => {
    const root = from.threadTs ?? from.ts;
    const taken = w({ events: [{ at: "2026-09-09T02:34:00Z", kind: "contract-change", summary: "Angie ruled on the retainer.", source: { type: "huddle", ref: `${root}#1` }, attached: { how: "read", confidence: "guess" } }] });
    expect(applySlack({ workstreams: [taken], items: [from], unsorted: [], milestones: {} }).changes[0]).toMatchObject({ kind: "skipped", why: "these huddle notes are already taken in" });
    const proposal = { id: `${root}#2`, kind: "new" as const, name: "Something", summary: "Foong wants something.", candidates: [], suggest: null, needs: "read" as const, at: from.at };
    expect(applySlack({ workstreams: [w()], items: [from], unsorted: [proposal], milestones: {} }).changes[0]).toMatchObject({ kind: "skipped" });
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

  test("a long (bot) author name still leaves the unsorted summary inside the render ceiling", () => {
    // style.md's rendered workstream line prepends a date/time (~4 words) ahead of the
    // summary; a fixed word-count body clip overflows the 25-word ceiling once the author
    // name itself is long, as a bot's display name can be — regression for that gap.
    const stray = {
      ...byTs(BILLING),
      ts: "1788999999.000003",
      id: "1788999999.000003",
      author: "SWE Slack To Trello",
      authorIsUser: false,
      text: "Ticket has been created by Foong Leung, you can track progress with the commands /summary or /summary:all, or visit our trello board at https://trello.com/invite/some/long/path",
    } as SlackItem;
    const { unsorted } = applySlack({ workstreams: [w({ keys: { ...w().keys, threads: [], vocab: [] } })], items: [stray], unsorted: [], milestones: {} });
    const summary = unsorted[0]!.summary;
    expect(summary).toStartWith("SWE Slack To Trello:");
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(21); // leaves headroom for the rendered date prefix
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
