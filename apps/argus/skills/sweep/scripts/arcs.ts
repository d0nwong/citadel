#!/usr/bin/env bun
/**
 * arcs — the running story of an initiative, as a file (LIA-145).
 *
 * Every other record the loop writes describes one moment: `digests/<day>.md` is what was
 * said that day, `reports/<day>.md` what this tick wants from you, a feature's `docs/` the
 * state of the code. None of them is the state of the *work*, so the reader assembles each
 * initiative's story by hand every morning. `arcs/<slug>.md` is that story: a "Where we
 * are" paragraph over the evidence that changed it.
 *
 *   bun skills/sweep/scripts/arcs.ts                 decisions/arc/ → arcs/*.md, say what moved
 *   bun skills/sweep/scripts/arcs.ts invoice-emails  just this one
 *   bun skills/sweep/scripts/arcs.ts --dry-run       print, write nothing
 *
 * The split of labour is the point. **This script owns everything derivable** — the
 * frontmatter, the Landed table, the Open list — and rewrites all three from the
 * blackboard every run, so an arc cannot drift from it. **The sweep owns the paragraph**:
 * the script preserves `## Where we are` byte for byte and reports which arcs moved, and
 * the sweep's arc step rewrites those paragraphs (`skills/sweep/SKILL.md`). An arc no
 * journal entry, point or decision touched this tick comes out byte-identical, which is
 * what makes the step safe to run on every tick.
 *
 * An arc is opened and closed by the user, never here: `decisions/arc/<slug>.json`
 * (`action: "opened" | "closed"`, written by Pensieve) is the only thing that creates an
 * arc file or sets its `status: closed`. An item is filed against an arc **only through a
 * key in its seeds** — a ticket, a rule id, a PR, a feature dir — never by resemblance.
 */

import { join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import { ROOT as ARGUS_ROOT } from "../../../scripts/lib/manifest.ts";
import { loadAllJournals, listField, type AppJournalEntry } from "../../../scripts/lib/journal.ts";
import {
  readArcDecisions,
  isoDay,
  emptySeeds,
  SEED_KINDS,
  type ArcSeeds,
  type ArcVerdicts,
  type PointsFile,
  type Point,
  type Unreadable,
} from "./points.ts";

export const ARCS_DIR = "arcs";
/** the budget the paragraph is written to, so every arc fits one screen of the Arcs page */
export const WHERE_WORD_BUDGET = 120;
const PLACEHOLDER = "_(the sweep writes this paragraph on the tick that opens the arc.)_";

export type LandedRow = { when: string; what: string; evidence: string };
export type Arc = {
  slug: string;
  title: string;
  status: "open" | "closed";
  /** the `at` of the `opened` decision file */
  opened: string;
  /** the day of the last rewrite — bumped only by a run that changed something else */
  updated: string;
  seeds: ArcSeeds;
  /** `## Where we are`, as written — the sweep's, never this script's */
  where: string[];
  landed: LandedRow[];
  open: string[];
};

// ---------------------------------------------------------------- the file

const listOut = (xs: string[]) => `[${xs.join(", ")}]`;

/** `arcs/<slug>.md` — the whole file, from the record. The only writer of this shape. */
export function renderArc(arc: Arc): string {
  const rows = arc.landed.length
    ? ["| When | What | Evidence |", "|---|---|---|", ...arc.landed.map((r) => `| ${r.when} | ${r.what} | ${r.evidence} |`)]
    : ["_Nothing landed against this arc yet._"];
  return [
    "---",
    `slug: ${arc.slug}`,
    `title: ${arc.title}`,
    `status: ${arc.status}`,
    `opened: ${arc.opened}`,
    `updated: ${arc.updated}`,
    "seeds:",
    ...SEED_KINDS.map((k) => `  ${k}: ${listOut(arc.seeds[k])}`),
    "---",
    "",
    "## Where we are",
    "",
    ...(arc.where.length ? arc.where : [PLACEHOLDER]),
    "",
    "## Landed",
    "",
    ...rows,
    "",
    "## Open",
    "",
    ...(arc.open.length ? arc.open : ["_Nothing open._"]),
    "",
  ].join("\n");
}

const section = (body: string, heading: string): string[] => {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return [];
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ")) end++;
  return trimBlank(lines.slice(start + 1, end));
};

const trimBlank = (lines: string[]) => {
  const out = [...lines];
  while (out.length && out[0]!.trim() === "") out.shift();
  while (out.length && out[out.length - 1]!.trim() === "") out.pop();
  return out;
};

/** an `arcs/<slug>.md` back into the record; a file it cannot read is a `null` the caller reports */
export function parseArc(text: string, slug: string): Arc | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const [fm, body] = [m[1]!, m[2] ?? ""];
  const field = (k: string) => fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"))?.[1]?.trim();
  const seeds = emptySeeds();
  for (const k of SEED_KINDS) {
    const raw = fm.match(new RegExp(`^\\s+${k}:[ \\t]*(.*)$`, "m"))?.[1];
    seeds[k] = listField(raw);
  }
  const where = section(body, "Where we are");
  return {
    slug: field("slug") || slug,
    title: field("title") || slug,
    status: field("status") === "closed" ? "closed" : "open",
    opened: field("opened") ?? "",
    updated: field("updated") ?? "",
    seeds,
    where: where.length === 1 && where[0] === PLACEHOLDER ? [] : where,
    landed: section(body, "Landed").flatMap(parseLandedRow),
    open: section(body, "Open").filter((l) => l.startsWith("- ")),
  };
}

function parseLandedRow(line: string): LandedRow[] {
  const cells = line.split("|").map((c) => c.trim());
  // a row is `| when | what | evidence |` → ["", when, what, evidence, ""]; skip head + rule
  if (cells.length !== 5 || cells[1] === "When" || /^-+$/.test(cells[1] ?? "")) return [];
  return [{ when: cells[1]!, what: cells[2]!, evidence: cells[3]! }];
}

// ---------------------------------------------------------------- the join

/** the seed keys `entry` carries, in seed order — empty means the arc does not hold it */
export function entrySeeds(entry: AppJournalEntry, seeds: ArcSeeds): string[] {
  const prs = listField(entry.pr);
  return [
    ...seeds.tickets.filter((t) => entry.tickets.includes(t)),
    ...seeds.rules.filter((r) => entry.affects.includes(r)),
    ...seeds.prs.filter((p) => prs.includes(p)),
    ...seeds.features.filter((f) => entry.features.includes(f)),
  ];
}

/** the seed keys a Needs-you point carries — its ticket, its features, or a rule / PR in its text */
export function pointSeeds(point: Point, seeds: ArcSeeds): string[] {
  const text = `${point.subject} ${point.ask} ${point.detail ?? ""}`;
  const names = (key: string) => new RegExp(`(^|[^\\w-])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`).test(text);
  return [
    ...seeds.tickets.filter((t) => point.ticket === t || (!point.ticket && names(t))),
    ...seeds.rules.filter(names),
    ...seeds.prs.filter(names),
    ...seeds.features.filter((f) => point.features?.includes(f)),
  ];
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const clip = (s: string, n = 100) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** a journal entry as its Landed row: what it was, and the file that says so */
export const landedFromEntry = (entry: AppJournalEntry): LandedRow => {
  const key = listField(entry.pr).filter((p) => p !== "direct")[0] ?? entry.tickets[0] ?? (entry.status === "decided" ? "decided" : "landed");
  return { when: entry.date ?? "—", what: cell(`${key} — ${clip(entry.summary ?? "(no summary)")}`), evidence: `\`${entry.rel}\`` };
};

/** a decided point as its Landed row — the verdict is the event, the decision file the evidence */
export const landedFromPoint = (point: Point): LandedRow => ({
  when: (point.decision?.at ?? "").slice(0, 10) || "—",
  what: cell(`${point.subject} — ${point.decision!.action}${point.decision?.reason ? ` ("${clip(point.decision.reason, 60)}")` : ""}`),
  evidence: `\`decisions/${point.id}.json\``,
});

const openLine = (point: Point) => `- **${cell(point.subject)}** → ${cell(point.ask)} · \`${point.id}\``;
const openTicketLine = (key: string, title: string) => `- ${key} — ${cell(clip(title, 80))} → open in Linear`;

export type BuildInput = {
  journals: AppJournalEntry[];
  points: PointsFile | null;
  /** step 3's open-ticket list (`.state/linear-titles.json`); absent → tickets are left off Open */
  openTickets?: Record<string, { title: string }>;
  /** the day this tick stamps a rewrite with */
  day: string;
};

/**
 * The arc as this tick's evidence makes it, keeping the existing paragraph. Everything but
 * `## Where we are` is derived, so two runs over one blackboard state give one file.
 */
export function buildArc(verdicts: ArcVerdicts, existing: Arc | null, input: BuildInput): Arc | { error: string } {
  const { opened, closed } = verdicts;
  if (!opened && !existing) return { error: `closed with no \`opened\` file and no arcs/${verdicts.slug}.md to close` };
  const seeds = opened?.seeds ?? existing!.seeds;
  const points = input.points?.points ?? [];
  const mine = points.filter((p) => pointSeeds(p, seeds).length);

  const landed = [
    ...input.journals.filter((e) => entrySeeds(e, seeds).length).map(landedFromEntry),
    ...mine.filter((p) => p.decision).map(landedFromPoint),
  ].sort((a, b) => a.when.localeCompare(b.when) || a.evidence.localeCompare(b.evidence));

  const listed = new Set(mine.filter((p) => !p.decision).map((p) => p.ticket).filter(Boolean) as string[]);
  const open = [
    ...mine.filter((p) => !p.decision).map(openLine),
    ...(input.openTickets
      ? seeds.tickets.filter((t) => !listed.has(t) && input.openTickets![t]).map((t) => openTicketLine(t, input.openTickets![t]!.title))
      : []),
  ];

  return {
    slug: verdicts.slug,
    title: opened?.subject ?? existing?.title ?? verdicts.slug,
    status: closed ? "closed" : "open",
    opened: opened?.at ?? existing?.opened ?? "",
    updated: existing?.updated ?? input.day,
    seeds,
    where: existing?.where ?? [],
    landed,
    open,
  };
}

// ---------------------------------------------------------------- what moved

export type ArcChange = {
  slug: string;
  path: string;
  /** `created` on the arc's first tick, `rewritten` when the evidence moved, else `unchanged` */
  kind: "created" | "rewritten" | "unchanged";
  added: LandedRow[];
  removed: LandedRow[];
  openNow: string[];
  where: string[];
  /** the words in `where` — the sweep's budget, reported so an over-long paragraph is visible */
  words: number;
  status: "open" | "closed";
  text: string;
};

const words = (lines: string[]) => lines.join(" ").split(/\s+/).filter(Boolean).length;
const key = (r: LandedRow) => `${r.when}|${r.evidence}`;

/** the arc, the file it renders to, and what this tick moved in it */
export function changeOf(arc: Arc, existing: Arc | null, existingText: string | null, day: string): ArcChange {
  const first = renderArc(arc);
  // `updated` is a consequence of a change, never a change itself: render with the old
  // stamp, and only if something else moved re-render with today's
  const changed = existingText === null || first !== existingText;
  const text = changed && existing ? renderArc({ ...arc, updated: day }) : first;
  const before = new Map((existing?.landed ?? []).map((r) => [key(r), r]));
  const after = new Map(arc.landed.map((r) => [key(r), r]));
  return {
    slug: arc.slug,
    path: `${ARCS_DIR}/${arc.slug}.md`,
    kind: existingText === null ? "created" : changed ? "rewritten" : "unchanged",
    added: arc.landed.filter((r) => !before.has(key(r))),
    removed: (existing?.landed ?? []).filter((r) => !after.has(key(r))),
    openNow: arc.open,
    where: arc.where,
    words: words(arc.where),
    status: arc.status,
    text,
  };
}

/** the block the sweep reads to write the paragraph: what moved, what is open, the budget */
export function formatChange(c: ArcChange): string {
  const out = [
    `## ${c.slug} — ${c.kind}${c.status === "closed" ? " · closed" : ""} · ${c.path}`,
    "",
    `Where we are (as it stands${c.where.length ? `, ${c.words} words` : " — not written yet"}):`,
    ...(c.where.length ? c.where : ["  (none — this tick writes the first paragraph)"]),
  ];
  if (c.words > WHERE_WORD_BUDGET) out.push("", `⚠ over the ${WHERE_WORD_BUDGET}-word budget by ${c.words - WHERE_WORD_BUDGET} — rewrite it shorter.`);
  if (c.added.length) out.push("", "Landed since the last rewrite:", ...c.added.map((r) => `- ${r.when} · ${r.what} · ${r.evidence}`));
  if (c.removed.length) out.push("", "No longer filed against the arc:", ...c.removed.map((r) => `- ${r.when} · ${r.what} · ${r.evidence}`));
  out.push("", `Open (${c.openNow.length}):`, ...(c.openNow.length ? c.openNow : ["- (nothing — say so in the paragraph; only the user closes an arc)"]));
  return out.join("\n");
}

// ---------------------------------------------------------------- run

export type RunOpts = { root?: string; decisions?: string; only?: string[]; dryRun?: boolean; day?: string };
export type RunResult = { changes: ArcChange[]; unreadable: Unreadable[]; problems: string[] };

const readJson = async <T>(path: string): Promise<T | null> => ((await Bun.file(path).exists()) ? ((await Bun.file(path).json()) as T) : null);

/** `.state/linear-titles.json` in either shape step 3 writes, reduced to titles by key */
export function openTicketTitles(raw: unknown): Record<string, { title: string }> | undefined {
  if (!raw) return undefined;
  const out: Record<string, { title: string }> = {};
  if (Array.isArray(raw)) {
    for (const t of raw as { identifier?: string; title?: string }[]) if (t?.identifier && t.title) out[t.identifier] = { title: t.title };
  } else if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>))
      if (typeof v === "string") out[k] = { title: v };
      else if (v && typeof v === "object" && typeof (v as { title?: unknown }).title === "string") out[k] = { title: (v as { title: string }).title };
  }
  return Object.keys(out).length ? out : undefined;
}

/** every `arcs/*.md` under `root`, by slug */
export async function loadArcs(root = ARGUS_ROOT): Promise<Map<string, { arc: Arc | null; text: string }>> {
  const dir = join(root, ARCS_DIR);
  const out = new Map<string, { arc: Arc | null; text: string }>();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const slug = name.slice(0, -3);
    const text = await Bun.file(join(dir, name)).text();
    out.set(slug, { arc: parseArc(text, slug), text });
  }
  return out;
}

/** one pass: `decisions/arc/` + the blackboard → `arcs/*.md`, and what moved in each */
export async function run(opts: RunOpts = {}): Promise<RunResult> {
  const root = opts.root ?? ARGUS_ROOT;
  const day = opts.day ?? isoDay(new Date());
  const [{ arcs: verdicts, unreadable }, existing, journals, points, titles] = await Promise.all([
    readArcDecisions(opts.decisions ?? join(root, "decisions")),
    loadArcs(root),
    loadAllJournals(root),
    readJson<PointsFile>(join(root, "reports/points.json")),
    readJson<unknown>(join(root, ".state/linear-titles.json")),
  ]);
  const input: BuildInput = { journals, points, openTickets: openTicketTitles(titles), day };

  const changes: ArcChange[] = [];
  const problems: string[] = [];
  for (const v of verdicts) {
    if (opts.only?.length && !opts.only.includes(v.slug)) continue;
    const had = existing.get(v.slug) ?? null;
    if (had && !had.arc) {
      problems.push(`${ARCS_DIR}/${v.slug}.md — no frontmatter, left alone (delete it to have the arc rebuilt)`);
      continue;
    }
    const built = buildArc(v, had?.arc ?? null, input);
    if ("error" in built) {
      problems.push(`${v.slug} — ${built.error}`);
      continue;
    }
    const change = changeOf(built, had?.arc ?? null, had?.text ?? null, day);
    changes.push(change);
    if (!opts.dryRun && change.kind !== "unchanged") {
      await mkdir(join(root, ARCS_DIR), { recursive: true });
      await Bun.write(join(root, change.path), change.text);
    }
  }
  for (const slug of opts.only ?? []) if (!verdicts.some((v) => v.slug === slug)) problems.push(`${slug} — no decisions/arc/${slug}.json opens it`);
  return { changes, unreadable, problems };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const decisions = flag("--decisions");
  const root = flag("--root");
  const dryRun = args.includes("--dry-run");
  const only = args.filter((a) => !a.startsWith("--"));

  try {
    const { changes, unreadable, problems } = await run({ root, decisions, only, dryRun });
    const moved = changes.filter((c) => c.kind !== "unchanged");
    for (const c of moved) console.log(formatChange(c), "\n");
    for (const u of unreadable) problems.push(`${u.file} — ${u.error}`);
    for (const p of problems) console.error(`arcs: ${p}`);
    console.error(
      `arcs: ${changes.length} arc${changes.length === 1 ? "" : "s"} · ${moved.length} moved` +
        `${moved.length ? ` (${moved.map((c) => `${c.slug} ${c.kind}`).join(", ")})` : ""}` +
        `${dryRun ? " · (dry run)" : ""}` +
        `${problems.length ? ` · ${problems.length} problem(s)` : ""}`,
    );
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.error(`arcs: ${(err as Error).message}`);
    process.exit(1);
  }
}
