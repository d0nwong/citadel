/**
 * points.ts — the Needs-you section as data (LIA-87).
 *
 * The fixture is the report shape `skills/sweep/SKILL.md` step 9 mandates; the cases are
 * the ticket's acceptance criteria, one describe per AC that a unit can check.
 *
 *   bun test skills/sweep/scripts/points.test.ts
 */

import { test, expect, describe } from "bun:test";
import {
  parseNeedsYou,
  derive,
  syncAges,
  slug,
  ageOf,
  repoOf,
  tickOf,
  normaliseTitles,
  type Derive,
  type PointsFile,
} from "./points.ts";

const REPORT = `# sweep — 2026-09-05

_Tick 13:14 · no digest writeback (quiet) · staging@a49795756 · dev@5ca2ed71_

## Needs you

**Decide**
- **LIA-71 History rollup** — decision entry still \`decided\`, code shipped a different shape · new
  09-04's decision asked for one row; \`history-tab-content.tsx\` shipped a drill-down.
- **MM-32 — an under-retainer invoice's line credits don't match \`Invoices.creditsUsed\`** — ticket, or leave? · 1d
  The \`Credit adjustment\` row is invisible on drafts.
- **LIA-53 looks agent-ready** — label it? · 5d
  No Pending, no blockers, concrete Scope across \`pr-facts\`/\`feature-docs\`/\`audit\`.
- **Usage feature still has zero tests** — ticket it? · 1d
  fe#405 deleted five test files in \`admin-usage\`; LIA-71 and LIA-78 both touch it.

**Verify**
- **LIA-78** — four ACs appear satisfied by fe#406, not ticked · new
  AC1 (fixture deleted), AC8 (rollover band reads \`credits.availableRollover\`).

**Confirm with someone**
- **Capacity-unit direction** — Foong · 2d
  Huddle said 1 unit = 2.5 h; shipped code implements 2.5 units = 1 h.

**On hold**
- LIA-83 Netlify preview bounce → waits on Auth0 tenant settings from Foong

**Housekeeping**
- All 22 features clean — no stale docs, audit clean

## Done today

### 09:49
- **LIA-99** — this bold line is not a point · new

## Linear today

- **LIA-71** — updated
`;

const ctx = (over: Partial<Derive> = {}): Derive => ({
  day: "2026-09-05",
  tick: "2026-09-05T05:14:00.000Z",
  previous: null,
  titles: {},
  featureIds: ["admin-usage", "admin", "tasks", "peer-review"],
  oldestReportNaming: () => undefined,
  ...over,
});

describe("AC1 — one record per Needs-you bullet, nothing from other sections", () => {
  const items = parseNeedsYou(REPORT);
  test("eight bullets, in report order, grouped", () => {
    expect(items.map((i) => i.group)).toEqual([
      "decide", "decide", "decide", "decide", "verify", "confirm", "hold", "housekeeping",
    ]);
  });
  test("Done today / Linear today bullets are not points", () => {
    expect(items.some((i) => i.subject.includes("LIA-99"))).toBe(false);
  });
  test("file holds tick, date and points", () => {
    const file = derive(items, ctx());
    expect(file.tick).toBe("2026-09-05T05:14:00.000Z");
    expect(file.date).toBe("2026-09-05");
    expect(file.points).toHaveLength(8);
  });
});

describe("AC2 — record fields", () => {
  const file = derive(parseNeedsYou(REPORT), ctx());
  const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));
  test("headline splits into subject and ask; the age suffix is not copied into ask", () => {
    const p = byId["decide/lia-71-history-rollup"]!;
    expect(p.subject).toBe("LIA-71 History rollup");
    expect(p.ask).toBe("decision entry still `decided`, code shipped a different shape");
    expect(p.detail).toBe("09-04's decision asked for one row; `history-tab-content.tsx` shipped a drill-down.");
  });
  test("a subject containing an em dash keeps it; the ask is what follows the bold", () => {
    const p = byId["decide/mm-32-an-under-retainer-invoice-s-line-credits-don-t-match-invoices-creditsused"]!;
    expect(p.subject).toBe("MM-32 — an under-retainer invoice's line credits don't match `Invoices.creditsUsed`");
    expect(p.ask).toBe("ticket, or leave?");
  });
  test("hold: subject before the arrow, ask is the wait; no detail key when there is no detail line", () => {
    const p = byId["hold/lia-83-netlify-preview-bounce"]!;
    expect(p.ask).toBe("waits on Auth0 tenant settings from Foong");
    expect("detail" in p).toBe(false);
  });
  test("housekeeping: split on the em dash", () => {
    const p = byId["housekeeping/all-22-features-clean"]!;
    expect(p.ask).toBe("no stale docs, audit clean");
  });
  test("optional keys are absent, not null", () => {
    const p = byId["confirm/capacity-unit-direction"]!;
    expect("ticket" in p).toBe(false);
    expect("repo" in p).toBe(false);
    expect("features" in p).toBe(false);
  });
  test("features: hyphenated ids match as words, one-word ids only in backticks", () => {
    expect(byId["decide/usage-feature-still-has-zero-tests"]!.features).toEqual(["admin-usage"]);
    expect("features" in byId["decide/lia-71-history-rollup"]!).toBe(false);
  });
});

describe("AC3 — stable ids", () => {
  test("slug rule: lowercase, runs of non-alphanumerics → one '-', trimmed", () => {
    expect(slug("LIA-78 `billableQuantity`")).toBe("lia-78-billablequantity");
    expect(slug("`VITE_BLOCKER_TRACKER_ALLOWED_EMAILS` on the Netlify prod build")).toBe(
      "vite-blocker-tracker-allowed-emails-on-the-netlify-prod-build",
    );
    expect(slug("  — MM-3 — ")).toBe("mm-3");
  });
  test("same subject two ticks running → same id", () => {
    const a = derive(parseNeedsYou(REPORT), ctx());
    const b = derive(parseNeedsYou(REPORT.replace("_Tick 13:14", "_Tick 14:14")), ctx({ previous: a }));
    expect(b.points.map((p) => p.id)).toEqual(a.points.map((p) => p.id));
  });
});

describe("AC4 — ticket and repo", () => {
  // the pre-LIA-121 title-only file: still loads, still fills FE / BE
  const titles = normaliseTitles({ "LIA-71": "[FE] Usage History tab", "LIA-78": "[FE][BE] Usage endpoints", "LIA-53": "Pin accio stamps" });
  const file = derive(parseNeedsYou(REPORT), ctx({ titles }));
  const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));
  test("exactly one LIA key in subject or detail → ticket", () => {
    expect(byId["decide/lia-71-history-rollup"]!.ticket).toBe("LIA-71");
    expect(byId["hold/lia-83-netlify-preview-bounce"]!.ticket).toBe("LIA-83");
  });
  test("two different keys → no ticket", () => {
    expect("ticket" in byId["decide/usage-feature-still-has-zero-tests"]!).toBe(false);
  });
  test("[FE] → alden-portal-fe; both tags or no tag → absent", () => {
    expect(byId["decide/lia-71-history-rollup"]!.repo).toBe("alden-portal-fe");
    expect("repo" in byId["verify/lia-78"]!).toBe(false);
    expect("repo" in byId["decide/lia-53-looks-agent-ready"]!).toBe(false);
    expect(repoOf("[BE] Add billableQuantity")).toBe("alden-connect-portal-be");
  });
  test("titles accept the MCP array shape", () => {
    expect(normaliseTitles([{ id: "LIA-1", title: "[FE] x" }, { identifier: "LIA-2", title: "y" }])).toEqual({
      "LIA-1": { title: "[FE] x" },
      "LIA-2": { title: "y" },
    });
  });
});

describe("LIA-121 — repo from the ticket's project, the title tag only inside Alden Portal", () => {
  const titles = normaliseTitles({
    "LIA-71": { title: "Usage History tab", project: "Argus" },
    "LIA-78": { title: "[FE][BE] Usage endpoints", project: "Pensieve" },
    "LIA-53": { title: "[FE] Pin accio stamps", project: "Marketing" },
    "LIA-83": { title: "[BE] Netlify preview bounce", project: "Alden Portal" },
  });
  const file = derive(parseNeedsYou(REPORT), ctx({ titles }));
  const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));

  test("AC1 — Argus / Pensieve / Foundry tickets carry their repo, tags or not", () => {
    expect(byId["decide/lia-71-history-rollup"]!.repo).toBe("argus");
    expect(byId["verify/lia-78"]!.repo).toBe("pensieve"); // both tags, but the project decides
    expect(repoOf("anything", "Foundry")).toBe("foundry");
  });
  test("AC2 — Alden Portal keeps the tag rule: [FE], [BE], both or neither", () => {
    expect(byId["hold/lia-83-netlify-preview-bounce"]!.repo).toBe("alden-connect-portal-be");
    expect(repoOf("[FE] x", "Alden Portal")).toBe("alden-portal-fe");
    expect(repoOf("[FE][BE] x", "Alden Portal")).toBeUndefined();
    expect(repoOf("x", "Alden Portal")).toBeUndefined();
  });
  test("AC3 — the title-only map and a project-less array still load; no project reads as the tag rule", () => {
    expect(normaliseTitles({ "LIA-1": "[FE] x", "LIA-2": { title: "y" } })).toEqual({ "LIA-1": { title: "[FE] x" }, "LIA-2": { title: "y" } });
    expect(repoOf("[FE] x")).toBe("alden-portal-fe");
    expect(repoOf("[FE] x", undefined)).toBe("alden-portal-fe");
    const untouched = derive(parseNeedsYou(REPORT), ctx({ titles: normaliseTitles({ "LIA-53": "Pin accio stamps" }) }));
    expect(untouched.points.every((p) => !("repo" in p) || p.repo)).toBe(true);
  });
  test("AC4 — a project the map does not name, and a point with no ticket, carry no repo", () => {
    expect("repo" in byId["decide/lia-53-looks-agent-ready"]!).toBe(false); // Marketing, even with [FE]
    expect("repo" in byId["decide/usage-feature-still-has-zero-tests"]!).toBe(false); // two keys → no ticket
    expect("repo" in byId["confirm/capacity-unit-direction"]!).toBe(false);
    expect(repoOf("[FE] x", "Marketing")).toBeUndefined();
  });
  test("AC5 — every repo written is a checkout basename Foundry can resolve", () => {
    const written = new Set([
      repoOf("x", "Argus"),
      repoOf("x", "Pensieve"),
      repoOf("x", "Foundry"),
      repoOf("[FE] x", "Alden Portal"),
      repoOf("[BE] x", "Alden Portal"),
    ]);
    expect([...written].sort()).toEqual(["alden-connect-portal-be", "alden-portal-fe", "argus", "foundry", "pensieve"]);
    for (const r of written) expect(r).toMatch(/^[a-z0-9-]+$/); // a basename, never a path or a project name
  });
  test("the MCP array carries project as a name or as { name }; the map form too", () => {
    expect(
      normaliseTitles([
        { identifier: "LIA-1", title: "a", project: "Argus" },
        { identifier: "LIA-2", title: "b", project: { name: "Foundry" } },
        { identifier: "LIA-3", title: "c", project: null },
      ]),
    ).toEqual({ "LIA-1": { title: "a", project: "Argus" }, "LIA-2": { title: "b", project: "Foundry" }, "LIA-3": { title: "c" } });
    expect(normaliseTitles({ "LIA-4": { title: "d", project: { name: "Pensieve" } } })).toEqual({ "LIA-4": { title: "d", project: "Pensieve" } });
    expect(normaliseTitles(null)).toEqual({});
    expect(normaliseTitles({ "LIA-5": { title: "e", project: "" } })).toEqual({ "LIA-5": { title: "e" } }); // blank is no project
  });
});

describe("AC5 — firstSeen and age", () => {
  const items = parseNeedsYou(REPORT);
  test("bootstrap: a line's own · Nd age dates firstSeen; · new is today", () => {
    const file = derive(items, ctx());
    const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));
    expect(byId["decide/lia-53-looks-agent-ready"]!.firstSeen).toBe("2026-08-31");
    expect(byId["decide/lia-71-history-rollup"]!.firstSeen).toBe("2026-09-05");
  });
  test("bootstrap without an age falls back to the oldest report naming the subject, else today", () => {
    const file = derive(items, ctx({ oldestReportNaming: (s) => (s.startsWith("LIA-83") ? "2026-09-02" : undefined) }));
    const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));
    expect(byId["hold/lia-83-netlify-preview-bounce"]!.firstSeen).toBe("2026-09-02");
    expect(byId["housekeeping/all-22-features-clean"]!.firstSeen).toBe("2026-09-05");
  });
  test("the previous file wins over whatever the line says", () => {
    const previous: PointsFile = {
      tick: "2026-09-04T22:00:00.000Z",
      date: "2026-09-04",
      points: [{ id: "decide/lia-71-history-rollup", group: "decide", subject: "LIA-71 History rollup", ask: "x", firstSeen: "2026-09-01" }],
    };
    const file = derive(items, ctx({ previous }));
    expect(file.points[0]!.firstSeen).toBe("2026-09-01");
  });
  test("ages in the report are rewritten to agree with firstSeen", () => {
    const previous: PointsFile = {
      tick: "t",
      date: "2026-09-04",
      points: [{ id: "decide/lia-71-history-rollup", group: "decide", subject: "LIA-71 History rollup", ask: "x", firstSeen: "2026-09-01" }],
    };
    const file = derive(items, ctx({ previous }));
    const synced = syncAges(REPORT, items, file);
    expect(synced).toContain("code shipped a different shape · 4d\n");
    expect(synced).toContain("ticket, or leave? · 1d\n"); // unchanged
    expect(synced).toContain("waits on Auth0 tenant settings from Foong\n"); // hold lines get no suffix
    expect(synced).toContain("this bold line is not a point · new"); // other sections untouched
    expect(ageOf("2026-09-05", "2026-09-05")).toBe("new");
    expect(ageOf("2026-08-31", "2026-09-05")).toBe("5d");
  });
});

describe("AC6 — quiet tick", () => {
  test("a rewrite with a new tick line keeps the same points", () => {
    const a = derive(parseNeedsYou(REPORT), ctx());
    const quiet = REPORT.replace("_Tick 13:14", "_Tick 15:14");
    const b = derive(parseNeedsYou(quiet), ctx({ tick: tickOf(quiet, "2026-09-05"), previous: a }));
    expect(b.tick).not.toBe(a.tick);
    expect(b.points).toEqual(a.points);
  });
  test("tick comes from the report's _Tick line on the report's day", () => {
    const iso = tickOf(REPORT, "2026-09-05");
    expect(new Date(iso).getHours()).toBe(13);
    expect(new Date(iso).getMinutes()).toBe(14);
  });
});

// ---------------------------------------------------------------- LIA-88 — decisions

import { parseDecision, stripOwned, applyDecisions, readDecisions, type Decision } from "./points.ts";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ignored: Decision = {
  point: "decide/lia-53-looks-agent-ready",
  action: "ignored",
  reason: "not this sprint",
  at: "2026-09-05T10:00:00.000Z",
  subject: "LIA-53 looks agent-ready",
};
const sent: Decision = {
  point: "verify/lia-78",
  action: "sent",
  at: "2026-09-05T10:05:00.000Z",
  subject: "LIA-78",
  job: { id: "job_1", url: "http://foundry.local/jobs/job_1" },
};
const withDecisions = (over: Partial<Derive> = {}) =>
  ctx({ decisions: new Map([ignored, sent].map((d) => [d.point, d])), ...over });

/** the whole pipeline `run` performs on text, minus disk */
const pipeline = (md: string, d: Derive, unreadable: Parameters<typeof applyDecisions>[3] = []) => {
  const stripped = stripOwned(md);
  const items = parseNeedsYou(stripped);
  const file = derive(items, d);
  return { file, md: applyDecisions(syncAges(stripped, items, file), items, file, unreadable) };
};

describe("LIA-88 AC1 — a decided point leaves Needs-you and carries the decision in points.json", () => {
  const { file, md } = pipeline(REPORT, withDecisions());
  const byId = Object.fromEntries(file.points.map((p) => [p.id, p]));
  test("the record keeps its place and gets the file's decision, verbatim", () => {
    expect(file.points).toHaveLength(8);
    expect(byId["decide/lia-53-looks-agent-ready"]!.decision).toEqual(ignored);
    expect(byId["verify/lia-78"]!.decision).toEqual(sent);
    expect("decision" in byId["decide/lia-71-history-rollup"]!).toBe(false);
  });
  test("its bullet and detail line are gone from the report; undecided bullets stay", () => {
    expect(md).not.toContain("LIA-53 looks agent-ready");
    expect(md).not.toContain("No Pending, no blockers");
    expect(md).not.toContain("four ACs appear satisfied");
    expect(md).toContain("- **LIA-71 History rollup** —");
    expect(md).toContain("- **MM-32 — an under-retainer");
  });
  test("a group emptied by the drop loses its header; others keep theirs", () => {
    expect(md).not.toContain("**Verify**");
    expect(md).toContain("**Decide**");
    expect(md).toContain("**Confirm with someone**");
  });
  test("the report re-read next tick yields the undecided points, same ids", () => {
    const again = derive(parseNeedsYou(md), ctx({ previous: file }));
    expect(again.points.map((p) => p.id)).toEqual(file.points.filter((p) => !p.decision).map((p) => p.id));
  });
  test("firstSeen survives the drop, by id, when the sweep writes the point back as new", () => {
    const rewritten = REPORT.replace("label it? · 5d", "label it? · new");
    const next = pipeline(rewritten, withDecisions({ previous: file }));
    expect(next.file.points.find((p) => p.id === "decide/lia-53-looks-agent-ready")!.firstSeen).toBe("2026-08-31");
  });
});

describe("LIA-88 AC2 — Housekeeping shows the count", () => {
  test("N decided → one `N points decided (decisions/)` line under Housekeeping", () => {
    const { md } = pipeline(REPORT, withDecisions());
    expect(md).toContain("**Housekeeping**\n- All 22 features clean — no stale docs, audit clean\n- 2 points decided (decisions/)\n");
    expect(md.match(/points? decided/g)).toHaveLength(1);
  });
  test("one decided → singular", () => {
    const { md } = pipeline(REPORT, ctx({ decisions: new Map([[sent.point, sent]]) }));
    expect(md).toContain("- 1 point decided (decisions/)\n");
  });
  test("no Housekeeping group → one is added at the end of Needs you", () => {
    const noHk = REPORT.replace("\n**Housekeeping**\n- All 22 features clean — no stale docs, audit clean\n", "\n");
    const { md } = pipeline(noHk, withDecisions());
    expect(md).toContain("waits on Auth0 tenant settings from Foong\n\n**Housekeeping**\n- 2 points decided (decisions/)\n\n## Done today");
  });
  test("zero decided → no line, and the count line is never itself a point", () => {
    const { md, file } = pipeline(REPORT, ctx());
    expect(md).not.toContain("decided (decisions/)");
    const prior = REPORT.replace("audit clean\n", "audit clean\n- 2 points decided (decisions/)\n");
    const again = pipeline(prior, ctx());
    expect(again.md).not.toContain("decided (decisions/)");
    expect(again.file.points.map((p) => p.id)).toEqual(file.points.map((p) => p.id));
  });
});

describe("LIA-88 AC3 / AC6 — a decision matches by id, and only a current point", () => {
  test("a decision whose point is not in the report changes nothing and adds no record", () => {
    const stale: Decision = { point: "decide/something-that-was-resolved", action: "ignored", reason: "moot", at: "t" };
    const { file, md } = pipeline(REPORT, ctx({ decisions: new Map([[stale.point, stale]]) }));
    expect(file.points).toHaveLength(8);
    expect(file.points.some((p) => p.decision)).toBe(false);
    expect(md).toBe(pipeline(REPORT, ctx()).md);
  });
  test("a reworded subject is a new id: it renders undecided, the old decision is left alone", () => {
    const reworded = REPORT.replace("**LIA-53 looks agent-ready** — label it?", "**LIA-53 ready for Foundry** — label it?");
    const { file, md } = pipeline(reworded, ctx({ decisions: new Map([[ignored.point, ignored]]) }));
    const p = file.points.find((p) => p.id === "decide/lia-53-ready-for-foundry")!;
    expect(p).toBeDefined();
    expect("decision" in p).toBe(false);
    expect(md).toContain("- **LIA-53 ready for Foundry** —");
    expect(md).not.toContain("decided (decisions/)");
  });
});

describe("LIA-88 AC4 — an unreadable decision file is one Audit line; its point renders undecided", () => {
  const unreadable = [{ file: "decisions/decide/lia-53-looks-agent-ready.json", error: "not valid JSON: Unexpected end of JSON input" }];
  test("parseDecision names the one reason", () => {
    expect(parseDecision("{")).toMatchObject({ error: expect.stringContaining("not valid JSON") });
    expect(parseDecision("[]")).toEqual({ error: "not a JSON object" });
    expect(parseDecision('{"action":"sent"}')).toEqual({ error: "`point` missing or not a string" });
    expect(parseDecision('{"point":"a/b","action":"maybe"}')).toEqual({
      error: '`action` must be "sent", "ignored" or "verified"',
    });
    expect(parseDecision('{"point":"a/b","action":"ignored"}')).toEqual({ error: "`reason` required for an ignored point" });
    expect(parseDecision(JSON.stringify(sent))).toEqual({ decision: sent });
  });
  test("Audit gets the block; the point stays in Needs-you", () => {
    const withAudit = REPORT + "\n## Audit\n\n**Tiers disagree**\n- `peer-review` — product@1, arch@2\n";
    const { md, file } = pipeline(withAudit, ctx(), unreadable);
    expect(md).toContain("- `peer-review` — product@1, arch@2\n\n**Unreadable decision files**\n- `decisions/decide/lia-53-looks-agent-ready.json` — not valid JSON: Unexpected end of JSON input\n");
    expect(md).toContain("- **LIA-53 looks agent-ready** — label it? · 5d");
    expect("decision" in file.points.find((p) => p.id === "decide/lia-53-looks-agent-ready")!).toBe(false);
  });
  test("no Audit section → one is appended", () => {
    const { md } = pipeline(REPORT, ctx(), unreadable);
    expect(md.endsWith("- **LIA-71** — updated\n\n## Audit\n\n**Unreadable decision files**\n- `decisions/decide/lia-53-looks-agent-ready.json` — not valid JSON: Unexpected end of JSON input\n")).toBe(true);
  });
  test("running again does not duplicate the block, and a fixed file removes it", () => {
    const once = pipeline(REPORT, ctx(), unreadable).md;
    const twice = pipeline(once, ctx(), unreadable).md;
    expect(twice).toBe(once);
    expect(pipeline(once, ctx()).md).not.toContain("Unreadable decision files");
  });
});

describe("LIA-88 — readDecisions walks decisions/**/*.json, keyed by `point`, later `at` wins", () => {
  test("reads nested files, splits unreadable ones, dedupes by point", async () => {
    const dir = await mkdtemp(join(tmpdir(), "argus-decisions-"));
    await mkdir(join(dir, "decide"), { recursive: true });
    await mkdir(join(dir, "verify"), { recursive: true });
    await writeFile(join(dir, "decide", "lia-53-looks-agent-ready.json"), JSON.stringify(ignored));
    await writeFile(join(dir, "verify", "lia-78.json"), JSON.stringify(sent));
    await writeFile(join(dir, "verify", "lia-78-moved-by-hand.json"), JSON.stringify({ ...sent, at: "2026-09-01T00:00:00.000Z", reason: "older" }));
    await writeFile(join(dir, "decide", "broken.json"), "{");
    await writeFile(join(dir, "README.md"), "not a decision");
    const { decisions, unreadable } = await readDecisions(dir);
    expect([...decisions.keys()].sort()).toEqual(["decide/lia-53-looks-agent-ready", "verify/lia-78"]);
    expect(decisions.get("verify/lia-78")!.at).toBe(sent.at);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.file.endsWith("decide/broken.json")).toBe(true);
  });
  test("no directory → nothing decided, nothing unreadable", async () => {
    const { decisions, unreadable } = await readDecisions("/nonexistent/argus-decisions");
    expect(decisions.size).toBe(0);
    expect(unreadable).toEqual([]);
  });
});

// ---------------------------------------------------------------- LIA-114 — verified

import { verifiedPoints, formatVerified, type Point } from "./points.ts";

/** the Verify-group point, confirmed: the sweep may now make the edit it only reported */
const verifiedTicket: Decision = {
  point: "verify/lia-78",
  action: "verified",
  reason: "checked the diff, they are satisfied",
  at: "2026-09-06T09:00:00.000Z",
  subject: "LIA-78",
};
/** a Decide-group point, confirmed — the verb is not restricted to Verify by the reader */
const verifiedDocs: Decision = {
  point: "decide/usage-feature-still-has-zero-tests",
  action: "verified",
  at: "2026-09-06T09:01:00.000Z",
  subject: "Usage feature still has zero tests",
};

describe("LIA-114 AC1 — a verified point leaves Needs-you and carries the decision, as an ignored one does", () => {
  const { file, md } = pipeline(REPORT, ctx({ decisions: new Map([[verifiedTicket.point, verifiedTicket]]) }));
  test("the record keeps its place and gets the file's decision, verbatim", () => {
    expect(file.points).toHaveLength(8);
    expect(file.points.find((p) => p.id === "verify/lia-78")!.decision).toEqual(verifiedTicket);
  });
  test("its bullet and detail line are gone from the report, and the group with them", () => {
    expect(md).not.toContain("four ACs appear satisfied");
    expect(md).not.toContain("**Verify**");
    expect(md).toContain("**Decide**");
  });
  test("a `reason` is optional — a verified file without one parses and applies the same", () => {
    expect(parseDecision(JSON.stringify(verifiedDocs))).toEqual({ decision: verifiedDocs });
    const one = pipeline(REPORT, ctx({ decisions: new Map([[verifiedDocs.point, verifiedDocs]]) }));
    expect(one.file.points.find((p) => p.id === verifiedDocs.point)!.decision).toEqual(verifiedDocs);
    expect(one.md).not.toContain("Usage feature still has zero tests");
  });
});

describe("LIA-114 AC2 — the reader does not restrict `verified` to the Verify group", () => {
  test("a verified Decide point drops exactly as the verified Verify point does", () => {
    const { file, md } = pipeline(REPORT, ctx({ decisions: new Map([[verifiedDocs.point, verifiedDocs]]) }));
    const p = file.points.find((p) => p.id === "decide/usage-feature-still-has-zero-tests")!;
    expect(p.group).toBe("decide");
    expect(p.decision!.action).toBe("verified");
    expect(md).toContain("**Decide**"); // three Decide bullets survive
    expect(md).toContain("- **LIA-53 looks agent-ready** —");
  });
});

describe("LIA-114 AC3 — an action outside the three is still one Audit line, the point undecided", () => {
  test("parseDecision names the three, and rejects a fourth", () => {
    expect(parseDecision(JSON.stringify({ point: "a/b", action: "confirmed" }))).toEqual({
      error: '`action` must be "sent", "ignored" or "verified"',
    });
    expect(parseDecision(JSON.stringify({ ...verifiedTicket, action: "verify" }))).toMatchObject({
      error: expect.stringContaining("`action` must be"),
    });
  });
  test("the unreadable file is one Audit line; its point stays in Needs-you", () => {
    const unreadable = [{ file: "decisions/verify/lia-78.json", error: '`action` must be "sent", "ignored" or "verified"' }];
    const { md, file } = pipeline(REPORT, ctx(), unreadable);
    expect(md).toContain("**Unreadable decision files**\n- `decisions/verify/lia-78.json` — `action` must be");
    expect(md).toContain("- **LIA-78** — four ACs appear satisfied");
    expect("decision" in file.points.find((p) => p.id === "verify/lia-78")!).toBe(false);
  });
});

describe("LIA-114 AC8 — Housekeeping's decided count includes verified points", () => {
  test("one of each verdict → one line reading 3", () => {
    const decisions = new Map([ignored, sent, verifiedDocs].map((d) => [d.point, d] as const));
    const { md, file } = pipeline(REPORT, ctx({ decisions }));
    expect(file.points.filter((p) => p.decision)).toHaveLength(3);
    expect(md).toContain("- 3 points decided (decisions/)\n");
    expect(md.match(/points? decided/g)).toHaveLength(1);
  });
});

describe("LIA-114 — verifiedPoints is the tick's licensed edits, joined against points.json", () => {
  const file = pipeline(REPORT, ctx()).file;
  const all = new Map([ignored, sent, verifiedTicket, verifiedDocs].map((d) => [d.point, d] as const));

  test("only the verified verdicts come back, in report order, with the decision attached", () => {
    const got = verifiedPoints(file, all);
    expect(got.map((p) => p.id)).toEqual(["decide/usage-feature-still-has-zero-tests", "verify/lia-78"]);
    expect(got.map((p) => p.decision)).toEqual([verifiedDocs, verifiedTicket]);
  });
  test("`sent` and `ignored` license nothing", () => {
    expect(verifiedPoints(file, new Map([ignored, sent].map((d) => [d.point, d] as const)))).toEqual([]);
    expect(verifiedPoints(file, new Map())).toEqual([]);
  });
  test("a verified decision for a point this tick no longer reports is not an edit", () => {
    const gone: Decision = { ...verifiedTicket, point: "verify/something-already-dropped" };
    expect(verifiedPoints(file, new Map([[gone.point, gone]]))).toEqual([]);
  });
  test("the join does not mutate the points file", () => {
    verifiedPoints(file, all);
    expect(file.points.some((p) => p.decision)).toBe(false);
  });

  test("formatVerified prints the point's own text as the instruction, fields only when present", () => {
    const out = formatVerified(verifiedPoints(file, all));
    expect(out).toBe(
      [
        "decide/usage-feature-still-has-zero-tests — Usage feature still has zero tests — ticket it?",
        "  fe#405 deleted five test files in `admin-usage`; LIA-71 and LIA-78 both touch it.",
        "  features: admin-usage",
        "verify/lia-78 — LIA-78 — four ACs appear satisfied by fe#406, not ticked",
        "  AC1 (fixture deleted), AC8 (rollover band reads `credits.availableRollover`).",
        "  ticket: LIA-78 · reason: checked the diff, they are satisfied",
      ].join("\n"),
    );
  });
  test("nothing verified is an empty block, not a blank line", () => {
    expect(formatVerified([])).toBe("");
  });
  test("a point with neither ticket, features nor reason prints its two lines only", () => {
    const bare: Point = { id: "verify/x", group: "verify", subject: "X", ask: "right?", firstSeen: "2026-09-05" };
    expect(formatVerified([bare])).toBe("verify/x — X — right?");
  });
});

// ---------------------------------------------------------------- card shape (style.md)

/**
 * `skills/sweep/style.md` writes a Needs-you bullet as a card: headline, blank line,
 * indented detail. The parser must read a card exactly as it reads the compact shape,
 * and the writer must drop and insert around whole cards.
 */
const CARD_REPORT = `# sweep — 2026-09-05

_Seven landings journaled; three points need you._

_Tick 13:14 · no digest writeback (quiet) · staging@a49795756 · dev@5ca2ed71_

> **TL;DR**
> - Decide: whether the pr-facts ticket gets its label.

## Needs you

**Decide**
- **LIA-53 looks agent-ready** — label it? · 5d

  No Pending, no blockers, concrete Scope across \`pr-facts\`/\`feature-docs\`/\`audit\`.

- **Usage feature still has zero tests** — ticket it? · 1d

  fe#405 deleted five test files in \`admin-usage\`; LIA-71 and LIA-78 both touch it.

**Verify**
- **LIA-78** — four ACs appear satisfied by fe#406, not ticked · new

  AC1 (fixture deleted), AC8 (rollover band reads \`credits.availableRollover\`).

**On hold**
- LIA-83 Netlify preview bounce → waits on Auth0 tenant settings from Foong

**Housekeeping**
- All 22 features clean — no stale docs, audit clean

## Done today

### 09:49

| What | Went to | Commit |
|---|---|---|
| fe#405 — usage tests deleted | [journal](…) | \`abc1234\` |
`;

describe("card shape — a blank line between headline and detail changes nothing", () => {
  const compact = parseNeedsYou(REPORT).filter((i) =>
    ["LIA-53 looks agent-ready", "Usage feature still has zero tests", "LIA-78"].includes(i.subject),
  );
  const cards = parseNeedsYou(CARD_REPORT);
  test("same subjects, asks and details as the compact shape", () => {
    expect(cards.filter((i) => i.group !== "hold" && i.group !== "housekeeping").map((i) => [i.subject, i.ask, i.detail])).toEqual(
      compact.map((i) => [i.subject, i.ask, i.detail]),
    );
    expect(cards.map((i) => i.group)).toEqual(["decide", "decide", "verify", "hold", "housekeeping"]);
  });
  test("the TL;DR callout and the summary line are not points", () => {
    expect(cards.some((i) => i.subject.includes("TL;DR") || i.subject.includes("Seven landings"))).toBe(false);
  });
  test("a decided card is dropped whole — headline, blank and detail", () => {
    const { md } = pipeline(CARD_REPORT, withDecisions());
    expect(md).not.toContain("LIA-53 looks agent-ready");
    expect(md).not.toContain("No Pending, no blockers");
    expect(md).not.toContain("**Verify**");
    expect(md).toContain("- **Usage feature still has zero tests** — ticket it? · 1d\n\n  fe#405 deleted");
  });
  test("the Housekeeping count lands after the one-line Housekeeping bullet", () => {
    const { md } = pipeline(CARD_REPORT, withDecisions());
    expect(md).toContain("- All 22 features clean — no stale docs, audit clean\n- 2 points decided (decisions/)");
  });
  test("ages are rewritten on the headline line only", () => {
    const { md } = pipeline(CARD_REPORT, ctx({ day: "2026-09-06", previous: { tick: "", date: "2026-09-05", points: [
      { id: "verify/lia-78", group: "verify", subject: "LIA-78", ask: "x", firstSeen: "2026-09-05" },
    ] } }));
    expect(md).toContain("- **LIA-78** — four ACs appear satisfied by fe#406, not ticked · 1d\n\n  AC1 (fixture deleted)");
  });
});

// ---------------------------------------------------------------- LIA-145 — the arc group

import { parseArcDecision, readArcDecisions, type ArcDecision } from "./points.ts";

/** the verdict that opens an arc — a decision file, but never a verdict on a Needs-you point */
const openedArc = {
  point: "arc/invoice-emails",
  action: "opened",
  subject: "Invoice emails",
  at: "2026-09-09T06:00:00.000Z",
  seeds: { tickets: ["LIA-133", "LIA-137"], rules: ["BR-16a"], prs: ["fe#408"], features: ["admin-invoicing"] },
};
const closedArc = { point: "arc/invoice-emails", action: "closed", subject: "Invoice emails", at: "2026-09-09T07:00:00.000Z" };

describe("LIA-145 AC4 — an arc file parses as its own kind of verdict", () => {
  test("an opened file keeps its seeds and derives the slug from the point", () => {
    const parsed = parseArcDecision(JSON.stringify(openedArc)) as { decision: ArcDecision };
    expect(parsed.decision.slug).toBe("invoice-emails");
    expect(parsed.decision.action).toBe("opened");
    expect(parsed.decision.seeds).toEqual(openedArc.seeds);
    expect(parsed.decision.subject).toBe("Invoice emails");
  });
  test("a closed file needs no seeds — it only flips the status of an arc that exists", () => {
    const parsed = parseArcDecision(JSON.stringify(closedArc)) as { decision: ArcDecision };
    expect(parsed.decision.action).toBe("closed");
    expect(parsed.decision.seeds).toEqual({ tickets: [], rules: [], prs: [], features: [] });
  });
  test("seeds are normalised: absent kinds are empty arrays, duplicates collapse, values trim", () => {
    const parsed = parseArcDecision(JSON.stringify({ ...openedArc, seeds: { tickets: [" LIA-133 ", "LIA-133"] } })) as { decision: ArcDecision };
    expect(parsed.decision.seeds).toEqual({ tickets: ["LIA-133"], rules: [], prs: [], features: [] });
  });
  test("a malformed `seeds` is the one reason the file cannot be used", () => {
    expect(parseArcDecision(JSON.stringify({ ...openedArc, seeds: ["LIA-133"] }))).toEqual({
      error: "`seeds` must be an object of string arrays",
    });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, seeds: { tickets: "LIA-133" } }))).toEqual({
      error: "`seeds.tickets` must be an array of non-empty strings",
    });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, seeds: { tickets: ["LIA-133", ""] } }))).toEqual({
      error: "`seeds.tickets` must be an array of non-empty strings",
    });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, seeds: { threads: ["x"] } }))).toEqual({
      error: "`seeds.threads` is not a seed kind (tickets, rules, prs, features)",
    });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, seeds: {} }))).toEqual({
      error: "`seeds` required for an opened arc — an arc with no keys files nothing",
    });
  });
  test("the point must be `arc/<slug>` and the action one of the two", () => {
    expect(parseArcDecision(JSON.stringify({ ...openedArc, point: "decide/x" }))).toEqual({ error: "`point` must be `arc/<slug>`" });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, point: "arc/" }))).toEqual({ error: "`point` must be `arc/<slug>`" });
    expect(parseArcDecision(JSON.stringify({ ...openedArc, action: "sent" }))).toEqual({ error: '`action` must be "opened" or "closed"' });
    expect(parseArcDecision("{")).toMatchObject({ error: expect.stringContaining("not valid JSON") });
  });
});

describe("LIA-145 AC4 — an arc never joins the points", () => {
  const dir = async () => {
    const d = await mkdtemp(join(tmpdir(), "argus-arc-decisions-"));
    await mkdir(join(d, "arc"), { recursive: true });
    await mkdir(join(d, "decide"), { recursive: true });
    await writeFile(join(d, "arc", "invoice-emails.json"), JSON.stringify(openedArc));
    await writeFile(join(d, "arc", "invoice-emails-closed.json"), JSON.stringify(closedArc));
    await writeFile(join(d, "decide", "lia-53-looks-agent-ready.json"), JSON.stringify(ignored));
    return d;
  };

  test("readDecisions skips the arc group whole — no point decided, nothing unreadable", async () => {
    const { decisions, unreadable } = await readDecisions(await dir());
    expect([...decisions.keys()]).toEqual(["decide/lia-53-looks-agent-ready"]);
    expect(unreadable).toEqual([]);
  });
  test("a valid arc file is not an Audit line, and cannot decide a point named `arc/<slug>`", async () => {
    const { decisions } = await readDecisions(await dir());
    expect(decisions.has("arc/invoice-emails")).toBe(false);
    const { md, file } = pipeline(REPORT, ctx({ decisions }));
    expect(md).toContain("- 1 point decided (decisions/)\n"); // the Decide file, never the two arc files
    expect(file.points.filter((p) => p.decision)).toHaveLength(1);
  });
  test("readArcDecisions reads that group alone, opened and closed kept apart, later `at` winning", async () => {
    const d = await dir();
    await writeFile(join(d, "arc", "invoice-emails-earlier.json"), JSON.stringify({ ...openedArc, at: "2026-09-08T00:00:00.000Z", subject: "Older" }));
    const { arcs, unreadable } = await readArcDecisions(d);
    expect(arcs.map((a) => a.slug)).toEqual(["invoice-emails"]);
    expect(arcs[0]!.opened!.subject).toBe("Invoice emails");
    expect(arcs[0]!.closed!.at).toBe(closedArc.at);
    expect(unreadable).toEqual([]);
  });
  test("a malformed arc file is one Audit line, and still no decision", async () => {
    const d = await dir();
    await writeFile(join(d, "arc", "broken.json"), JSON.stringify({ ...openedArc, point: "arc/broken", seeds: { tickets: [7] } }));
    const { arcs, unreadable } = await readArcDecisions(d);
    expect(arcs.map((a) => a.slug)).toEqual(["invoice-emails"]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.file.endsWith("arc/broken.json")).toBe(true);
    expect(unreadable[0]!.error).toBe("`seeds.tickets` must be an array of non-empty strings");
    expect((await readDecisions(d)).unreadable).toEqual([]);
  });
  test("no decisions directory → no arcs, nothing unreadable", async () => {
    expect(await readArcDecisions("/nonexistent/argus-arc-decisions")).toEqual({ arcs: [], unreadable: [] });
  });
});
