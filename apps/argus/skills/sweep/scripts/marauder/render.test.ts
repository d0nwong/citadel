/**
 * render.ts — the board, one workstream's page, and the day's changelog (LIA-155).
 *
 * The cases are the ticket's acceptance criteria: the board's sections and their order
 * (AC1), the line shape and the style checker that refuses a bad one (AC2), the workstream
 * page (AC3), the changelog's silence about workstreams that did not move (AC4), the
 * seven-day windows and the per-side stage sentence (AC5), and byte-identical re-renders
 * (AC6).
 *
 *   bun test skills/sweep/scripts/marauder/render.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  renderBoard,
  renderWorkstream,
  renderChangelog,
  checkStyle,
  stageSentence,
  areaOf,
  BANNED_WORDS,
  SENTENCE_WORDS,
} from "./render.ts";
import { loadWorkstreams, type Milestones, type Workstream, type WorkstreamEvent } from "./record.ts";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
const NOW = "2026-09-09T13:00:00Z";

const ev = (over: Partial<WorkstreamEvent> = {}): WorkstreamEvent => ({
  at: "2026-09-09T09:00:00Z",
  kind: "verified-landing",
  side: "fe",
  summary: "Sam landed the backend this afternoon.",
  source: { type: "pr", ref: "fe#417", url: "https://example.test/417" },
  attached: { how: "ref", confidence: "certain" },
  ...over,
});

const w = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "history-editing",
  name: "History editing",
  features: ["admin/usage"],
  driver: "Liam Leung",
  wants: ["Foong Leung"],
  done: "A bookkeeper can change a past cycle's quantities and the invoice re-prices.",
  stage: { fe: "landed", be: "building" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: ["LIA-116"], prs: ["fe#417"], threads: [], vocab: [], people: [] },
  open_questions: [],
  facts: [],
  events: [ev()],
  opened: "2026-09-07",
  updated: "2026-09-09T09:00:00Z",
  ...over,
});

const MILESTONES: Milestones = { "launch-2026-09-10": { name: "Launch", date: "2026-09-10", owner: "Foong Leung" } };
const headings = (md: string) => md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));

describe("the board", () => {
  const set = [
    w({ slug: "needs-you", name: "Subtask rows", events: [ev({ kind: "directed-at-person", to: ["you"], at: "2026-09-09T10:31:00Z", summary: "Sam asked you who builds the subtask rows." })] }),
    w({ slug: "in-flight", name: "History editing", events: [ev({ at: "2026-09-09T09:21:00Z" })] }),
    w({ slug: "waiting", name: "Roles on Usage rows", stage: { fe: "asked" }, overlay: { waiting_on: "Foong Leung", for: "which roles a row shows", since: "2026-09-09" }, events: [ev({ at: "2026-09-09T02:34:00Z", kind: "new-ask" })] }),
    w({ slug: "shipped", name: "Due on Receipt", stage: { fe: "landed", be: "landed" }, events: [ev({ at: "2026-09-08T09:00:00Z" })] }),
  ];

  test("the sections come in the order a reader needs them, and empty ones are left out", () => {
    expect(headings(renderBoard({ workstreams: set, milestones: MILESTONES, now: NOW })))
      .toEqual(["Needs you", "In flight", "Waiting on others", "Shipped this week"]);
    expect(headings(renderBoard({ workstreams: [set[1]!], milestones: MILESTONES, now: NOW }))).toEqual(["In flight"]);
  });

  test("a milestone inside seven days leads the page, and one outside it does not", () => {
    const pointed = [w({ milestone: "launch-2026-09-10" })];
    expect(renderBoard({ workstreams: pointed, milestones: MILESTONES, now: NOW })).toContain("Foong's launch is tomorrow, 10 September.");
    expect(renderBoard({ workstreams: pointed, milestones: MILESTONES, now: "2026-09-01T13:00:00Z" })).not.toContain("launch is");
  });

  test("shipped this week drops anything older than seven days", () => {
    const old = w({ slug: "old", name: "Old thing", stage: { fe: "landed", be: "landed" }, events: [ev({ at: "2026-08-30T09:00:00Z" })] });
    const md = renderBoard({ workstreams: [old], milestones: {}, now: NOW });
    expect(headings(md)).toEqual(["In flight"]);
  });

  test("in flight is grouped by area, waiting on others by the person", () => {
    const md = renderBoard({ workstreams: set, milestones: MILESTONES, now: NOW });
    expect(md).toContain("### Usage");
    expect(md).toContain("### Foong Leung");
  });

  test("every workstream is a bold name, at most two sentences, then a line of links", () => {
    const md = renderBoard({ workstreams: [w({ overlay: { waiting_on: "Sam O", for: "the id column", since: "2026-09-09" } })], milestones: {}, now: NOW });
    const block = md.split("### Sam O\n\n")[1]!.trim().split("\n").filter(Boolean);
    expect(block[0]).toBe("**History editing**");
    expect(block[1]).toBe("Sam landed the backend this afternoon.");
    expect(block[2]).toBe("You are waiting on Sam for the id column.");
    expect(block[3]).toStartWith("[the frontend PR](");
    expect(block).toHaveLength(4);
  });

  test("a parked workstream is on no section of the board", () => {
    expect(renderBoard({ workstreams: [w({ parked: true })], milestones: {}, now: NOW })).not.toContain("History editing");
  });

  test("the board passes its own style rules", () => {
    expect(checkStyle(renderBoard({ workstreams: set, milestones: MILESTONES, now: NOW }))).toEqual([]);
  });
});

describe("the stage sentence", () => {
  test("a workstream landed on the front end and building on the back says both", () => {
    expect(stageSentence(w())).toBe("The frontend is on staging; the backend is still in a PR.");
  });

  test("a workstream with one side says only that side", () => {
    expect(stageSentence(w({ stage: { be: "landed" } }))).toBe("The backend is on dev.");
  });

  test("an area is the way the team says the feature, not the folder", () => {
    expect(areaOf(w())).toBe("Usage");
    expect(areaOf(w({ features: ["admin/invoicing"] }))).toBe("Invoicing");
    expect(areaOf(w({ features: [] }))).toBe("Elsewhere");
  });
});

describe("one workstream's page", () => {
  const page = renderWorkstream(
    w({
      milestone: "launch-2026-09-10",
      open_questions: [{ q: "Does the credit-weight join need its own id column?", asked_by: "sweep", at: "2026-09-09", owner: "Sam O" }],
      events: [ev({ at: "2026-09-07" }), ev({ at: "2026-09-09T09:21:00Z", summary: "You merged the front end onto the new key." })],
    }),
    MILESTONES,
    NOW,
  );

  test("it says who drives it, what done means and where both sides stand", () => {
    expect(page).toContain("You drive this, and Foong Leung wants it.");
    expect(page).toContain("Done means: A bookkeeper can change");
    expect(page).toContain("The frontend is on staging; the backend is still in a PR.");
  });

  test("open questions carry whose move they are", () => {
    expect(page).toContain("- Does the credit-weight join need its own id column? Sam O to answer.");
  });

  test("what happened is newest first, and there is no table of landings", () => {
    const first = page.indexOf("You merged the front end");
    const second = page.indexOf("Sam landed the backend");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(page).not.toContain("|---|");
  });

  test("it passes its own style rules", () => {
    expect(checkStyle(page)).toEqual([]);
  });
});

describe("the changelog", () => {
  const moved = w({ slug: "moved", name: "History editing", events: [ev({ at: "2026-09-09T09:21:00Z" })] });
  const still = w({ slug: "still", name: "Old thing", events: [ev({ at: "2026-09-04" })] });
  const md = renderChangelog([moved, still], "2026-09-09");

  test("it holds the workstreams that gained an event that day and no others", () => {
    expect(md).toContain("**History editing**");
    expect(md).not.toContain("Old thing");
  });

  test("a quiet day says so rather than inventing a page", () => {
    expect(renderChangelog([still], "2026-09-09")).toContain("Nothing moved.");
  });

  test("it passes its own style rules", () => {
    expect(checkStyle(md)).toEqual([]);
  });

  test("two same-day events on one workstream read as two sentences, not a run-on", () => {
    const busy = w({
      slug: "busy",
      name: "Subtask rows",
      events: [
        ev({ at: "2026-09-09T09:00:00Z", summary: "Foong Leung: crap sorry i was way too tired last night i'll review this this morning" }),
        ev({ at: "2026-09-09T09:01:00Z", summary: "Foong Leung: we'll still probably launch with the feature not working yet today" }),
      ],
    });
    const page = renderChangelog([busy], "2026-09-09");
    expect(page).toContain("this morning. Foong Leung: we'll");
    expect(checkStyle(page)).toEqual([]);
  });
});

describe("checkStyle", () => {
  test("a line of reader text starting with a ticket key is refused", () => {
    const problems = checkStyle("LIA-116 is still open.");
    expect(problems).toHaveLength(1);
    expect(problems[0]!.rule).toContain("starts with an id");
  });

  test("a bold or bulleted line starting with a PR number is refused too", () => {
    expect(checkStyle("- fe#417 landed.")[0]!.rule).toContain("starts with an id");
    expect(checkStyle("**be#768 lands**")[0]!.rule).toContain("starts with an id");
  });

  test("the system's own dialect is refused", () => {
    for (const word of BANNED_WORDS) expect(checkStyle(`This ${word} matters.`).length).toBeGreaterThan(0);
    expect(checkStyle("It supersedes BR-26q.").length).toBeGreaterThan(1);
  });

  test("a sentence over the ceiling is refused, and a line of links is not a sentence", () => {
    const long = `Sam ${"landed ".repeat(SENTENCE_WORDS)}it.`;
    expect(checkStyle(long)[0]!.rule).toContain(`over the ${SENTENCE_WORDS}-word ceiling`);
    expect(checkStyle("[the message](https://example.test/a) · [the frontend PR](https://example.test/b)")).toEqual([]);
  });

  test("an id inside a link label is still an id when it opens the line", () => {
    expect(checkStyle("[LIA-116](https://example.test)")[0]!.rule).toContain("starts with an id");
  });

  test("prose that follows the rules passes", () => {
    expect(checkStyle("# Where the work stands\n\nSam landed the backend at 15:07.\n")).toEqual([]);
  });
});

describe("the seeded directory", () => {
  test("every page renders, passes the style rules, and renders the same bytes twice", async () => {
    const { workstreams, milestones } = await loadWorkstreams(ROOT);
    const pages = [
      renderBoard({ workstreams, milestones, now: NOW }),
      renderChangelog(workstreams, "2026-09-09"),
      ...workstreams.map((x) => renderWorkstream(x, milestones, NOW)),
    ];
    for (const page of pages) expect(checkStyle(page)).toEqual([]);
    expect(renderBoard({ workstreams, milestones, now: NOW })).toBe(pages[0]!);
    expect(renderWorkstream(workstreams[0]!, milestones, NOW)).toBe(pages[2]!);
  });
});
