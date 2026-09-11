import { describe, expect, test } from "bun:test";
import type { ProjectLookup } from "./linear";
import type { TicketSources } from "./ticket";
import {
  checkDraft,
  headingsOf,
  PENDING_SECTION,
  REQUIRED_SECTIONS,
  TITLE_MAX,
} from "./ticket";

/** The team's projects as `knownProjects()` would answer them, without a credential in sight. */
const lookup = (over: Partial<ProjectLookup> = {}): ProjectLookup => ({
  projects: [
    { id: "p_alden", name: "Alden Portal" },
    { id: "p_pensieve", name: "Pensieve" },
  ],
  source: "live",
  teamId: "team_lia",
  viewerId: "user_liam",
  ...over,
});

const sources = (over: Partial<ProjectLookup> = {}): TicketSources => ({
  projects: () => Promise.resolve(lookup(over)),
});

/** A body carrying the sections named, in the order given. */
const bodyOf = (sections: readonly string[]) =>
  sections.map((h) => `## ${h}\n\nsomething about ${h}.\n`).join("\n");

const FIVE = bodyOf(REQUIRED_SECTIONS);

const draft = (over: Partial<Parameters<typeof checkDraft>[0]> = {}) => ({
  description: FIVE,
  project: "Pensieve",
  title: "[FE] Rename the Ask panel to Argus",
  ...over,
});

const refuse = async (
  over: Partial<Parameters<typeof checkDraft>[0]>,
  src = sources()
) => {
  const r = await checkDraft(draft(over), src);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
};

describe("AC4 — the title", () => {
  test("a title at the limit passes and one character over is refused, with its length", async () => {
    const at = "x".repeat(TITLE_MAX);
    const ok = await checkDraft(draft({ title: at }), sources());
    expect(ok.ok).toBe(true);

    const error = await refuse({ title: "x".repeat(TITLE_MAX + 1) });
    expect(error).toBe(
      `the title is ${TITLE_MAX + 1} characters — the format's limit is ${TITLE_MAX}`
    );
  });
  test("a title of whitespace is no title", async () => {
    expect(await refuse({ title: "   " })).toBe("the draft has no title");
  });
});

describe("AC4 — the five sections, in order", () => {
  test("each one missing is named, and the answer lists the five", async () => {
    for (const section of REQUIRED_SECTIONS) {
      const rest = REQUIRED_SECTIONS.filter((s) => s !== section);
      const error = await refuse({ description: bodyOf(rest) });
      expect(error).toContain(`the body has no "## ${section}" heading`);
      expect(error).toContain(REQUIRED_SECTIONS.join(", "));
    }
  });
  test("all five present but two swapped is refused, naming the pair", async () => {
    const swapped = [
      "Background",
      "Summary",
      "Scope / Out of Scope",
      "Acceptance Criteria",
      "Technical Notes",
    ];
    expect(await refuse({ description: bodyOf(swapped) })).toBe(
      "the body's sections are out of order — Background comes before Summary; the order is Summary, Background, Scope / Out of Scope, Acceptance Criteria, Technical Notes"
    );
  });
  test("headings are matched whatever their spacing and case", async () => {
    const odd = "##   summary\n\nx\n\n## BACKGROUND\n\nx\n";
    expect(headingsOf(odd)).toEqual(["summary", "BACKGROUND"]);
    const body = REQUIRED_SECTIONS.map(
      (h) => `##   ${h.toUpperCase()}\n\nx\n`
    ).join("\n");
    expect((await checkDraft(draft({ description: body }), sources())).ok).toBe(
      true
    );
  });
  test("a body of whitespace is no body", async () => {
    expect(await refuse({ description: "  \n " })).toBe(
      "the draft has no body"
    );
  });
  test("a heading the format does not name is left alone", async () => {
    const withExtra = `${FIVE}\n## Execution order\n\n1. do the thing\n`;
    expect(
      (await checkDraft(draft({ description: withExtra }), sources())).ok
    ).toBe(true);
  });
});

describe("AC4 — Pending, the sixth section", () => {
  const between = [
    "Summary",
    "Background",
    "Scope / Out of Scope",
    "Acceptance Criteria",
    PENDING_SECTION,
    "Technical Notes",
  ];
  test("sits between Acceptance Criteria and Technical Notes", async () => {
    expect(
      (await checkDraft(draft({ description: bodyOf(between) }), sources())).ok
    ).toBe(true);
  });
  test("anywhere else is refused", async () => {
    for (const order of [
      [...REQUIRED_SECTIONS, PENDING_SECTION],
      [PENDING_SECTION, ...REQUIRED_SECTIONS],
    ]) {
      expect(await refuse({ description: bodyOf(order) })).toBe(
        "Pending sits between Acceptance Criteria and Technical Notes, not anywhere else"
      );
    }
  });
});

describe("AC4 — the project is the team's", () => {
  test("a match carries its id, the team and the assignee through", async () => {
    const r = await checkDraft(draft({ project: "Pensieve" }), sources());
    expect(r).toEqual({
      draft: {
        // Trimmed: the card's textarea and the model's draft both arrive with slack at the ends.
        description: FIVE.trim(),
        project: { id: "p_pensieve", name: "Pensieve", verified: true },
        teamId: "team_lia",
        title: "[FE] Rename the Ask panel to Argus",
        viewerId: "user_liam",
      },
      ok: true,
    });
  });
  test("the name is matched case-insensitively and answered in Linear's spelling", async () => {
    const r = await checkDraft(
      draft({ project: "  alden portal " }),
      sources()
    );
    expect(r.ok && r.draft.project).toEqual({
      id: "p_alden",
      name: "Alden Portal",
      verified: true,
    });
  });
  test("a project that is not the team's is refused, and the answer lists the ones that are", async () => {
    const error = await refuse({ project: "Skunkworks" });
    expect(error).toBe(
      '"Skunkworks" is not a project on team Liamai — its projects are Alden Portal, Pensieve'
    );
  });
  test("no project named is refused", async () => {
    expect(await refuse({ project: " " })).toBe(
      "the draft names no project — name one of team Liamai's"
    );
  });
});

describe("AC5 — the check with no project list to check against", () => {
  test("a cached list refuses exactly as a live one does", async () => {
    const src = sources({ source: "cache" });
    expect(await refuse({ project: "Skunkworks" }, src)).toContain(
      "is not a project on team Liamai"
    );
    expect((await checkDraft(draft(), src)).ok).toBe(true);
  });
  test("no list at all takes the name on trust and says so, rather than refusing", async () => {
    const none: TicketSources = {
      projects: () =>
        Promise.resolve({ projects: [], source: "none" } as ProjectLookup),
    };
    const r = await checkDraft(draft({ project: "Skunkworks" }), none);
    expect(r.ok && r.draft.project).toEqual({
      name: "Skunkworks",
      verified: false,
    });
    // Nothing to file with: `fileTicket` refuses on the missing team rather than guessing.
    expect(r.ok && r.draft.teamId).toBeUndefined();
  });
  test("the title and section checks are unchanged with no list", async () => {
    const none: TicketSources = {
      projects: () =>
        Promise.resolve({ projects: [], source: "none" } as ProjectLookup),
    };
    expect(await refuse({ title: "x".repeat(TITLE_MAX + 1) }, none)).toContain(
      "the format's limit is"
    );
    expect(
      await refuse({ description: bodyOf(REQUIRED_SECTIONS.slice(1)) }, none)
    ).toContain('no "## Summary" heading');
  });
});
