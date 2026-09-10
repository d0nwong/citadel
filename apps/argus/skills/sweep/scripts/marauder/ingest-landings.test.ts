/**
 * ingest-landings.ts — a merge on a base branch becomes an event (ARG-156).
 *
 * The cases are the ticket's AC5, over fixtures rather than a repo: a PR match, a
 * ticket-in-branch match, a two-candidate ambiguity, a no-match, a re-run, and a landing on
 * a side already verified. Nothing here touches git, so the ladder is testable without
 * either product checkout.
 *
 *   bun test skills/sweep/scripts/marauder/ingest-landings.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  applyLandings,
  candidatesFor,
  landingSummary,
  plainSentence,
  sinceFor,
  ticketsOf,
  isBot,
  type ApplyInput,
} from "./ingest-landings.ts";
import type { Landing } from "../../../log-change/scripts/pr-facts.ts";
import type { AppJournalEntry } from "../../../../scripts/lib/journal.ts";
import { validate, type Workstream } from "./record.ts";

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

const w = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "history-editing",
  name: "History editing",
  features: ["admin/usage"],
  wants: [],
  done: "A bookkeeper can change a past cycle's quantities and the invoice re-prices.",
  stage: { fe: "building", be: "building" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: ["ALD-2"], prs: ["fe#417"], threads: [], vocab: [], people: [] },
  open_questions: [],
  facts: [],
  events: [],
  opened: "2026-09-07",
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
  features: ["admin-usage"],
  tickets: [],
  affects: [],
  ...over,
});

const apply = (over: Partial<ApplyInput>) =>
  applyLandings({ workstreams: [w()], landings: [landing()], journals: [], unsorted: [], ...over });

describe("the ladder", () => {
  test("a PR already in keys.prs attaches for certain and moves the stage", () => {
    const { workstreams, changes } = apply({});
    expect(changes[0]).toMatchObject({ kind: "attached", slug: "history-editing", how: "ref", confidence: "certain" });
    const ws = workstreams[0]!;
    expect(ws.stage.fe).toBe("landed");
    expect(ws.stage.be).toBe("building");
    expect(ws.events).toHaveLength(1);
    expect(ws.events[0]).toMatchObject({
      kind: "verified-landing",
      side: "fe",
      source: { type: "pr", ref: "fe#417", sha: "ac1caffd6" },
      action: "stage fe → landed",
    });
    expect(validate(ws, ws.slug)).toEqual([]);
  });

  test("a ticket in the branch attaches, and the PR joins the keys it was missing", () => {
    const { workstreams, changes } = apply({
      workstreams: [w({ keys: { tickets: ["ALD-1"], prs: [], threads: [], vocab: [], people: [] } })],
      landings: [landing({ ref: "fe#419", pr: 419, branch: "yickkiuleung/ald-1-join-credit-weights", title: "join the credit weights on the asset type" })],
    });
    expect(changes[0]).toMatchObject({ kind: "attached", how: "ref", confidence: "certain" });
    expect(workstreams[0]!.keys.prs).toEqual(["fe#419"]);
  });

  test("a landing the journal ties to one workstream attaches, but only as likely", () => {
    const { changes } = apply({
      workstreams: [w({ keys: { tickets: [], prs: [], threads: ["1788774985.655159"], vocab: [], people: [] } })],
      journals: [journal({ merge: "ac1caffd6" })],
    });
    expect(changes[0]).toMatchObject({ kind: "attached", how: "vocab", confidence: "likely" });
  });

  test("the journal entry for the sha becomes the event's evidence", () => {
    const { workstreams } = apply({ journals: [journal({ merge: "ac1caffd6" })] });
    expect(workstreams[0]!.events[0]!.evidence).toBe("alden/alden-portal/features/admin/usage/journal/2026-09/2026-09-09/x.md");
  });

  test("with no journal entry the event carries the sha, for a later run to fill in", () => {
    const { workstreams } = apply({});
    expect(workstreams[0]!.events[0]!.evidence).toBeUndefined();
    expect(workstreams[0]!.events[0]!.source!.sha).toBe("ac1caffd6");
  });

  test("two claimants go to unsorted with both, and neither workstream changes", () => {
    const a = w({ slug: "one", name: "One" });
    const b = w({ slug: "two", name: "Two" });
    const { workstreams, unsorted, changes } = apply({ workstreams: [a, b] });
    expect(changes[0]!.kind).toBe("unsorted");
    expect(workstreams.every((x) => x.events.length === 0)).toBe(true);
    expect(unsorted).toHaveLength(1);
    expect(unsorted[0]).toMatchObject({ id: "fe#417", kind: "landing", suggest: "one", needs: "read" });
    expect(unsorted[0]!.candidates.map((c) => c.slug)).toEqual(["one", "two"]);
  });

  test("a landing nobody claims goes to unsorted with no candidate and no suggestion", () => {
    const { unsorted, workstreams } = apply({ workstreams: [w({ keys: { tickets: [], prs: [], threads: ["x"], vocab: [], people: [] } })] });
    expect(unsorted[0]).toMatchObject({ id: "fe#417", candidates: [], suggest: null });
    expect(workstreams[0]!.events).toEqual([]);
  });

  test("candidatesFor stops at the rung that answers, rather than falling through to a weaker one", () => {
    const byPr = w({ slug: "by-pr" });
    const byJournal = w({ slug: "by-journal", keys: { tickets: [], prs: [], threads: ["x"], vocab: [], people: [] } });
    const found = candidatesFor(landing(), [byPr, byJournal], [journal({ merge: "ac1caffd6" })]);
    expect(found.map((c) => c.slug)).toEqual(["by-pr"]);
  });
});

describe("idempotence", () => {
  test("a landing already recorded is skipped and nothing changes", () => {
    const once = apply({});
    const twice = applyLandings({ workstreams: once.workstreams, landings: [landing()], journals: [], unsorted: once.unsorted });
    expect(twice.changes[0]).toMatchObject({ kind: "skipped" });
    expect(twice.workstreams).toEqual(once.workstreams);
  });

  test("a landing already unsorted is not queued twice", () => {
    const once = apply({ workstreams: [w({ slug: "one" }), w({ slug: "two" })] });
    const twice = applyLandings({ workstreams: once.workstreams, landings: [landing()], journals: [], unsorted: once.unsorted });
    expect(twice.unsorted).toHaveLength(1);
    expect(twice.changes[0]).toMatchObject({ kind: "skipped", why: "already unsorted" });
  });

  test("a landing recognised by its sha alone is still the same landing", () => {
    const once = apply({});
    const renumbered = landing({ ref: "fe@ac1caffd6", pr: null, url: null });
    expect(applyLandings({ workstreams: once.workstreams, landings: [renumbered], journals: [], unsorted: [] }).changes[0]!.kind).toBe("skipped");
  });
});

describe("stages", () => {
  test("a side already verified keeps its stage and still gets the event", () => {
    const { workstreams, changes } = apply({ workstreams: [w({ stage: { fe: "verified" } })] });
    expect(workstreams[0]!.stage.fe).toBe("verified");
    expect(workstreams[0]!.events).toHaveLength(1);
    expect(workstreams[0]!.events[0]!.action).toBeUndefined();
    expect(changes[0]).toMatchObject({ kind: "attached", stage: null });
  });

  test("a side already shipped keeps its stage", () => {
    expect(apply({ workstreams: [w({ stage: { fe: "shipped" } })] }).workstreams[0]!.stage.fe).toBe("shipped");
  });

  test("a side the record never had starts at landed", () => {
    expect(apply({ workstreams: [w({ stage: { be: "building" } })] }).workstreams[0]!.stage.fe).toBe("landed");
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
  test("it starts at the newest landing that side already holds", () => {
    const ws = w({
      events: [
        { at: "2026-09-08T09:00:00Z", kind: "verified-landing", side: "fe", summary: "x", attached: { how: "ref", confidence: "certain" } },
        { at: "2026-09-09T09:00:00Z", kind: "verified-landing", side: "be", summary: "y", attached: { how: "ref", confidence: "certain" } },
      ],
    });
    expect(sinceFor([ws], "fe", "2026-09-09")).toBe("2026-09-08");
    expect(sinceFor([ws], "be", "2026-09-09")).toBe("2026-09-09");
  });

  test("a side with no landing yet starts cold, two weeks back", () => {
    expect(sinceFor([w()], "fe", "2026-09-09")).toBe("2026-08-26");
  });

  test("tickets are read from the branch as well as the title, case-insensitively", () => {
    expect(ticketsOf(landing({ branch: "yickkiuleung/ald-2-history-save", title: "fix it" }))).toEqual(["ALD-2"]);
  });
});
