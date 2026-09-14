import { describe, expect, test } from "bun:test";
import { linearConfig } from "./linear";
import type { CatalogLookup, TicketSources } from "./ticket";
import {
  checkDraft,
  headingsOf,
  PENDING_SECTION,
  providerConfigFor,
  REQUIRED_SECTIONS,
  TEAMS,
  TITLE_MAX,
} from "./ticket";

/** Each known team's project/label names, as `catalog(team)` would answer them. */
const CATALOG: Record<string, string[]> = {
  AP: ["Alden Portal", "Admin - Usage"],
  CTD: ["Pensieve", "Argus"],
};

/** The named team's catalog, without a credential in sight. */
const catalogFor = (
  teamKey: string,
  over: Partial<CatalogLookup> = {}
): CatalogLookup => ({
  names: CATALOG[teamKey] ?? [],
  verified: true,
  ...over,
});

// No default for the key: the check has to ask for a team, and a fake that quietly
// substituted one would pass whether or not it was asked for the right list.
const sources = (over: Partial<CatalogLookup> = {}): TicketSources => ({
  catalog: (team) => Promise.resolve(catalogFor(team.key, over)),
});

/** A body carrying the sections named, in the order given. */
const bodyOf = (sections: readonly string[]) =>
  sections.map((h) => `## ${h}\n\nsomething about ${h}.\n`).join("\n");

const FIVE = bodyOf(REQUIRED_SECTIONS);

const draft = (over: Partial<Parameters<typeof checkDraft>[0]> = {}) => ({
  description: FIVE,
  project: "Admin - Usage",
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

describe("the feature confirmed in the chat", () => {
  const withFeatures = (): TicketSources => ({
    ...sources(),
    features: () => Promise.resolve(["admin/usage", "tasks"]),
  });
  test("a known feature rides on the draft; an unknown one is refused", async () => {
    const r = await checkDraft(
      draft({ feature: "admin/usage" }),
      withFeatures()
    );
    expect(r.ok && r.draft.feature).toBe("admin/usage");
    expect(
      await refuse({ feature: "admin/clientz" }, withFeatures())
    ).toContain('"admin/clientz" is not a feature with a ledger');
  });
  test("a draft with no feature is answered with none", async () => {
    const r = await checkDraft(draft(), withFeatures());
    expect(r.ok).toBe(true);
    expect(r.ok ? r.draft.feature : "refused").toBeUndefined();
  });
});

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

describe("C2 — no team named resolves against Alden, the default", () => {
  test("a match carries its name, the team and the verified flag through", async () => {
    const r = await checkDraft(draft({ project: "Admin - Usage" }), sources());
    expect(r).toEqual({
      draft: {
        // Trimmed: the card's textarea and the model's draft both arrive with slack at the ends.
        description: FIVE.trim(),
        project: {
          isNew: false,
          name: "Admin - Usage",
          verified: true,
        },
        team: { key: "AP", name: "Alden" },
        title: "[FE] Rename the Ask panel to Argus",
      },
      ok: true,
    });
  });
  test("naming Alden by name answers the same draft as naming no team", async () => {
    const named = await checkDraft(
      draft({ project: "Admin - Usage", team: "Alden" }),
      sources()
    );
    expect(named.ok && named.draft.team).toEqual({
      key: "AP",
      name: "Alden",
    });
    const unnamed = await checkDraft(
      draft({ project: "Admin - Usage" }),
      sources()
    );
    expect(named).toEqual(unnamed);
  });
  test("naming the board's own key (AP) resolves the same as the name", async () => {
    const r = await checkDraft(draft({ team: "AP" }), sources());
    expect(r.ok && r.draft.team).toEqual({ key: "AP", name: "Alden" });
  });
  test("the name is matched case-insensitively and answered in the catalog's spelling", async () => {
    const r = await checkDraft(
      draft({ project: "  alden portal " }),
      sources()
    );
    expect(r.ok && r.draft.project).toEqual({
      isNew: false,
      name: "Alden Portal",
      verified: true,
    });
  });
  test("a project the team does not have yet is accepted as new, for File to create", async () => {
    const r = await checkDraft(draft({ project: " Skunkworks " }), sources());
    expect(r.ok && r.draft.project).toEqual({
      isNew: true,
      name: "Skunkworks",
      verified: true,
    });
  });
  test("no project named is refused", async () => {
    expect(await refuse({ project: " " })).toBe(
      "the draft names no project — name one of team Alden's"
    );
  });
});

describe("C1 — a draft naming Citadel resolves against Citadel's catalog", () => {
  test("a match on the named team carries Citadel's name and catalog through", async () => {
    const r = await checkDraft(
      draft({ project: "Pensieve", team: "Citadel" }),
      sources()
    );
    expect(r).toEqual({
      draft: {
        description: FIVE.trim(),
        project: {
          isNew: false,
          name: "Pensieve",
          verified: true,
        },
        team: { key: "CTD", name: "Citadel" },
        title: "[FE] Rename the Ask panel to Argus",
      },
      ok: true,
    });
  });
  test("the team is matched by its key as well as its name", async () => {
    const r = await checkDraft(
      draft({ project: "Argus", team: "CTD" }),
      sources()
    );
    expect(r.ok && r.draft.team).toEqual({ key: "CTD", name: "Citadel" });
    expect(r.ok && r.draft.project).toEqual({
      isNew: false,
      name: "Argus",
      verified: true,
    });
  });
});

describe("C3 — a project that exists only on the other team is not matched", () => {
  test('team Alden naming project "Pensieve" is a new project on Alden, never matched to Citadel\'s', async () => {
    const r = await checkDraft(
      draft({ project: "Pensieve", team: "Alden" }),
      sources()
    );
    expect(r.ok && r.draft.team).toEqual({ key: "AP", name: "Alden" });
    expect(r.ok && r.draft.project).toEqual({
      isNew: true,
      name: "Pensieve",
      verified: true,
    });
  });
});

describe("C4 — a team that is neither Alden nor Citadel is refused", () => {
  test("the error names the unknown team, and no catalog is read", async () => {
    let calledWith: string | undefined;
    const src: TicketSources = {
      catalog: (team) => {
        calledWith = team.key;
        return Promise.resolve(catalogFor(team.key));
      },
    };
    const r = await checkDraft(draft({ team: "Skunkworks" }), src);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Skunkworks");
    expect(calledWith).toBeUndefined();
  });
});

describe("AC5 — the check with no catalog to check against", () => {
  test("a cached list answers exactly as a live one does", async () => {
    const src = sources({ verified: true });
    const unknown = await checkDraft(draft({ project: "Skunkworks" }), src);
    expect(unknown.ok && unknown.draft.project.isNew).toBe(true);
    const known = await checkDraft(draft(), src);
    expect(known.ok && known.draft.project).toMatchObject({
      isNew: false,
      name: "Admin - Usage",
    });
  });
  test("no list at all takes the name on trust and says so, rather than refusing", async () => {
    const none: TicketSources = {
      catalog: () => Promise.resolve({ names: [], verified: false }),
    };
    const r = await checkDraft(draft({ project: "Skunkworks" }), none);
    // Not new either: with no list there is nothing to say it is missing, and File must
    // not create a project/label on a guess.
    expect(r.ok && r.draft.project).toEqual({
      isNew: false,
      name: "Skunkworks",
      verified: false,
    });
  });
  test("the title and section checks are unchanged with no list", async () => {
    const none: TicketSources = {
      catalog: () => Promise.resolve({ names: [], verified: false }),
    };
    expect(await refuse({ title: "x".repeat(TITLE_MAX + 1) }, none)).toContain(
      "the format's limit is"
    );
    expect(
      await refuse({ description: bodyOf(REQUIRED_SECTIONS.slice(1)) }, none)
    ).toContain('no "## Summary" heading');
  });
});

const [ALDEN, CITADEL] = TEAMS;

describe("providerConfigFor — which credential a team's provider needs", () => {
  test("Citadel routes to Linear, so it is linearConfig() exactly", () => {
    expect(providerConfigFor(CITADEL)).toEqual(linearConfig());
  });

  test("Alden routes to Trello, checking TRELLO_API_KEY and TRELLO_TOKEN directly", () => {
    const alden = ALDEN;
    const savedKey = process.env.TRELLO_API_KEY;
    const savedToken = process.env.TRELLO_TOKEN;
    try {
      process.env.TRELLO_API_KEY = "";
      process.env.TRELLO_TOKEN = "";
      const missing = providerConfigFor(alden);
      expect(missing.configured).toBe(false);
      expect(missing.reason).toContain("TRELLO_API_KEY and TRELLO_TOKEN");
      expect(missing.reason).toContain("just auth trello");

      process.env.TRELLO_API_KEY = "k";
      process.env.TRELLO_TOKEN = "t";
      expect(providerConfigFor(alden)).toEqual({ configured: true });

      process.env.TRELLO_API_KEY = "k";
      process.env.TRELLO_TOKEN = "";
      expect(providerConfigFor(alden).reason).toContain("TRELLO_TOKEN");
      expect(providerConfigFor(alden).reason).not.toContain("TRELLO_API_KEY");
    } finally {
      process.env.TRELLO_API_KEY = savedKey;
      process.env.TRELLO_TOKEN = savedToken;
    }
  });
});
