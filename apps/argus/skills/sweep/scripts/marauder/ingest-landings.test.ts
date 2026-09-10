/**
 * ingest-landings.ts — a merge on a base branch becomes an event on every feature it
 * touched (ARG-156, ARG-164 AC1).
 *
 * Over fixtures rather than a repo: a landing whose journal entry names two features, one
 * only pr-facts can place, one already on a record, one nothing names, and a re-run.
 * Nothing here touches git, so the ladder is testable without either product checkout.
 *
 *   bun test skills/sweep/scripts/marauder/ingest-landings.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  applyLandings,
  featuresFor,
  landingSummary,
  plainSentence,
  sinceFor,
  ticketsOf,
  isBot,
  type ApplyInput,
} from "./ingest-landings.ts";
import type { Landing } from "../../../log-change/scripts/pr-facts.ts";
import type { AppJournalEntry } from "../../../../scripts/lib/journal.ts";
import { validate, type FeatureRef, type Work } from "./record.ts";

const landing = (over: Partial<Landing> = {}): Landing => ({
  repo: "fe",
  ref: "fe#417",
  sha: "ac1caffd6028650d15a0bd636df02ab506549aca",
  short: "ac1caffd6",
  at: "2026-09-09T09:21:40Z",
  date: "2026-09-09",
  author: "lleung",
  pr: 417,
  url: "https://bitbucket.org/aldenstudios/alden-portal-fe/pull-requests/417",
  branch: "foundry/currently-in-the",
  title: "feat(usage): key History asset columns and edits by assetEntityId",
  tickets: [],
  ...over,
});

const FEATURES: FeatureRef[] = [
  { feature: "admin/usage", app: "alden/alden-portal", id: "admin-usage", aliases: [] },
  { feature: "admin/invoicing", app: "alden/alden-portal", id: "admin-invoicings", aliases: [] },
  { feature: "tasks", app: "alden/alden-portal", id: "tasks", aliases: [] },
];

const work = (over: Partial<Work> = {}): Work => ({
  feature: "admin/usage",
  keys: { tickets: [], prs: [], threads: [], vocab: [] },
  open_questions: [],
  events: [],
  updated: "2026-09-07",
  ...over,
});

const journal = (over: Partial<AppJournalEntry> = {}): AppJournalEntry => ({
  name: "admin/usage/journal/2026-09/2026-09-09/x.md",
  path: "/tmp/x.md",
  rel: "alden/alden-portal/features/admin/usage/journal/2026-09/2026-09-09/x.md",
  app: "alden/alden-portal",
  featureDir: "admin/usage",
  date: "2026-09-09",
  merge: "ac1caffd6",
  features: ["admin-usage"],
  tickets: [],
  affects: [],
  ...over,
});

const apply = (over: Partial<ApplyInput>) =>
  applyLandings({ work: [], landings: [landing()], journals: [], unsorted: [], features: FEATURES, ...over });

describe("the ladder", () => {
  test("a landing whose journal names two features is a verified landing on both, for certain, with its sha", () => {
    const { work: out, unsorted, changes } = apply({ journals: [journal({ features: ["admin-usage", "admin-invoicings"] })] });
    expect(changes[0]).toMatchObject({ kind: "attached", features: ["admin/usage", "admin/invoicing"] });
    expect(unsorted).toEqual([]);
    for (const feature of ["admin/usage", "admin/invoicing"]) {
      const w = out.find((x) => x.feature === feature)!;
      expect(w.events).toHaveLength(1);
      expect(w.events[0]).toMatchObject({
        kind: "verified-landing",
        side: "fe",
        source: { type: "pr", ref: "fe#417", sha: "ac1caffd6" },
        attached: { how: "ref", confidence: "certain" },
        evidence: journal().rel,
      });
      expect(w.events[0]!.action).toBeUndefined();
      expect(w.keys.prs).toEqual(["fe#417"]);
      expect(validate(w, feature)).toEqual([]);
    }
  });

  test("the manifest's own spelling is followed: admin-invoicings is admin/invoicing, not admin/invoicings", () => {
    const found = featuresFor(landing(), { work: [], journals: [journal({ features: ["admin-invoicings"] })], dirs: { "admin-invoicings": "admin/invoicing" } });
    expect(found.map((c) => c.feature)).toEqual(["admin/invoicing"]);
  });

  test("with no journal entry yet, the features pr-facts maps the files to are the answer", () => {
    const { work: out } = apply({ named: { "fe#417": ["admin-usage", "tasks"] } });
    expect(out.map((w) => w.feature).sort()).toEqual(["admin/usage", "tasks"]);
    expect(out[0]!.events[0]!.evidence).toBeUndefined();
    expect(out[0]!.events[0]!.source!.sha).toBe("ac1caffd6");
  });

  test("the journal outranks pr-facts, which only hints at what a change grazed", () => {
    const { work: out } = apply({ journals: [journal()], named: { "fe#417": ["tasks", "admin-invoicings"] } });
    expect(out.map((w) => w.feature)).toEqual(["admin/usage"]);
  });

  test("with neither, a record already holding a ticket the branch names takes it", () => {
    const held = work({ feature: "tasks", keys: { tickets: ["ALD-1"], prs: [], threads: [], vocab: [] } });
    const { work: out, changes } = apply({ work: [held], landings: [landing({ ref: "fe#419", pr: 419, branch: "yickkiuleung/ald-1-join-credit-weights" })] });
    expect(changes[0]).toMatchObject({ kind: "attached", features: ["tasks"] });
    expect(out[0]!.keys.prs).toEqual(["fe#419"]);
  });

  test("a landing that names no feature goes to the queue, and no record changes", () => {
    const before = [work({ events: [] })];
    const { work: out, unsorted } = apply({ work: before });
    expect(out).toEqual(before);
    expect(unsorted).toHaveLength(1);
    expect(unsorted[0]).toMatchObject({ id: "fe#417", kind: "landing", candidates: [], suggest: null, needs: "read" });
  });

  test("a feature no app has is not invented", () => {
    const { work: out, unsorted } = apply({ named: { "fe#417": ["nowhere"] } });
    expect(out).toEqual([]);
    expect(unsorted).toHaveLength(1);
  });

  test("a landing a reader once queued is placed once something names it, and leaves the queue", () => {
    const queued = apply({}).unsorted;
    const { unsorted } = apply({ unsorted: queued, journals: [journal()] });
    expect(unsorted).toEqual([]);
  });
});

describe("idempotence", () => {
  test("a landing already recorded is skipped and nothing changes", () => {
    const once = apply({ journals: [journal()] });
    const twice = applyLandings({ ...once, landings: [landing()], journals: [journal()], features: FEATURES });
    expect(twice.changes[0]).toMatchObject({ kind: "skipped" });
    expect(twice.work).toEqual(once.work);
  });

  test("a landing already unsorted is not queued twice", () => {
    const once = apply({});
    const twice = applyLandings({ work: once.work, landings: [landing()], journals: [], unsorted: once.unsorted, features: FEATURES });
    expect(twice.unsorted).toHaveLength(1);
    expect(twice.changes[0]).toMatchObject({ kind: "skipped", why: "already unsorted" });
  });

  test("a landing recognised by its sha alone is still the same landing", () => {
    const once = apply({ journals: [journal()] });
    const renumbered = landing({ ref: "fe@ac1caffd6", pr: null, url: null });
    expect(applyLandings({ work: once.work, landings: [renumbered], journals: [], unsorted: [], features: FEATURES }).changes[0]!.kind).toBe("skipped");
  });

  test("a release bot is not a person and lands nothing", () => {
    expect(isBot("alden-portal-fe-release-token")).toBe(true);
    expect(apply({ landings: [landing({ author: "alden-portal-fe-release-token" })] }).changes[0]).toMatchObject({ kind: "skipped" });
  });
});

describe("the summary", () => {
  test("a conventional-commit title becomes a clause a person could have written", () => {
    expect(landingSummary(landing())).toBe("You landed key History asset columns and edits by assetEntityId.");
  });

  test("a named author is named the way the channel names them", () => {
    expect(landingSummary(landing({ author: "Sam O'Shaughnessy", repo: "be", title: "fix: resolve the asset type by name" })))
      .toBe("Sam O landed resolve the asset type by name.");
  });

  test("a title that is only a link carries no sentence, so the summary says only what happened", () => {
    expect(plainSentence("https://linear.app/liamai/issue/ALD-1/fe-join-historys-credit").weak).toBe(true);
    expect(landingSummary(landing({ title: "https://linear.app/liamai/issue/ALD-1/fe-join" }))).toBe("You landed a frontend change.");
  });

  test("a leading ticket key or repo tag comes off, so no summary starts with an id", () => {
    expect(plainSentence("ALD-2 fix the history save").text).toBe("fix the history save");
    expect(plainSentence("[FE] Render the entity name").text).toBe("render the entity name");
  });
});

describe("the window", () => {
  test("it starts at the newest landing any feature holds from that side", () => {
    const w = work({
      events: [
        { at: "2026-09-08T09:00:00Z", kind: "verified-landing", side: "fe", summary: "x", attached: { how: "ref", confidence: "certain" } },
        { at: "2026-09-09T09:00:00Z", kind: "verified-landing", side: "be", summary: "y", attached: { how: "ref", confidence: "certain" } },
      ],
    });
    expect(sinceFor([w], "fe", "2026-09-09")).toBe("2026-09-08");
    expect(sinceFor([w], "be", "2026-09-09")).toBe("2026-09-09");
  });

  test("a side with no landing yet starts cold, two weeks back", () => {
    expect(sinceFor([work()], "fe", "2026-09-09")).toBe("2026-08-26");
  });

  test("tickets are read from the branch as well as the title, case-insensitively", () => {
    expect(ticketsOf(landing({ branch: "yickkiuleung/ald-2-history-save", title: "fix it" }))).toEqual(["ALD-2"]);
  });
});
