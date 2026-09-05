#!/usr/bin/env bun
/**
 * points — the Needs-you section of a sweep report, as data (LIA-87).
 *
 * `reports/<day>.md` is the human copy of what the sweep wants from you; nothing else on
 * the blackboard holds a Needs-you item, so nothing else can refer to one. This reads that
 * section back out of the report and writes `reports/points.json`: one record per Decide /
 * Verify / Confirm / On-hold / Housekeeping bullet, each with an id that survives from one
 * tick to the next. Pensieve lists the file to offer Send / Ignore per point (LIA-94), and
 * this reads the decisions back (LIA-88): a point whose id has a file under `decisions/`
 * is dropped from the report's Needs-you and kept in points.json with the decision attached.
 *
 *   bun skills/sweep/scripts/points.ts                     today's report → reports/points.json
 *   bun skills/sweep/scripts/points.ts reports/2026-09-04.md
 *   bun skills/sweep/scripts/points.ts --dry-run           print, write nothing
 *   bun skills/sweep/scripts/points.ts --titles <file>     Linear titles, for `repo` (see below)
 *   bun skills/sweep/scripts/points.ts --decisions <dir>   read decisions from <dir> (default decisions/)
 *
 * Two things are derived rather than asked of the sweep, because deriving is what keeps
 * the two shapes from drifting:
 *
 *   id        `<group>/<slug>` — slug is the subject lowercased, every run of
 *             non-alphanumerics → one `-`, trimmed. Same subject, same id, so a subject
 *             must not be reworded tick to tick or the point starts over.
 *   firstSeen the previous points.json wins; a point not in it takes the `· Nd` age its
 *             report line already carries, else the oldest reports/*.md naming the
 *             subject, else the report's day. The report's age suffix is then rewritten
 *             so `· new` / `· Nd` agrees with firstSeen — write `new` and let this fix it.
 *
 * `ticket` is the LIA key when the subject or detail names exactly one. `repo` needs the
 * ticket's title tag (`[FE]` / `[BE]`), which lives in Linear: the sweep drops its step-3
 * open-ticket list at `.state/linear-titles.json` (`{ "LIA-86": "[FE] …" }`, or the MCP's
 * `[{ identifier, title }]` array) and this reads it. No file, no `repo` — the cockpit asks.
 */

import { join, basename, relative } from "node:path";
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

export const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const REPORTS = join(ROOT, "reports");
const POINTS = join(REPORTS, "points.json");
const DECISIONS = join(ROOT, "decisions");
const TITLES = join(ROOT, ".state/linear-titles.json");
const MANIFEST = join(ROOT, "alden/alden-portal/.doc-workspace/feature-manifest.json");

export type Group = "decide" | "verify" | "confirm" | "hold" | "housekeeping";
export type Decision = {
  point: string;
  action: "sent" | "ignored";
  reason?: string;
  at?: string;
  subject?: string;
  job?: { id: string; url: string };
  [extra: string]: unknown;
};
export type Point = {
  id: string;
  group: Group;
  subject: string;
  ask: string;
  detail?: string;
  firstSeen: string;
  ticket?: string;
  repo?: string;
  features?: string[];
  /** the cockpit's verdict, copied from its `decisions/` file — present means: not in the report */
  decision?: Decision;
};
export type PointsFile = { tick: string; date: string; points: Point[] };

const GROUPS: Record<string, Group> = {
  Decide: "decide",
  Verify: "verify",
  "Confirm with someone": "confirm",
  "On hold": "hold",
  Housekeeping: "housekeeping",
};
const REPOS: Record<string, string> = { FE: "alden-portal-fe", BE: "alden-connect-portal-be" };
const AGE_RE = / · (new|\d+d)$/;
const DECIDED_LINE_RE = /^- \d+ points? decided \(decisions\/\)\s*$/;
const UNREADABLE_HEADER = "**Unreadable decision files**";
const TICKET_RE = /\bLIA-\d+\b/g;

export const slug = (subject: string) =>
  subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `YYYY-MM-DD` of a Date, in local time (the day the report is named after). */
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
export const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000);
export const ageOf = (firstSeen: string, day: string) => {
  const n = daysBetween(firstSeen, day);
  return n <= 0 ? "new" : `${n}d`;
};

// ---------------------------------------------------------------- parse

/** One report bullet, before ids and ages are resolved. `line` is its index in the file. */
export type Item = {
  group: Group;
  subject: string;
  ask: string;
  detail?: string;
  /** the age the line carried, if any — the bootstrap for firstSeen */
  age?: string;
  line: number;
  /** index of the bullet's last line (its detail line when it has one) */
  end: number;
};

const splitAge = (text: string): [string, string | undefined] => {
  const m = text.match(AGE_RE);
  return m ? [text.slice(0, -m[0].length), m[1]] : [text, undefined];
};

/** Needs-you bullets of a report, in file order. Everything outside `## Needs you` is ignored. */
export function parseNeedsYou(md: string): Item[] {
  const lines = md.split("\n");
  const items: Item[] = [];
  let inSection = false;
  let group: Group | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) {
      inSection = /^## Needs you\b/.test(line);
      group = null;
      continue;
    }
    if (!inSection) continue;

    const header = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (header) {
      group = GROUPS[header[1]!] ?? null;
      continue;
    }
    if (!group) continue;

    if (DECIDED_LINE_RE.test(line)) continue; // the count points.ts writes, never a point
    if (line.startsWith("- ")) {
      const [body, age] = splitAge(line.slice(2).trim());
      items.push({ group, ...split(group, body), age, line: i, end: i });
    } else if (/^\s+\S/.test(line) && items.length && items[items.length - 1]!.group === group) {
      const last = items[items.length - 1]!;
      last.detail = last.detail ? `${last.detail} ${line.trim()}` : line.trim();
      last.end = i;
    }
  }
  return items;
}

/** subject / ask for one bullet body (age already stripped). */
function split(group: Group, body: string): { subject: string; ask: string } {
  const bold = body.match(/^\*\*(.+)\*\* — (.*)$/) ?? body.match(/^\*\*(.+)\*\*\s*(.*)$/);
  if (bold) return { subject: bold[1]!.trim(), ask: bold[2]!.trim() || bold[1]!.trim() };
  if (group === "hold") {
    const arrow = body.match(/^(.+?) → (.+)$/);
    if (arrow) return { subject: arrow[1]!.trim(), ask: arrow[2]!.trim() };
  }
  const dash = body.match(/^(.+?) — (.+)$/);
  if (dash) return { subject: dash[1]!.trim(), ask: dash[2]!.trim() };
  return { subject: body.trim(), ask: body.trim() };
}

// ---------------------------------------------------------------- derive

export type Titles = Record<string, string>;

/** Accepts `{ "LIA-86": "[FE] …" }` or the Linear MCP's `[{ identifier, title }]`. */
export function normaliseTitles(raw: unknown): Titles {
  if (Array.isArray(raw)) {
    const out: Titles = {};
    for (const r of raw) {
      const key = r?.identifier ?? r?.id ?? r?.key;
      if (typeof key === "string" && typeof r?.title === "string") out[key] = r.title;
    }
    return out;
  }
  return raw && typeof raw === "object" ? (raw as Titles) : {};
}

export function ticketOf(item: Item): string | undefined {
  const keys = new Set(`${item.subject} ${item.detail ?? ""}`.match(TICKET_RE) ?? []);
  return keys.size === 1 ? [...keys][0] : undefined;
}

/** `[FE]` → alden-portal-fe, `[BE]` → alden-connect-portal-be; both or neither → undefined. */
export function repoOf(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const tags = new Set([...title.matchAll(/\[(FE|BE)\]/g)].map((m) => m[1]!));
  return tags.size === 1 ? REPOS[[...tags][0]!] : undefined;
}

/**
 * Feature ids the item names. Hyphenated ids match as plain words; the one-word ids
 * (`admin`, `tasks`, `auth`…) are ordinary English and only count inside backticks.
 */
export function featuresOf(item: Item, ids: string[]): string[] | undefined {
  const text = `${item.subject} ${item.ask} ${item.detail ?? ""}`;
  const found = ids.filter((id) =>
    id.includes("-") ? new RegExp(`(^|[^a-z0-9-])${id}(?![a-z0-9-])`, "i").test(text) : text.includes(`\`${id}\``),
  );
  return found.length ? found : undefined;
}

export type Derive = {
  day: string;
  tick: string;
  previous: PointsFile | null;
  titles: Titles;
  featureIds: string[];
  /** oldest reports/*.md naming the subject — the bootstrap when nothing else knows the age */
  oldestReportNaming: (subject: string) => string | undefined;
  /** readable `decisions/` files, by their `point` id */
  decisions?: Map<string, Decision>;
};

export function derive(items: Item[], d: Derive): PointsFile {
  const prev = new Map((d.previous?.points ?? []).map((p) => [p.id, p]));
  const points = items.map((item) => {
    const id = `${item.group}/${slug(item.subject)}`;
    const firstSeen =
      prev.get(id)?.firstSeen ??
      (item.age === "new" ? d.day : item.age ? addDays(d.day, -parseInt(item.age, 10)) : undefined) ??
      d.oldestReportNaming(item.subject) ??
      d.day;
    const ticket = ticketOf(item);
    const point: Point = { id, group: item.group, subject: item.subject, ask: item.ask, firstSeen };
    if (item.detail) {
      delete (point as Partial<Point>).firstSeen;
      point.detail = item.detail;
      point.firstSeen = firstSeen; // key order matches the ticket's suggested shape
    }
    if (ticket) point.ticket = ticket;
    const repo = repoOf(d.titles[ticket ?? ""]);
    if (repo) point.repo = repo;
    const features = featuresOf(item, d.featureIds);
    if (features) point.features = features;
    const decision = d.decisions?.get(id);
    if (decision) point.decision = decision;
    return point;
  });
  return { tick: d.tick, date: d.day, points };
}

/**
 * The report with every Decide / Verify / Confirm line's ` · <age>` suffix made to agree
 * with firstSeen. Hold and Housekeeping lines are left alone unless they already carry one.
 */
export function syncAges(md: string, items: Item[], file: PointsFile): string {
  const lines = md.split("\n");
  items.forEach((item, i) => {
    const point = file.points[i]!;
    const [body, age] = splitAge(lines[item.line]!.replace(/\s+$/, ""));
    const wanted = ageOf(point.firstSeen, file.date);
    if (age === undefined && (item.group === "hold" || item.group === "housekeeping")) return;
    if (age !== wanted) lines[item.line] = `${body} · ${wanted}`;
  });
  return lines.join("\n");
}

/** `_Tick HH:MM …_` of the report as an ISO timestamp on the report's day; else now. */
export function tickOf(md: string, day: string): string {
  const m = md.match(/^_Tick (\d\d):(\d\d)/m);
  return m ? new Date(`${day}T${m[1]}:${m[2]}:00`).toISOString() : new Date().toISOString();
}

// ---------------------------------------------------------------- decisions

export type Unreadable = { file: string; error: string };

/** One decision file's text → the decision, or the one reason it cannot be used. */
export function parseDecision(text: string): { decision: Decision } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON: ${(err as Error).message}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not a JSON object" };
  const d = raw as Record<string, unknown>;
  if (typeof d.point !== "string" || !d.point) return { error: "`point` missing or not a string" };
  if (d.action !== "sent" && d.action !== "ignored") return { error: '`action` must be "sent" or "ignored"' };
  if (d.action === "ignored" && (typeof d.reason !== "string" || !d.reason.trim()))
    return { error: "`reason` required for an ignored point" };
  return { decision: d as Decision };
}

/**
 * Every `decisions/**\/*.json`, keyed by its `point`. Two files for one point: the later
 * `at` wins. Files that fail `parseDecision` come back separately, for Audit.
 */
export async function readDecisions(dir = DECISIONS): Promise<{ decisions: Map<string, Decision>; unreadable: Unreadable[] }> {
  const decisions = new Map<string, Decision>();
  const unreadable: Unreadable[] = [];
  let names: string[];
  try {
    names = (await readdir(dir, { recursive: true })) as string[];
  } catch {
    return { decisions, unreadable };
  }
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const path = join(dir, name);
    const file = path.startsWith(`${ROOT}/`) ? relative(ROOT, path) : path;
    const parsed = parseDecision(await Bun.file(path).text());
    if ("error" in parsed) {
      unreadable.push({ file, error: parsed.error });
      continue;
    }
    const prev = decisions.get(parsed.decision.point);
    if (!prev || String(parsed.decision.at ?? "") >= String(prev.at ?? "")) decisions.set(parsed.decision.point, parsed.decision);
  }
  return { decisions, unreadable };
}

/** `[start, end)` line range of the `## <heading>` section, or null. */
function section(lines: string[], heading: RegExp): [number, number] | null {
  const start = lines.findIndex((l) => l.startsWith("## ") && heading.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith("## ")) end++;
  return [start, end];
}

/** Drop trailing blank lines before `end` so a section ends with exactly one. */
const trimBlank = (lines: string[], end: number) => {
  while (end > 0 && lines[end - 1]!.trim() === "") end--;
  return end;
};

/**
 * The report without the two lines this script owns — the Housekeeping count and the
 * Audit block for unreadable files — so they can be rewritten from this run's state.
 */
export function stripOwned(md: string): string {
  const lines = md.split("\n").filter((l) => !DECIDED_LINE_RE.test(l));
  const i = lines.indexOf(UNREADABLE_HEADER);
  if (i !== -1) {
    let j = i + 1;
    while (j < lines.length && lines[j]!.startsWith("- ")) j++;
    while (j < lines.length && lines[j]!.trim() === "" && !(j + 1 < lines.length && lines[j + 1]!.startsWith("## "))) j++;
    lines.splice(i, j - i);
  }
  return lines.join("\n");
}

/**
 * The report with every decided point's bullet removed (empty groups with it), the
 * Housekeeping count added when any point is decided, and unreadable decision files
 * listed under Audit. `items` and `file` are index-aligned, as `derive` leaves them.
 */
export function applyDecisions(md: string, items: Item[], file: PointsFile, unreadable: Unreadable[] = []): string {
  let lines = md.split("\n");
  const decided = file.points.filter((p) => p.decision).length;

  // 1. drop decided bullets, highest line first so earlier indexes stay valid
  const drop = items
    .filter((_, i) => file.points[i]!.decision)
    .sort((a, b) => b.line - a.line);
  for (const item of drop) lines.splice(item.line, item.end - item.line + 1);

  // 2. drop Needs-you group headers left with no bullet
  const needs = section(lines, /^## Needs you\b/);
  if (needs) {
    const [start, end] = needs;
    const keep: string[] = [];
    for (let i = start; i < end; i++) {
      const line = lines[i]!;
      if (/^\*\*(.+?)\*\*\s*$/.test(line)) {
        let j = i + 1;
        while (j < end && lines[j]!.trim() === "") j++;
        if (j >= end || !lines[j]!.startsWith("- ")) {
          i = j - 1; // header and its blank run go
          continue;
        }
      }
      keep.push(line);
    }
    lines.splice(start, end - start, ...keep);
  }

  // 3. Housekeeping count
  if (decided) {
    const line = `- ${decided} point${decided === 1 ? "" : "s"} decided (decisions/)`;
    const needs2 = section(lines, /^## Needs you\b/);
    if (needs2) {
      const [start, end] = needs2;
      const header = lines.slice(start, end).findIndex((l) => l === "**Housekeeping**");
      if (header !== -1) {
        let j = start + header + 1;
        while (j < end && lines[j]!.startsWith("- ")) j++;
        lines.splice(j, 0, line);
      } else {
        const at = trimBlank(lines, end);
        lines.splice(at, end - at, "", "**Housekeeping**", line, "");
      }
    } else {
      lines.push("", "## Needs you", "", "**Housekeeping**", line, "");
    }
  }

  // 4. Audit: unreadable decision files
  if (unreadable.length) {
    const block = [UNREADABLE_HEADER, ...unreadable.map((u) => `- \`${u.file}\` — ${u.error}`)];
    const audit = section(lines, /^## Audit\b/);
    if (audit) {
      const at = trimBlank(lines, audit[1]);
      lines.splice(at, audit[1] - at, "", ...block, "");
    } else {
      lines = [...lines.slice(0, trimBlank(lines, lines.length)), "", "## Audit", "", ...block, ""];
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------- run

export async function run(opts: { report?: string; titles?: string; decisions?: string; dryRun?: boolean } = {}) {
  const reportPath = opts.report ?? join(REPORTS, `${isoDay(new Date())}.md`);
  const day = basename(reportPath, ".md");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`report must be reports/YYYY-MM-DD.md, got ${reportPath}`);
  const reportFile = Bun.file(reportPath);
  if (!(await reportFile.exists())) throw new Error(`no report at ${reportPath}`);
  const md = stripOwned(await reportFile.text());

  const { decisions, unreadable } = await readDecisions(opts.decisions ?? DECISIONS);
  const previous = (await Bun.file(POINTS).exists()) ? ((await Bun.file(POINTS).json()) as PointsFile) : null;
  const titlesPath = opts.titles ?? TITLES;
  const titles = (await Bun.file(titlesPath).exists()) ? normaliseTitles(await Bun.file(titlesPath).json()) : {};
  const featureIds = (await Bun.file(MANIFEST).exists())
    ? ((await Bun.file(MANIFEST).json()).features as { id: string }[]).map((f) => f.id)
    : [];

  const reports = (await readdir(REPORTS)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  const texts = new Map<string, string>();
  const oldestReportNaming = (subject: string) => {
    const needle = subject.toLowerCase();
    for (const f of reports) {
      if (!texts.has(f)) texts.set(f, readFileSync(join(REPORTS, f), "utf8").toLowerCase());
      if (texts.get(f)!.includes(needle)) return f.slice(0, -3);
    }
    return undefined;
  };

  const items = parseNeedsYou(md);
  const file = derive(items, { day, tick: tickOf(md, day), previous, titles, featureIds, oldestReportNaming, decisions });
  const synced = applyDecisions(syncAges(md, items, file), items, file, unreadable);
  const original = await reportFile.text();

  if (!opts.dryRun) {
    await Bun.write(POINTS, JSON.stringify(file, null, 2) + "\n");
    if (synced !== original) await Bun.write(reportPath, synced);
  }
  return {
    file,
    reportChanged: synced !== original,
    titlesLoaded: Object.keys(titles).length > 0,
    decided: file.points.filter((p) => p.decision).length,
    unreadable,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args.splice(i, 2)[1];
  };
  const titles = flag("--titles");
  const decisions = flag("--decisions");
  const dryRun = args.includes("--dry-run");
  const report = args.filter((a) => !a.startsWith("--"))[0];

  try {
    const { file, reportChanged, titlesLoaded, decided, unreadable } = await run({ report, titles, decisions, dryRun });
    if (dryRun) console.log(JSON.stringify(file, null, 2));
    const withRepo = file.points.filter((p) => p.repo).length;
    console.error(
      `points: ${file.points.length} for ${file.date} → ${dryRun ? "(dry run)" : "reports/points.json"}` +
        `${reportChanged ? " · report rewritten (ages / decisions)" : ""}` +
        `${titlesLoaded ? ` · repo on ${withRepo}` : " · no .state/linear-titles.json, repo left absent"}` +
        `${decided ? ` · ${decided} decided` : ""}` +
        `${unreadable.length ? ` · ${unreadable.length} unreadable decision file(s), see Audit` : ""}`,
    );
  } catch (err) {
    console.error(`points: ${(err as Error).message}`);
    process.exit(1);
  }
}
