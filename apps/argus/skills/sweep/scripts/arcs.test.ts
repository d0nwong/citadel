/**
 * arcs.ts — the running story of an initiative, as a file (LIA-145).
 *
 * The cases are the ticket's acceptance criteria: what an `opened` decision produces (AC1),
 * what a tick that moved something rewrites and what a quiet tick leaves alone (AC2), what
 * `closed` does and does not do (AC3), and the paragraph's budget (AC6).
 *
 *   bun test skills/sweep/scripts/arcs.test.ts
 */

import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArc,
  renderArc,
  buildArc,
  changeOf,
  entrySeeds,
  pointSeeds,
  openTicketTitles,
  formatChange,
  run,
  WHERE_WORD_BUDGET,
  type Arc,
  type BuildInput,
} from "./arcs.ts";
import { emptySeeds, type ArcVerdicts, type ArcSeeds, type Point, type PointsFile } from "./points.ts";
import type { AppJournalEntry } from "../../../scripts/lib/journal.ts";

const seeds = (over: Partial<ArcSeeds> = {}): ArcSeeds => ({ ...emptySeeds(), ...over });

const opened: ArcVerdicts = {
  slug: "invoice-emails",
  opened: {
    point: "arc/invoice-emails",
    slug: "invoice-emails",
    action: "opened",
    subject: "Invoice emails",
    at: "2026-09-09T06:00:00.000Z",
    seeds: seeds({ tickets: ["LIA-133", "LIA-137"], rules: ["BR-16a"], prs: ["fe#408"], features: ["admin-invoicing"] }),
  },
};
const closed: ArcVerdicts = {
  ...opened,
  closed: { point: "arc/invoice-emails", slug: "invoice-emails", action: "closed", at: "2026-09-09T07:00:00.000Z", seeds: emptySeeds() },
};

const entry = (over: Partial<AppJournalEntry> = {}): AppJournalEntry => ({
  name: "admin/invoicing/journal/2026-09/2026-09-07/x.md",
  path: "/abs/x.md",
  rel: "alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-07/x.md",
  app: "alden/alden-portal",
  featureDir: "admin/invoicing",
  date: "2026-09-07",
  status: "documented",
  features: ["admin-invoicing"],
  tickets: [],
  affects: [],
  summary: "The invoice email subject drops the total",
  ...over,
});

const point = (over: Partial<Point> = {}): Point => ({
  id: "decide/lia-133-is-ready",
  group: "decide",
  subject: "LIA-133 is ready",
  ask: "send to Foundry?",
  firstSeen: "2026-09-09",
  ticket: "LIA-133",
  ...over,
});

const pointsFile = (points: Point[]): PointsFile => ({ tick: "2026-09-09T05:22:00.000Z", date: "2026-09-09", points });
const input = (over: Partial<BuildInput> = {}): BuildInput => ({ journals: [], points: null, day: "2026-09-09", ...over });
const built = (v: ArcVerdicts, existing: Arc | null, i: BuildInput) => buildArc(v, existing, i) as Arc;

describe("AC1 — an opened decision produces the arc, over the evidence its seeds name", () => {
  const journals = [
    entry({ pr: "fe#408", features: [] }),
    entry({ rel: "…/lia-137.md", tickets: ["LIA-137"], features: [], date: "2026-09-08", summary: "The discount line" }),
    entry({ rel: "…/br-16a.md", affects: ["BR-16a"], features: [], date: "2026-09-05", summary: "The email body copy" }),
    entry({ rel: "…/feature.md", date: "2026-09-06", summary: "An invoicing change with no key" }),
    entry({ rel: "…/other.md", features: ["admin-usage"], date: "2026-09-04", summary: "Nothing to do with the arc" }),
  ];
  const arc = built(opened, null, input({ journals, points: pointsFile([point(), point({ id: "decide/other", subject: "Other", ticket: "LIA-99" })]) }));

  test("the frontmatter is the contract in PLAN.md's Shared contracts", () => {
    expect(arc.slug).toBe("invoice-emails");
    expect(arc.title).toBe("Invoice emails");
    expect(arc.status).toBe("open");
    expect(arc.opened).toBe("2026-09-09T06:00:00.000Z");
    expect(arc.updated).toBe("2026-09-09");
    expect(arc.seeds).toEqual(opened.opened!.seeds);
  });
  test("Landed lists every entry a seed names — ticket, rule, PR or feature — oldest first", () => {
    expect(arc.landed.map((r) => r.when)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    expect(arc.landed.every((r) => r.evidence.startsWith("`") && r.evidence.endsWith("`"))).toBe(true);
    expect(arc.landed.map((r) => r.evidence)).not.toContain("`…/other.md`");
  });
  test("an entry no seed names is not filed against the arc — resemblance is not a key", () => {
    expect(entrySeeds(entry({ features: ["admin-usage"], summary: "invoice emails, obviously" }), opened.opened!.seeds)).toEqual([]);
    expect(entrySeeds(entry({ pr: "[fe#408, direct]", features: [] }), opened.opened!.seeds)).toEqual(["fe#408"]);
  });
  test("Open lists the open points the seeds name, and nothing else", () => {
    expect(arc.open).toHaveLength(1);
    expect(arc.open[0]).toContain("**LIA-133 is ready** → send to Foundry?");
    expect(arc.open[0]).toContain("`decide/lia-133-is-ready`");
  });
  test("a point matches by its ticket, its features, or a rule / PR named in its text", () => {
    const s = opened.opened!.seeds;
    const keyless = { ticket: undefined, subject: "The reminder copy" };
    expect(pointSeeds(point({ ...keyless, features: ["admin-invoicing"] }), s)).toEqual(["admin-invoicing"]);
    expect(pointSeeds(point({ ...keyless, detail: "BR-16a is wrong" }), s)).toEqual(["BR-16a"]);
    expect(pointSeeds(point({ ...keyless, detail: "fe#408 landed it" }), s)).toEqual(["fe#408"]);
    // the ticket field wins when there is one: a point about LIA-137 that merely mentions
    // LIA-133 is filed under its own ticket, and both are seeds here
    expect(pointSeeds(point({ ticket: "LIA-137", detail: "unlike LIA-133" }), s)).toEqual(["LIA-137"]);
    expect(pointSeeds(point({ ticket: "LIA-1337" }), s)).toEqual([]);
    expect(pointSeeds(point({ ticket: undefined, subject: "LIA-1337 is ready" }), s)).toEqual([]);
  });
  test("a seeded ticket with no point is listed from the tick's open-ticket list, when there is one", () => {
    const openTickets = { "LIA-137": { title: "[FE] Invoice email: show the applied discount" }, "LIA-99": { title: "Not seeded" } };
    const withTickets = built(opened, null, input({ points: pointsFile([point()]), openTickets }));
    expect(withTickets.open).toHaveLength(2);
    expect(withTickets.open[1]).toBe("- LIA-137 — [FE] Invoice email: show the applied discount → open in Linear");
    expect(built(opened, null, input({ points: pointsFile([point()]) })).open).toHaveLength(1);
  });
  test("a decided point is evidence, not an ask: it moves to Landed with its decision file", () => {
    const decided = point({ decision: { point: "decide/lia-133-is-ready", action: "sent", at: "2026-09-09T08:00:00.000Z" } });
    const arc2 = built(opened, null, input({ points: pointsFile([decided]) }));
    expect(arc2.open).toEqual([]);
    expect(arc2.landed).toEqual([{ when: "2026-09-09", what: "LIA-133 is ready — sent", evidence: "`decisions/decide/lia-133-is-ready.json`" }]);
  });
  test("the file round-trips: render → parse → render is a fixed point", () => {
    const text = renderArc(arc);
    expect(parseArc(text, arc.slug)).toEqual({ ...arc, where: [] });
    expect(renderArc(parseArc(text, arc.slug)!)).toBe(text);
    expect(text).toContain("## Where we are");
    expect(text).toContain("| When | What | Evidence |");
    expect(text).toContain("## Open");
  });
});

describe("AC2 — a tick that moved something rewrites; a tick that did not leaves the file alone", () => {
  const where = ["Four PRs landed the new copy on 09-07; LIA-133's resend rule is the last open step."];
  const first = built(opened, null, input({ journals: [entry({ pr: "fe#408", features: [] })] }));
  const onDisk: Arc = { ...first, where };
  const text = renderArc(onDisk);

  test("nothing new → the same bytes, kind `unchanged`, and `updated` does not move", () => {
    const again = built(opened, onDisk, input({ journals: [entry({ pr: "fe#408", features: [] })] }));
    const change = changeOf(again, onDisk, text, "2026-09-10");
    expect(change.kind).toBe("unchanged");
    expect(change.text).toBe(text);
    expect(change.added).toEqual([]);
  });
  test("one new landing → one new row, the paragraph kept for the sweep to rewrite, `updated` today", () => {
    const journals = [entry({ pr: "fe#408", features: [] }), entry({ rel: "…/new.md", tickets: ["LIA-137"], features: [], date: "2026-09-10", summary: "The discount line" })];
    const next = built(opened, onDisk, input({ journals, day: "2026-09-10" }));
    const change = changeOf(next, onDisk, text, "2026-09-10");
    expect(change.kind).toBe("rewritten");
    expect(change.added.map((r) => r.evidence)).toEqual(["`…/new.md`"]);
    expect(change.text).toContain("updated: 2026-09-10");
    expect(change.text).toContain(where[0]!);
    expect(change.text.split("\n").filter((l) => l.startsWith("| 2026")).length).toBe(2);
  });
  test("a point opening against the arc rewrites it too, and shows in Open", () => {
    const next = built(opened, onDisk, input({ journals: [entry({ pr: "fe#408", features: [] })], points: pointsFile([point()]) }));
    const change = changeOf(next, onDisk, text, "2026-09-10");
    expect(change.kind).toBe("rewritten");
    expect(change.openNow).toHaveLength(1);
    expect(change.added).toEqual([]);
  });
  test("what moved is reported to the sweep, which is what it rewrites the paragraph from", () => {
    const journals = [entry({ rel: "…/new.md", tickets: ["LIA-137"], features: [], date: "2026-09-10", summary: "The discount line" })];
    const block = formatChange(changeOf(built(opened, onDisk, input({ journals })), onDisk, text, "2026-09-10"));
    expect(block).toContain("## invoice-emails — rewritten · arcs/invoice-emails.md");
    expect(block).toContain(where[0]!);
    expect(block).toContain("Landed since the last rewrite:");
    expect(block).toContain("No longer filed against the arc:");
    expect(block).toContain("Open (0):");
  });
});

describe("AC3 — closed is the user's verdict, and only ever theirs", () => {
  test("a closed file sets `status: closed` and touches nothing else", () => {
    const open = built(opened, null, input());
    const shut = built(closed, open, input());
    expect(shut.status).toBe("closed");
    expect({ ...shut, status: "open" }).toEqual({ ...open, status: "open" });
  });
  test("an arc with nothing open stays open — the file says so, it does not close itself", () => {
    const arc = built(opened, null, input());
    expect(arc.open).toEqual([]);
    expect(arc.status).toBe("open");
    expect(renderArc(arc)).toContain("_Nothing open._");
  });
  test("a closed file for an arc that was never opened is a problem, not a new arc", () => {
    const orphan = buildArc({ slug: "ghost", closed: closed.closed }, null, input());
    expect(orphan).toEqual({ error: "closed with no `opened` file and no arcs/ghost.md to close" });
  });
});

describe("AC6 — the paragraph is current state, and the budget is reported", () => {
  test("a paragraph over the budget is called out with how far over", () => {
    const long = ["word ".repeat(WHERE_WORD_BUDGET + 7).trim()];
    const arc = { ...built(opened, null, input()), where: long };
    const change = changeOf(arc, null, null, "2026-09-09");
    expect(change.words).toBe(WHERE_WORD_BUDGET + 7);
    expect(formatChange(change)).toContain(`⚠ over the ${WHERE_WORD_BUDGET}-word budget by 7`);
  });
  test("an arc with no paragraph yet says so, so the tick that opens it writes one", () => {
    const change = changeOf(built(opened, null, input()), null, null, "2026-09-09");
    expect(change.kind).toBe("created");
    expect(change.where).toEqual([]);
    expect(formatChange(change)).toContain("this tick writes the first paragraph");
  });
});

describe("AC5 — the tick's open-ticket list is read in either shape step 3 writes", () => {
  test("the map, the title-only map and the MCP array all reduce to titles", () => {
    expect(openTicketTitles({ "LIA-133": { title: "A", project: "Alden Portal" } })).toEqual({ "LIA-133": { title: "A" } });
    expect(openTicketTitles({ "LIA-133": "A" })).toEqual({ "LIA-133": { title: "A" } });
    expect(openTicketTitles([{ identifier: "LIA-133", title: "A" }])).toEqual({ "LIA-133": { title: "A" } });
    expect(openTicketTitles(null)).toBeUndefined();
    expect(openTicketTitles({})).toBeUndefined();
  });
});

describe("run — decisions/arc/ → arcs/*.md, on a workspace of its own", () => {
  const workspace = async () => {
    const root = await mkdtemp(join(tmpdir(), "argus-arcs-"));
    await mkdir(join(root, "decisions/arc"), { recursive: true });
    await mkdir(join(root, "reports"), { recursive: true });
    await mkdir(join(root, "alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-07"), { recursive: true });
    await writeFile(
      join(root, "alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-07/fe408.md"),
      "---\ndate: 2026-09-07\npr: fe#408\nticket: null\nfeatures: [admin-invoicing]\nstatus: documented\nsummary: The subject drops the total\naffects: [BR-16a]\n---\n",
    );
    await writeFile(join(root, "reports/points.json"), JSON.stringify(pointsFile([point()])));
    await writeFile(join(root, "decisions/arc/invoice-emails.json"), JSON.stringify({ ...opened.opened, slug: undefined }));
    return root;
  };

  test("the arc is written once, then a second run is a no-op", async () => {
    const root = await workspace();
    const first = await run({ root, day: "2026-09-09" });
    expect(first.problems).toEqual([]);
    expect(first.changes.map((c) => c.kind)).toEqual(["created"]);
    const text = await readFile(join(root, "arcs/invoice-emails.md"), "utf8");
    expect(text).toContain("slug: invoice-emails");
    expect(text).toContain("| 2026-09-07 | fe#408 — The subject drops the total | `alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-07/fe408.md` |");
    expect(text).toContain("- **LIA-133 is ready** → send to Foundry? · `decide/lia-133-is-ready`");

    const second = await run({ root, day: "2026-09-10" });
    expect(second.changes.map((c) => c.kind)).toEqual(["unchanged"]);
    expect(await readFile(join(root, "arcs/invoice-emails.md"), "utf8")).toBe(text);
  });
  test("--dry-run writes nothing", async () => {
    const root = await workspace();
    const { changes } = await run({ root, dryRun: true, day: "2026-09-09" });
    expect(changes.map((c) => c.kind)).toEqual(["created"]);
    expect(await Bun.file(join(root, "arcs/invoice-emails.md")).exists()).toBe(false);
  });
  test("a malformed arc decision is reported, and stops nothing else", async () => {
    const root = await workspace();
    await writeFile(join(root, "decisions/arc/broken.json"), '{"point":"arc/broken","action":"opened","seeds":{"tickets":"LIA-1"}}');
    const { changes, unreadable } = await run({ root, day: "2026-09-09" });
    expect(changes.map((c) => c.slug)).toEqual(["invoice-emails"]);
    expect(unreadable.map((u) => u.error)).toEqual(["`seeds.tickets` must be an array of non-empty strings"]);
  });
  test("a slug no decision opens is a problem, not an empty file", async () => {
    const root = await workspace();
    const { changes, problems } = await run({ root, only: ["ghost"], day: "2026-09-09" });
    expect(changes).toEqual([]);
    expect(problems).toEqual(["ghost — no decisions/arc/ghost.json opens it"]);
  });
});
