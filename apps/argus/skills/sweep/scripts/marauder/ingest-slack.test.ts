/**
 * ingest-slack.ts — what the channel said becomes events on features (ARG-157, ARG-164 AC2–AC3).
 *
 * Against the real 2026-09-09 pull: the thread rung, the reference rung, the vocabulary
 * rung over learned keys and over the manifest's aliases, a common word that places
 * nothing, the huddle canvas left for a reader, the message with no anchor, and a re-run
 * that writes nothing. Nothing here touches Slack. What a reader does with the canvas is
 * `huddle.test.ts`.
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
  usableAlias,
  type SlackItem,
} from "./ingest-slack.ts";
import type { Pull } from "./slack-pull.ts";
import { validate, type FeatureRef, type Work } from "./record.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PULL: Pull = await Bun.file(`${HERE}fixtures/pull-2026-09-09.json`).json();

const w = (over: Partial<Work> = {}): Work => ({
  feature: "admin/invoicing",
  keys: { tickets: [], prs: [], threads: ["1788927279.211769"], vocab: ["billedBy", "isOnboarded"] },
  open_questions: [],
  events: [],
  updated: "2026-09-09",
  ...over,
});

const ref = (feature: string, aliases: string[] = []): FeatureRef => ({ feature, app: "alden/alden-portal", aliases });

const items = itemsOf(PULL);
const byTs = (ts: string) => items.find((i) => i.ts === ts)!;
/** Sam's 11:14, the one that names billedBy, isOnboarded and sendAutomatedEmails */
const BILLING = "1788927279.211769";
/** Sam's 17:31 subtask-history message, which is its own thread root */
const SUBTASKS = "1788949866.296519";
/** Foong's reply in that thread */
const REPLY = "1788950081.162459";

const says = (text: string): SlackItem => ({ ...byTs(BILLING), ts: "1789000000.000001", id: "1789000000.000001", mentionsUser: false, to: [], text });

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
  test("a reply in a thread a feature has learned attaches for certain", () => {
    const owner = w({ feature: "admin/usage", keys: { ...w().keys, threads: [SUBTASKS] } });
    expect(slackCandidates(byTs(REPLY), [owner])).toEqual([
      { feature: "admin/usage", how: "thread", why: "it has learned the thread this was said in" },
    ]);
  });

  test("a message naming a ticket or a PR in a feature's keys attaches for certain", () => {
    const owner = w({ feature: "admin/usage", keys: { ...w().keys, threads: [], tickets: ["ALD-2"], prs: ["fe#417"], vocab: [] } });
    expect(slackCandidates(says("this is the FE half of ALD-2"), [owner])[0]).toMatchObject({ feature: "admin/usage", how: "ref" });
    expect(slackCandidates(says("fe#417 needs a second look"), [owner])[0]).toMatchObject({ feature: "admin/usage", how: "ref" });
  });

  test("a field name only one feature has learned attaches as likely", () => {
    const owner = w({ keys: { ...w().keys, threads: [] } });
    expect(slackCandidates(byTs(BILLING), [owner])[0]).toMatchObject({ feature: "admin/invoicing", how: "vocab" });
  });

  test("an alias only one feature claims, of two words or shaped like an identifier, attaches as likely", () => {
    const features = [ref("admin/usage", ["usage page", "creditWeight", "save"]), ref("admin/invoicing", ["billing profile", "save"])];
    expect(slackCandidates(says("the usage page is blank for Angie"), [], features)).toEqual([
      { feature: "admin/usage", how: "vocab", why: "it uses usage page" },
    ]);
    expect(slackCandidates(says("the creditWeight is wrong on that row"), [], features)[0]).toMatchObject({ feature: "admin/usage", how: "vocab" });
    expect(slackCandidates(says("set up the billing profile first"), [], features)[0]).toMatchObject({ feature: "admin/invoicing" });
  });

  test("a single common word attaches nothing, even when a feature lists it", () => {
    expect(usableAlias("save")).toBe(false);
    expect(usableAlias("usage page")).toBe(true);
    expect(usableAlias("creditWeight")).toBe(true);
    expect(usableAlias("/admin/usage")).toBe(true);
    expect(slackCandidates(says("did anyone save it"), [], [ref("admin/usage", ["save"])])).toEqual([]);
  });

  test("a token two features both claim is worth nothing, so it does not attach to either", () => {
    const a = w({ feature: "one", keys: { ...w().keys, threads: [], vocab: ["billedBy"] } });
    const b = w({ feature: "two", keys: { ...w().keys, threads: [], vocab: ["billedBy"] } });
    expect(slackCandidates(byTs(BILLING), [a, b])).toEqual([]);
    const aliases = [ref("admin/usage", ["billing profile"]), ref("admin/invoicing", ["billing profile"])];
    expect(slackCandidates(says("set up the billing profile first"), [], aliases)).toEqual([]);
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
    expect(classify(says("PATCH /api/v1/invoices/entity/{entityId}/billed-by now takes billedBy"), [w()])).toBe("contract-change");
  });

  test("a message claiming a PR is on a branch is a claimed landing", () => {
    expect(classify(says("fe#417 is merged and on staging now"), [w()])).toBe("claimed-landing");
  });

  test("small talk is not recorded at all", () => {
    expect(isChat(byTs("1788921243.757189"), [w()])).toBe(true);
    expect(isChat(byTs(REPLY), [w()])).toBe(true);
    expect(isChat(byTs(BILLING), [w()])).toBe(false);
  });

  test("a message that is neither provable nor small talk is left for a reader", () => {
    const item = says("I think we should probably revisit how the invoice register orders its rows before Angie sees it");
    expect(classify(item, [w()])).toBeNull();
    expect(isChat(item, [w()])).toBe(false);
  });
});

describe("the canvas", () => {
  const from = items.find((i) => i.canvas)!;

  test("notes nobody has read go to the queue, asking for marauder huddle", () => {
    const { unsorted, work, changes } = applySlack({ work: [w()], items: [from], unsorted: [], milestones: {} });
    expect(changes[0]).toMatchObject({ kind: "unsorted", why: "a huddle canvas, unread" });
    expect(unsorted[0]).toMatchObject({ id: from.id, needs: "read", why: unreadCanvasWhy(from.threadTs ?? from.ts) });
    expect(work[0]!.events).toEqual([]);
  });

  test("notes already read are not asked about again — an event or a queue entry under them is enough", () => {
    const root = from.threadTs ?? from.ts;
    const taken = w({ events: [{ at: "2026-09-09T02:34:00Z", kind: "contract-change", summary: "Angie ruled on the retainer.", source: { type: "huddle", ref: `${root}#1` }, attached: { how: "read", confidence: "guess" } }] });
    expect(applySlack({ work: [taken], items: [from], unsorted: [], milestones: {} }).changes[0]).toMatchObject({ kind: "skipped", why: "these huddle notes are already taken in" });
    const entry = { id: `${root}#2`, kind: "slack" as const, summary: "Foong wants something.", candidates: [], suggest: null, needs: "read" as const, at: from.at };
    expect(applySlack({ work: [w()], items: [from], unsorted: [entry], milestones: {} }).changes[0]).toMatchObject({ kind: "skipped" });
  });
});

describe("applying", () => {
  test("an item that places and types cleanly becomes an event", () => {
    const { work, changes } = applySlack({ work: [w()], items: [byTs(BILLING)], unsorted: [], milestones: {} });
    expect(changes[0]).toMatchObject({ kind: "attached", feature: "admin/invoicing", how: "thread", confidence: "certain", eventKind: "directed-at-person" });
    const e = work[0]!.events[0]!;
    expect(e.to).toEqual(["you", "Carlos Lopes"]);
    expect(e.source).toMatchObject({ type: "slack", ref: BILLING });
    expect(validate(work[0]!, work[0]!.feature)).toEqual([]);
  });

  test("a feature with nothing going on gets its record when an alias places a message on it", () => {
    const item = says("PATCH /api/v1/usage/history now saves the usage page edits");
    const { work, changes } = applySlack({ work: [], items: [item], unsorted: [], milestones: {}, features: [ref("admin/usage", ["usage page"])] });
    expect(changes[0]).toMatchObject({ kind: "attached", feature: "admin/usage", how: "vocab", confidence: "likely" });
    expect(work.map((x) => x.feature)).toEqual(["admin/usage"]);
    expect(validate(work[0]!, "admin/usage")).toEqual([]);
  });

  test("an item nothing claims goes to the queue with no candidate, and no record changes", () => {
    const stray = says("Angie wants the register sorted by client before tonight, can someone take it?");
    const { work, unsorted } = applySlack({ work: [w({ keys: { ...w().keys, threads: [], vocab: [] } })], items: [stray], unsorted: [], milestones: {} });
    expect(work[0]!.events).toEqual([]);
    expect(unsorted[0]).toMatchObject({ id: stray.id, kind: "slack", needs: "read", suggest: null, candidates: [] });
  });

  test("an item two features claim is queued with both as candidates, and nothing in the queue names a slug or proposes anything", () => {
    const ask = { ...says("Someone should add a client column to the usage page"), kind: "new-ask" as const };
    const features = [ref("admin/usage", ["usage page"]), ref("admin/clients", ["client column"])];
    const { unsorted, changes } = applySlack({ work: [], items: [ask], unsorted: [], milestones: {}, features });
    expect(changes[0]!.kind).toBe("unsorted");
    expect(unsorted[0]!.candidates.map((c) => c.feature)).toEqual(["admin/clients", "admin/usage"]);
    expect(unsorted[0]!.kind).toBe("slack");
    for (const u of unsorted) {
      expect(u).not.toHaveProperty("slug");
      expect(u).not.toHaveProperty("name");
    }
  });

  test("a long (bot) author name still leaves the unsorted summary inside the render ceiling", () => {
    const stray = {
      ...says("Ticket has been created by Foong Leung, you can track progress with the commands /summary or /summary:all, or visit our trello board at https://trello.com/invite/some/long/path"),
      author: "SWE Slack To Trello",
    } as SlackItem;
    const { unsorted } = applySlack({ work: [w({ keys: { ...w().keys, threads: [], vocab: [] } })], items: [stray], unsorted: [], milestones: {} });
    const summary = unsorted[0]!.summary;
    expect(summary).toStartWith("SWE Slack To Trello:");
    expect(summary.split(/\s+/).length).toBeLessThanOrEqual(21);
  });

  test("the whole day, run twice, writes nothing the second time", () => {
    const first = applySlack({ work: [w()], items, unsorted: [], milestones: {} });
    const second = applySlack({ work: first.work, items, unsorted: first.unsorted, milestones: first.milestones });
    expect(second.work).toEqual(first.work);
    expect(second.unsorted).toEqual(first.unsorted);
    expect(second.changes.every((c) => c.kind === "skipped")).toBe(true);
  });

  test("the summary frames a person doing something and stays inside the ceiling", () => {
    const line = slackSummary(byTs(BILLING), "directed-at-person");
    expect(line).toStartWith("Sam O asked you and Carlos:");
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
});
