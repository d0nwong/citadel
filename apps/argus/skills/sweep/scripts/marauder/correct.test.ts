/**
 * correct.ts — the corrections (LIA-158).
 *
 * The cases are the ticket's acceptance criteria: attaching an item and learning enough
 * from it that the next one attaches itself (AC1), opening a workstream from a proposal
 * (AC2), cutting one in two (AC3), overriding a stage with a reason (AC4), and every verb
 * doing nothing the second time (AC6).
 *
 *   bun test skills/sweep/scripts/marauder/correct.test.ts
 */

import { test, expect, describe } from "bun:test";
import { attach, learn, newFrom, proposeSplit, setStage, split, suggest, type State, type Who } from "./correct.ts";
import { applySlack, slackCandidates, type SlackItem } from "./ingest-slack.ts";
import { humanStage, validate, type UnsortedItem, type Workstream } from "./record.ts";

const WHO: Who = { by: "Liam Leung", reason: "it is the billing fields thread", at: "2026-09-09T14:00:00Z" };

const w = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "entity-invoice-sender",
  name: "Each entity's own invoice sending address",
  features: ["admin/invoicing"],
  driver: "Sam O",
  wants: [],
  done: "An entity picks the address its invoices come from.",
  stage: { fe: "asked", be: "landed" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: [], prs: [], threads: [], vocab: [], people: [] },
  open_questions: [],
  facts: [],
  events: [{ at: "2026-09-09T04:00:00Z", kind: "contract-change", summary: "Sam added the field.", source: { type: "pr", ref: "be#765" }, attached: { how: "ref", confidence: "certain" } }],
  opened: "2026-09-09",
  updated: "2026-09-09T04:00:00Z",
  ...over,
});

const item = (over: Partial<UnsortedItem> = {}): UnsortedItem => ({
  id: "1788927279.211769",
  kind: "slack",
  summary: "Sam O: In a PR but that should be up today.",
  text: "@Liam Leung @Carlos Lopes\n\nIn a PR but that should be up today. LIA-116 covers it.\n`billedBy` and `sendAutomatedEmails` on PATCH `/api/v1/invoices/entity/{entityId}/billed-by`",
  source: { type: "slack", ref: "1788927279.211769", url: "https://alden-studios.slack.com/archives/C07KG06L601/p1788927279211769?thread_ts=1788921273.173019&cid=C07KG06L601" },
  candidates: [],
  suggest: null,
  needs: "read",
  at: "2026-09-09T04:14:00Z",
  ...over,
});

const state = (over: Partial<State> = {}): State => ({ workstreams: [w()], unsorted: [item()], milestones: {}, ...over });

describe("attach", () => {
  test("it moves the item onto the workstream and says who decided", () => {
    const { state: next, changed } = attach(state(), item().id, "entity-invoice-sender", WHO);
    expect(changed).toBe(true);
    expect(next.unsorted).toEqual([]);
    const e = next.workstreams[0]!.events.at(-1)!;
    expect(e.attached).toEqual({ how: "human", confidence: "certain", by: "Liam Leung" });
    expect(e.action).toBe(WHO.reason);
    expect(validate(next.workstreams[0]!, "entity-invoice-sender")).toEqual([]);
  });

  test("it learns the thread, the ticket and the identifiers the item used", () => {
    const keys = attach(state(), item().id, "entity-invoice-sender", WHO).state.workstreams[0]!.keys;
    expect(keys.threads).toEqual(["1788921273.173019"]);
    expect(keys.tickets).toEqual(["LIA-116"]);
    expect(keys.vocab).toContain("billedBy");
    expect(keys.vocab).toContain("sendAutomatedEmails");
    expect(keys.vocab).toContain("billed-by");
  });

  test("after it, a later reply in that thread attaches on its own", () => {
    const taught = attach(state(), item().id, "entity-invoice-sender", WHO).state.workstreams;
    const reply = { id: "1788999999.1", ts: "1788999999.1", threadTs: "1788921273.173019", text: "done", author: "Sam O", authorIsUser: false, mentionsUser: false, to: [], at: "2026-09-09T15:00:00Z", permalink: "https://x", day: "2026-09-09" } as SlackItem;
    expect(slackCandidates(reply, taught)[0]).toMatchObject({ slug: "entity-invoice-sender", how: "thread" });
  });

  test("a token another workstream already claims is not learned, and it says so", () => {
    const other = w({ slug: "other", name: "Other", keys: { ...w().keys, vocab: ["billedBy"] } });
    const { state: next, notes } = attach(state({ workstreams: [w(), other] }), item().id, "entity-invoice-sender", WHO);
    expect(next.workstreams[0]!.keys.vocab).not.toContain("billedBy");
    expect(notes.join(" ")).toContain('"billedBy" is left out — other already claims it');
  });

  test("--auto records the sweep's own reading, not a person's decision", () => {
    const { state: next } = attach(state(), item().id, "entity-invoice-sender", { ...WHO, auto: true, kind: "contract-change" });
    expect(next.workstreams[0]!.events.at(-1)!.attached).toEqual({ how: "read", confidence: "guess" });
  });

  test("attaching twice changes nothing the second time", () => {
    const once = attach(state(), item().id, "entity-invoice-sender", WHO).state;
    const twice = attach(once, item().id, "entity-invoice-sender", WHO);
    expect(twice.changed).toBe(false);
    expect(twice.notes[0]).toContain("already on entity-invoice-sender");
  });

  test("an unknown workstream or an unknown item is refused, not guessed at", () => {
    expect(attach(state(), item().id, "nope", WHO).changed).toBe(false);
    expect(attach(state(), "nope", "entity-invoice-sender", WHO).changed).toBe(false);
  });
});

describe("suggest", () => {
  test("it leaves the item in the queue and says where it probably goes", () => {
    const { state: next, changed } = suggest(state(), item().id, "entity-invoice-sender");
    expect(changed).toBe(true);
    expect(next.unsorted[0]!.suggest).toBe("entity-invoice-sender");
    expect(suggest(next, item().id, "entity-invoice-sender").changed).toBe(false);
  });
});

describe("new", () => {
  const proposal = item({ id: "1788999.1", kind: "new", name: "Rollover credits on the invoice", text: "We need `rolloverCredits` shown at the invoice foot" });

  test("it opens a workstream with the item as its first event", () => {
    const { state: next, changed } = newFrom(state({ unsorted: [proposal] }), proposal.id, { ...WHO, name: "Rollover credits on the invoice", features: ["admin/invoicing"] });
    expect(changed).toBe(true);
    const made = next.workstreams.find((x) => x.slug === "rollover-credits-on-the-invoice")!;
    expect(made.stage).toEqual({ fe: "asked" });
    expect(made.events).toHaveLength(1);
    expect(made.keys.vocab).toContain("rolloverCredits");
    expect(next.unsorted).toEqual([]);
    expect(validate(made, made.slug)).toEqual([]);
  });

  test("the same name twice attaches to the workstream that already exists", () => {
    const first = newFrom(state({ unsorted: [proposal] }), proposal.id, { ...WHO, name: "Rollover credits on the invoice" }).state;
    const again = newFrom({ ...first, unsorted: [proposal] }, proposal.id, { ...WHO, name: "Rollover credits on the invoice" });
    expect(again.state.workstreams).toHaveLength(2);
    expect(again.state.unsorted).toEqual([]);
  });
});

describe("split", () => {
  const busy = w({
    slug: "invoicing",
    name: "Invoicing",
    keys: { tickets: ["LIA-132", "LIA-79"], prs: ["fe#418", "be#748"], threads: [], vocab: ["due-on-receipt", "manual entry"], people: ["Sam O"] },
    events: [
      { at: "2026-09-08T09:00:00Z", kind: "verified-landing", side: "be", summary: "Sam landed the due-on-receipt route.", source: { type: "pr", ref: "fe#418" }, attached: { how: "ref", confidence: "certain" }, ticket: "LIA-132" },
      { at: "2026-09-02T09:00:00Z", kind: "verified-landing", side: "be", summary: "Sam landed the manual entry route.", source: { type: "pr", ref: "be#748" }, attached: { how: "ref", confidence: "certain" }, ticket: "LIA-79" },
    ],
  });
  const opts = { ...WHO, into: "manual-invoice-entry", name: "Manual entry on the Create invoice dialog", events: ["be#748"] };

  test("the named events move, and the keys only they brought move with them", () => {
    const { state: next, changed } = split(state({ workstreams: [busy] }), "invoicing", opts);
    expect(changed).toBe(true);
    const into = next.workstreams.find((x) => x.slug === "manual-invoice-entry")!;
    const from = next.workstreams.find((x) => x.slug === "invoicing")!;
    expect(into.events.map((e) => e.source?.ref)).toContain("be#748");
    expect(into.keys.prs).toEqual(["be#748"]);
    expect(into.keys.tickets).toEqual(["LIA-79"]);
    expect(from.keys.prs).toEqual(["fe#418"]);
    expect(from.keys.tickets).toEqual(["LIA-132"]);
    expect(into.keys.vocab).toEqual(["manual entry"]);
    expect(from.keys.vocab).toEqual(["due-on-receipt"]);
  });

  test("both sides get a note naming the other", () => {
    const { state: next } = split(state({ workstreams: [busy] }), "invoicing", opts);
    expect(next.workstreams.find((x) => x.slug === "invoicing")!.events.some((e) => e.summary.includes("Manual entry"))).toBe(true);
    expect(next.workstreams.find((x) => x.slug === "manual-invoice-entry")!.events.some((e) => e.summary.includes("Split out of Invoicing"))).toBe(true);
  });

  test("a split that would move everything is a rename, and is refused", () => {
    expect(split(state({ workstreams: [busy] }), "invoicing", { ...opts, events: ["be#748", "fe#418"] }).changed).toBe(false);
  });

  test("splitting into a name that exists is refused", () => {
    const once = split(state({ workstreams: [busy] }), "invoicing", opts).state;
    expect(split(once, "invoicing", opts).changed).toBe(false);
  });

  test("it clears any split waiting on that workstream", () => {
    const pending = proposeSplit(state({ workstreams: [busy] }), "invoicing", [{ name: "a", events: ["fe#418"] }, { name: "b", events: ["be#748"] }], WHO).state;
    expect(split(pending, "invoicing", opts).state.unsorted.filter((u) => u.kind === "split")).toEqual([]);
  });
});

describe("stage", () => {
  test("it sets the stage and keeps the reason on the event", () => {
    const { state: next, changed } = setStage(state(), "entity-invoice-sender", "be", "verified", { ...WHO, reason: "the docs refresh confirmed the rules" });
    expect(changed).toBe(true);
    const e = next.workstreams[0]!.events.at(-1)!;
    expect(next.workstreams[0]!.stage.be).toBe("verified");
    expect(e.action).toBe("stage be → verified");
    expect(e.summary).toBe("the docs refresh confirmed the rules");
    expect(humanStage(next.workstreams[0]!, "be")).toMatchObject({ stage: "verified" });
  });

  test("setting the stage it already has changes nothing", () => {
    expect(setStage(state(), "entity-invoice-sender", "be", "landed", WHO).changed).toBe(false);
  });

  test("a stage a person lowered is not raised again by a landing, and the disagreement is queued", async () => {
    const lowered = setStage(state(), "entity-invoice-sender", "be", "building", { ...WHO, reason: "Sam reverted it on dev" }).state;
    const { applyLandings } = await import("./ingest-landings.ts");
    const landing = {
      repo: "be" as const, ref: "be#799", sha: "aaaaaaaaaaaa", short: "aaaaaaaaa", at: "2026-09-09T16:00:00Z",
      date: "2026-09-09", author: "Sam O'Shaughnessy", pr: 799, url: null, branch: null, title: "put the mailbox picker back", tickets: [],
    };
    const claimed = { ...lowered.workstreams[0]!, keys: { ...lowered.workstreams[0]!.keys, prs: ["be#799"] } };
    const { workstreams, unsorted } = applyLandings({ workstreams: [claimed], landings: [landing], journals: [], unsorted: [] });
    expect(workstreams[0]!.stage.be).toBe("building");
    expect(unsorted.some((u) => u.needs === "ask" && u.why?.includes("building"))).toBe(true);
  });
});

describe("propose-split", () => {
  const groups = [{ name: "Due on Receipt", events: ["fe#418"] }, { name: "Manual entry", events: ["be#748"] }];

  test("it queues a proposal and never cuts anything", () => {
    const { state: next, changed } = proposeSplit(state(), "entity-invoice-sender", groups, WHO);
    expect(changed).toBe(true);
    expect(next.workstreams).toHaveLength(1);
    expect(next.unsorted.at(-1)).toMatchObject({ kind: "split", slug: "entity-invoice-sender", needs: "ask" });
    expect(next.unsorted.at(-1)!.groups).toEqual(groups);
  });

  test("a workstream with a split already waiting gets no second one", () => {
    const once = proposeSplit(state(), "entity-invoice-sender", groups, WHO).state;
    expect(proposeSplit(once, "entity-invoice-sender", groups, WHO).changed).toBe(false);
  });

  test("one grouping is not a split", () => {
    expect(proposeSplit(state(), "entity-invoice-sender", [groups[0]!], WHO).changed).toBe(false);
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
});
