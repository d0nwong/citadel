/**
 * points.ts — the Needs-you section as data (LIA-87).
 *
 * The fixture is the report shape `skills/sweep/SKILL.md` step 8 mandates; the cases are
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
  const titles = { "LIA-71": "[FE] Usage History tab", "LIA-78": "[FE][BE] Usage endpoints", "LIA-53": "Pin accio stamps" };
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
      "LIA-1": "[FE] x",
      "LIA-2": "y",
    });
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
