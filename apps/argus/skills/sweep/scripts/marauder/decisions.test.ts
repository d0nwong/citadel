/**
 * decisions.ts — what a person decided in Pensieve, applied (ARG-160 AC4, over features since ARG-164).
 *
 * The cases are the other half of the contract Pensieve's `server/decisions.ts` writes: a
 * decision file is read, applied through the correction functions, and left on disk; one
 * naming an entry that is gone applies nothing and complains about nothing; one that is
 * malformed — or carries a verb the workstreams took with them — is said out loud.
 *
 *   bun test skills/sweep/scripts/marauder/decisions.test.ts
 */

import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, parseDecision, readDecisions, type MarauderDecision } from "./decisions.ts";
import { CONFIRMED, dismiss, type State } from "./correct.ts";
import type { FeatureRef, UnsortedItem, Work, WorkEvent } from "./record.ts";

const FEATURES: FeatureRef[] = [{ feature: "admin/usage", app: "alden/alden-portal", aliases: [] }];

const w = (over: Partial<Work> = {}): Work => ({
  feature: "admin/usage",
  keys: { tickets: [], prs: ["fe#417"], threads: [], vocab: [] },
  open_questions: [],
  events: [],
  updated: "2026-09-09T04:00:00Z",
  ...over,
});

const item = (over: Partial<UnsortedItem> = {}): UnsortedItem => ({
  id: "1788949866.296519",
  kind: "slack",
  summary: "Sam O: the assetEntityId on each subtask row should be editable.",
  text: "the `assetEntityId` on each subtask row should be editable",
  source: { type: "slack", ref: "1788949866.296519", url: "https://alden-studios.slack.com/archives/C07/p1788949866296519" },
  candidates: [],
  suggest: "admin/usage",
  needs: "read",
  at: "2026-09-09T14:31:06Z",
  ...over,
});

const state = (over: Partial<State> = {}): State => ({ work: [w()], unsorted: [item()], milestones: {}, features: FEATURES, ...over });

const decision = (over: Partial<MarauderDecision> = {}): MarauderDecision => ({
  id: item().id,
  action: "attach",
  feature: "admin/usage",
  at: "2026-09-09T20:00:00.000Z",
  by: "Liam Leung",
  ...over,
});

const dirs: string[] = [];
async function blackboard(files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "marauder-decisions-"));
  dirs.push(root);
  for (const [name, value] of Object.entries(files))
    await Bun.write(join(root, "decisions", "marauder", name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return root;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("reading the files", () => {
  test("oldest first, and the id inside the file is what matches — not its name", async () => {
    const root = await blackboard({
      "1788949866-296519.json": decision(),
      "fe-420.json": decision({ id: "fe#420", action: "dismiss", feature: undefined, reason: "chat", at: "2026-09-09T19:00:00.000Z" }),
    });
    const { decisions, unreadable } = await readDecisions(root);
    expect(unreadable).toEqual([]);
    expect(decisions.map((d) => d.id)).toEqual(["fe#420", "1788949866.296519"]);
  });

  test("no decisions directory at all is no decisions, not a failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "marauder-decisions-"));
    dirs.push(root);
    expect(await readDecisions(root)).toEqual({ decisions: [], unreadable: [] });
  });

  test("a half-written file is not a decision", async () => {
    const root = await blackboard({ ".x.json.tmp-abcd1234": "{", "ok.json": decision() });
    const { decisions, unreadable } = await readDecisions(root);
    expect(unreadable).toEqual([]);
    expect(decisions).toHaveLength(1);
  });

  test.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["no id", { action: "attach", feature: "x" }],
    ["an unknown verb", { id: "x", action: "ignore" }],
    ["an attach naming no feature", { id: "x", action: "attach" }],
    ["a dismiss with no reason", { id: "x", action: "dismiss" }],
    ["a new, which went with the workstreams", { id: "x", action: "new", name: "Something" }],
    ["a stage, which went with the workstreams", { id: "x", action: "stage", slug: "y", side: "fe", stage: "landed" }],
    ["an attach naming a workstream slug and no feature", { id: "x", action: "attach", slug: "usage-page" }],
  ])("%s is reported, since nothing else in the sweep reads this group", async (_what, file) => {
    const root = await blackboard({ "bad.json": file });
    const { decisions, unreadable } = await readDecisions(root);
    expect(decisions).toEqual([]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.file).toBe("marauder/bad.json");
  });

  test("a file that parses carries who decided and why", () => {
    const parsed = parseDecision(JSON.stringify(decision({ reason: "it is Sam's subtask thread" })));
    expect(parsed).toMatchObject({ decision: { by: "Liam Leung", reason: "it is Sam's subtask thread", feature: "admin/usage" } });
  });

  test("an attach naming a workstream slug says so in one sentence", () => {
    expect(parseDecision(JSON.stringify({ id: "x", action: "attach", slug: "usage-page", at: "", by: "Liam Leung" }))).toEqual({
      error: 'attach names the workstream "usage-page", and workstreams are gone — name the feature instead',
    });
  });
});

describe("applying them", () => {
  test("an attach moves the entry onto the feature and learns from it", () => {
    const { state: next, changes } = apply(state(), [decision()]);
    expect(changes).toHaveLength(1);
    expect(next.unsorted).toEqual([]);
    const w0 = next.work[0]!;
    expect(w0.events.at(-1)!.summary).toBe(item().summary);
    expect(w0.events.at(-1)!.attached).toMatchObject({ how: "human", by: "Liam Leung" });
    // the correction leaves a rule behind, which is the whole point of making it by hand
    expect(w0.keys.threads).toContain("1788949866.296519");
    expect(w0.keys.vocab).toContain("assetEntityId");
  });

  test("an old attach naming a workstream slug applies nothing", () => {
    const { state: next, changes } = apply(state(), [decision({ feature: "history-subtask-rows" })]);
    expect(changes).toEqual([]);
    expect(next.unsorted).toHaveLength(1);
  });

  test("a dismiss drops the entry, and the reason is why it is nowhere", () => {
    const { state: next, changes } = apply(state(), [
      decision({ action: "dismiss", feature: undefined, reason: "answered in the thread" }),
    ]);
    expect(next.unsorted).toEqual([]);
    expect(changes[0]!.notes[0]).toContain("dismissed — answered in the thread");
    // and it teaches nothing: there is no feature this belongs to
    expect(next.work[0]!.events).toEqual([]);
  });

  test("a decision naming an entry that is gone applies nothing and says nothing", () => {
    const empty = state({ unsorted: [] });
    const { state: next, changes } = apply(empty, [decision()]);
    expect(changes).toEqual([]);
    expect(next).toEqual(empty);
  });

  test("applying the same file twice changes nothing the second time", () => {
    const once = apply(state(), [decision()]);
    const twice = apply(once.state, [decision()]);
    expect(twice.changes).toEqual([]);
    expect(twice.state).toEqual(once.state);
  });

  test("two decisions apply in the order they were made", () => {
    const two = state({
      unsorted: [item(), item({ id: "fe#420", summary: "A merge that named nothing.", suggest: null })],
    });
    const { state: next, changes } = apply(two, [
      decision({ id: "fe#420", action: "dismiss", feature: undefined, reason: "a revert", at: "2026-09-09T19:00:00.000Z" }),
      decision(),
    ]);
    expect(changes.map((c) => c.decision.id)).toEqual(["fe#420", "1788949866.296519"]);
    expect(next.unsorted).toEqual([]);
  });
});

describe("dismiss, the correction the decision file needed", () => {
  test("it refuses without a reason", () => {
    const r = dismiss(state(), item().id, { by: "Liam Leung", at: "2026-09-09T20:00:00Z" });
    expect(r.changed).toBe(false);
    expect(r.notes[0]).toContain("needs a reason");
  });

  test("it does nothing the second time", () => {
    const who = { by: "Liam Leung", reason: "chat", at: "2026-09-09T20:00:00Z" };
    const once = dismiss(state(), item().id, who);
    expect(dismiss(once.state, item().id, who).changed).toBe(false);
  });
});

describe("verified — the user answering what an event asked them (ARG-161)", () => {
  const held = (over: Partial<WorkEvent> = {}): WorkEvent => ({
    at: "2026-09-09T15:00:00Z",
    kind: "directed-at-person",
    summary: "ALD-1's Pending bullet looks answered, and Foundry is running the ticket.",
    to: ["you"],
    source: { type: "ticket", ref: "ALD-1" },
    attached: { how: "human", confidence: "certain", by: "Liam Leung" },
    ticket: "ALD-1",
    ...over,
  });
  const withHeld = (over: Partial<WorkEvent> = {}) => state({ work: [w({ events: [held(over)] })] });

  test("it stamps the event the go-ahead, keyed by the id the event is named by", () => {
    const { state: next, changes } = apply(withHeld(), [
      decision({ id: "ALD-1", action: "verified", feature: undefined, reason: "delete the bullet" }),
    ]);
    expect(next.work[0]!.events[0]!.action).toBe(`${CONFIRMED} delete the bullet — Liam Leung`);
    expect(changes[0]!.notes[0]).toContain("confirmed ALD-1");
  });

  test("a second confirmation of the same event changes nothing", () => {
    const once = apply(withHeld(), [decision({ id: "ALD-1", action: "verified", feature: undefined })]);
    expect(apply(once.state, [decision({ id: "ALD-1", action: "verified", feature: undefined })]).changes).toEqual([]);
  });

  test("an event no feature carries is skipped, like every other stale decision", () => {
    expect(apply(withHeld(), [decision({ id: "fe#999", action: "verified", feature: undefined })]).changes).toEqual([]);
  });

  test("it needs no feature and no reason — the event says what was asked", () => {
    const parsed = parseDecision(JSON.stringify({ id: "ALD-1", action: "verified", at: "2026-09-09T20:00:00.000Z", by: "Liam Leung" }));
    expect(parsed).toHaveProperty("decision");
  });
});
