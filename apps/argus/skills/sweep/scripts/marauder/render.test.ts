/**
 * render.ts — the board, one feature's story, and the day's changelog, from the features'
 * records (ARG-155, ARG-164 AC8).
 *
 * The board's order (Needs you, then each feature that moved this week), the seven-day
 * window, what a question someone else owes reads like, the changelog's silence about
 * features that did not move, the style checker, and byte-identical re-renders of the
 * folded records.
 *
 *   bun test skills/sweep/scripts/marauder/render.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  renderBoard,
  renderFeature,
  renderChangelog,
  checkStyle,
  featureTitle,
  questionSentence,
  BANNED_WORDS,
  SENTENCE_WORDS,
} from "./render.ts";
import { loadWork, type Milestones, type Work, type WorkEvent } from "./record.ts";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
const NOW = "2026-09-09T13:00:00Z";

const ev = (over: Partial<WorkEvent> = {}): WorkEvent => ({
  at: "2026-09-09T09:00:00Z",
  kind: "verified-landing",
  side: "fe",
  summary: "Sam landed the backend this afternoon.",
  source: { type: "pr", ref: "fe#417", url: "https://example.test/417" },
  attached: { how: "ref", confidence: "certain" },
  ...over,
});

const w = (over: Partial<Work> = {}): Work => ({
  feature: "admin/usage",
  keys: { tickets: ["ALD-2"], prs: ["fe#417"], threads: [], vocab: [] },
  open_questions: [],
  events: [ev()],
  updated: "2026-09-09T09:00:00Z",
  ...over,
});

const MILESTONES: Milestones = { "launch-2026-09-10": { name: "Launch", date: "2026-09-10", owner: "Foong Leung" } };
const headings = (md: string) => md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));

describe("the board", () => {
  const set = [
    w({ feature: "admin/usage", events: [ev({ kind: "directed-at-person", to: ["you"], at: "2026-09-09T10:31:00Z", summary: "Sam asked you who builds the subtask rows." })] }),
    w({ feature: "tasks", events: [ev({ at: "2026-09-09T09:21:00Z", summary: "Carlos landed the credit split on the task card." })] }),
    w({ feature: "admin/invoicing", open_questions: [{ q: "which invoicing page defects he means", owner: "Foong Leung", asked_by: "sweep", at: "2026-09-09" }], events: [ev({ at: "2026-09-09T02:34:00Z", kind: "new-ask", summary: "Foong asked for the defects fixed." })] }),
    w({ feature: "entities", events: [ev({ at: "2026-08-20T09:00:00Z", summary: "Sam landed the sender field." })] }),
  ];

  test("what needs the reader comes first, then each feature that moved this week, newest first", () => {
    expect(headings(renderBoard({ work: set, milestones: MILESTONES, now: NOW }))).toEqual(["Needs you", "Usage", "Tasks", "Invoicing"]);
  });

  test("a feature that did not move this week and waits on nobody is left off", () => {
    expect(renderBoard({ work: set, milestones: MILESTONES, now: NOW })).not.toContain("Entities");
    expect(renderBoard({ work: [set[3]!], milestones: {}, now: NOW })).toContain("Nothing moved this week.");
  });

  test("a question someone else owes reads as who the reader is waiting on", () => {
    expect(renderBoard({ work: set, milestones: MILESTONES, now: NOW })).toContain("You are waiting on Foong for which invoicing page defects he means.");
  });

  test("a milestone inside seven days leads the page, and one outside it does not", () => {
    const pointed = [w({ milestone: "launch-2026-09-10" })];
    expect(renderBoard({ work: pointed, milestones: MILESTONES, now: NOW })).toContain("Foong's launch is tomorrow, 10 September.");
    expect(renderBoard({ work: pointed, milestones: MILESTONES, now: "2026-09-01T13:00:00Z" })).not.toContain("launch is");
  });

  test("a feature's section says what happened this week, then its evidence", () => {
    const md = renderBoard({ work: [set[1]!], milestones: {}, now: NOW });
    const block = md.split("## Tasks\n\n")[1]!.trim().split("\n").filter(Boolean);
    expect(block[0]).toBe("Carlos landed the credit split on the task card.");
    expect(block[1]).toStartWith("[the frontend PR](");
  });

  test("the board passes its own style rules", () => {
    expect(checkStyle(renderBoard({ work: set, milestones: MILESTONES, now: NOW }))).toEqual([]);
  });
});

describe("words", () => {
  test("a feature is said the way the team says it, not the folder", () => {
    expect(featureTitle("admin/usage")).toBe("Usage");
    expect(featureTitle("admin/invoicing")).toBe("Invoicing");
    expect(featureTitle("admin/blocker-tracker")).toBe("Blocker tracker");
  });

  test("a question keeps its own words and says whose move it is", () => {
    expect(questionSentence({ q: "Does the credit-weight join need its own id column?", owner: "Sam O", asked_by: "sweep", at: "2026-09-09" }))
      .toBe("Does the credit-weight join need its own id column? Sam O to answer.");
    expect(questionSentence({ q: "which roles a Usage row should show", owner: "Foong Leung", asked_by: "sweep", at: "2026-09-09" }))
      .toBe("You are waiting on Foong for which roles a Usage row should show.");
  });
});

describe("one feature's story", () => {
  const page = renderFeature(
    w({
      milestone: "launch-2026-09-10",
      open_questions: [{ q: "Does the credit-weight join need its own id column?", asked_by: "sweep", at: "2026-09-09", owner: "Sam O" }],
      events: [ev({ at: "2026-09-07" }), ev({ at: "2026-09-09T09:21:00Z", summary: "You merged the front end onto the new key." })],
    }),
    MILESTONES,
    NOW,
  );

  test("it names the feature, the date it points at, and what is still open", () => {
    expect(page).toStartWith("# Usage\n");
    expect(page).toContain("Foong's launch is tomorrow, 10 September.");
    expect(page).toContain("- Does the credit-weight join need its own id column? Sam O to answer.");
  });

  test("what happened is newest first", () => {
    expect(page.indexOf("You merged the front end")).toBeLessThan(page.indexOf("Sam landed the backend"));
  });

  test("it passes its own style rules, and says nothing of a stage", () => {
    expect(checkStyle(page)).toEqual([]);
    expect(page).not.toMatch(/on staging;|still in a PR|Done means/);
  });
});

describe("the changelog", () => {
  const moved = w({ feature: "admin/usage", events: [ev({ at: "2026-09-09T09:21:00Z" })] });
  const still = w({ feature: "tasks", events: [ev({ at: "2026-09-04" })] });
  const md = renderChangelog([moved, still], "2026-09-09");

  test("it holds the features that gained an event that day and no others", () => {
    expect(md).toContain("**Usage**");
    expect(md).not.toContain("Tasks");
  });

  test("a quiet day says so rather than inventing a page", () => {
    expect(renderChangelog([still], "2026-09-09")).toContain("Nothing moved.");
  });

  test("two same-day events on one feature read as two sentences, not a run-on", () => {
    const busy = w({
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
    const problems = checkStyle("ALD-2 is still open.");
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
    expect(checkStyle("[ALD-2](https://example.test)")[0]!.rule).toContain("starts with an id");
  });

  test("prose that follows the rules passes", () => {
    expect(checkStyle("# Where the work stands\n\nSam landed the backend at 15:07.\n")).toEqual([]);
  });
});

describe("the folded records", () => {
  test("every page renders, passes the style rules, and renders the same bytes twice", async () => {
    const { work, milestones } = await loadWork(ROOT);
    const pages = [
      renderBoard({ work, milestones, now: NOW }),
      renderChangelog(work, "2026-09-09"),
      ...work.map((x) => renderFeature(x, milestones, NOW)),
    ];
    for (const page of pages) expect(checkStyle(page)).toEqual([]);
    expect(renderBoard({ work, milestones, now: NOW })).toBe(pages[0]!);
    expect(renderFeature(work[0]!, milestones, NOW)).toBe(pages[2]!);
  });
});
