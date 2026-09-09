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
 * A third verdict, `verified` (LIA-114), is the user's confirmation of a point's inference:
 * it drops the point like the other two, and `--verified` lists those points so the tick's
 * ticket pass and docs dispatch can make the one edit each of them named.
 *
 *   bun skills/sweep/scripts/points.ts                     today's report → reports/points.json
 *   bun skills/sweep/scripts/points.ts reports/2026-09-04.md
 *   bun skills/sweep/scripts/points.ts --dry-run           print, write nothing
 *   bun skills/sweep/scripts/points.ts --titles <file>     Linear titles, for `repo` (see below)
 *   bun skills/sweep/scripts/points.ts --decisions <dir>   read decisions from <dir> (default decisions/)
 *   bun skills/sweep/scripts/points.ts --verified          the verified points, for the tick's workers
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
 * One decision group is not a verdict on a point and never joins them: `decisions/arc/`,
 * which opens and closes an arc — the running story of an initiative (LIA-145).
 * `readDecisions` skips it whole and `readArcDecisions` reads it, for
 * `skills/sweep/scripts/arcs.ts`; a malformed one is still an Audit line.
 *
 * `arc` is the initiative the point belongs to (LIA-148). The sweep writes the arc's
 * **title** on the card, after the age (`· 3d · Invoice emails`), because that is what a
 * reader wants to see; `points.json` carries the arc's **slug**, because that is what the
 * cockpit can group by. The map between them is the `arcs/*.md` frontmatter the arc step
 * wrote earlier in the same tick, read the way `.state/linear-titles.json` is read for
 * `repo`: a tag no arc file claims yields no `arc` and one terminal line, never a guessed
 * slug. The tag is a suffix and nothing else — the point's id, `firstSeen` and age are
 * computed from the line with it stripped, so tagging a point does not restart it.
 *
 * `ticket` is the LIA key when the subject or detail names exactly one. `repo` needs the
 * ticket's Linear project (one per repo: Argus, Pensieve, Foundry) and, inside Alden Portal
 * — the one project covering two repos — its title tag (`[FE]` / `[BE]`). Both live in
 * Linear: the sweep drops its step-3 open-ticket list at `.state/linear-titles.json`
 * (`{ "LIA-86": { "title": "[FE] …", "project": "Alden Portal" } }`, the older title-only
 * `{ "LIA-86": "[FE] …" }`, or the MCP's `[{ identifier, title, project }]` array) and this
 * reads it (LIA-121). No file, or a project the map does not name, no `repo` — the cockpit
 * asks; a guessed repo would be worse than none.
 */

import { join, basename, relative } from "node:path";
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

export const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const REPORTS = join(ROOT, "reports");
const POINTS = join(REPORTS, "points.json");
const DECISIONS = join(ROOT, "decisions");
/** the one decision group that is not a verdict on a point — `decisions/arc/<slug>.json` (LIA-145) */
export const ARC_GROUP = "arc";
/** nor is this one — `decisions/marauder/<slug>.json`, which `marauder ingest` applies (LIA-160) */
export const MARAUDER_GROUP = "marauder";
const TITLES = join(ROOT, ".state/linear-titles.json");
const MANIFEST = join(ROOT, "alden/alden-portal/.doc-workspace/feature-manifest.json");

export type Group = "decide" | "verify" | "confirm" | "hold" | "housekeeping";
export type Decision = {
  point: string;
  action: "sent" | "ignored" | "verified";
  reason?: string;
  at?: string;
  subject?: string;
  job?: { id: string; url: string };
  [extra: string]: unknown;
};
/**
 * `decisions/arc/<slug>.json` — the user's verdict that an initiative is worth a running
 * story, or that its story is over (LIA-145). It travels as a decision file like every
 * other verdict, but it is not a verdict on a Needs-you point, so it never joins the
 * points: `readDecisions` leaves `arc/` alone and `readArcDecisions` reads it. The
 * `marauder/` group is skipped the same way — Pensieve writes those on an unsorted entry
 * and `marauder ingest` applies them, so a point audit that read them would report every
 * one as a file it could not parse (LIA-160).
 */
export type ArcDecision = {
  /** `arc/<slug>` — the slug is the arc's file name under `arcs/` */
  point: string;
  slug: string;
  action: "opened" | "closed";
  subject?: string;
  reason?: string;
  at?: string;
  seeds: ArcSeeds;
  [extra: string]: unknown;
};
/** the keys an item is filed against an arc by — never a resemblance, always one of these */
export type ArcSeeds = { tickets: string[]; rules: string[]; prs: string[]; features: string[] };
export const SEED_KINDS = ["tickets", "rules", "prs", "features"] as const;
export const emptySeeds = (): ArcSeeds => ({ tickets: [], rules: [], prs: [], features: [] });

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
  /** the slug of the arc whose story this point is part of (LIA-148) — absent when it is in none */
  arc?: string;
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
/**
 * Linear project → the basename of the checkout Foundry tracks (its `resolveRepo` takes a
 * basename when unique). Explicit on purpose: a project name is not a repo name in
 * general, and a project missing here yields no `repo` rather than a guess.
 */
const PROJECT_REPOS: Record<string, string> = { Argus: "argus", Pensieve: "pensieve", Foundry: "foundry" };
/** The one project that covers two repos; its tickets say which in a `[FE]` / `[BE]` title tag. */
const TAGGED_PROJECT = "Alden Portal";
const TAG_REPOS: Record<string, string> = { FE: "alden-portal-fe", BE: "alden-connect-portal-be" };
/**
 * The headline's machine-read tail: ` · <age>`, and since LIA-148 an optional ` · <arc
 * title>` after it. `[^·]+` keeps the arc tag to one segment, so a card with neither
 * suffix, or with the age alone, parses exactly as it did before.
 */
const AGE_RE = / · (new|\d+d)(?: · ([^·]+))?$/;
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
  /** the arc **title** the line carried, if any (LIA-148); `derive` turns it into a slug */
  arc?: string;
  line: number;
  /** index of the bullet's last line (its detail line when it has one) */
  end: number;
};

/** a headline body → `[body, age, arc title]`, the two suffixes stripped off the front part */
const splitAge = (text: string): [string, string | undefined, string | undefined] => {
  const m = text.match(AGE_RE);
  return m ? [text.slice(0, -m[0].length), m[1], m[2]?.trim() || undefined] : [text, undefined, undefined];
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
      const [body, age, arc] = splitAge(line.slice(2).trim());
      items.push({ group, ...split(group, body), age, arc, line: i, end: i });
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

export type TitleEntry = { title: string; project?: string };
export type Titles = Record<string, TitleEntry>;

/** The MCP gives `project` as a name; a richer `fields`, or a hand-written file, may give `{ name }`. */
function projectName(project: unknown): string | undefined {
  if (typeof project === "string") return project || undefined;
  const name = (project as { name?: unknown } | null)?.name;
  return typeof name === "string" && name ? name : undefined;
}

/**
 * Accepts the map `{ "LIA-86": { title, project } }`, the older title-only map
 * `{ "LIA-86": "[FE] …" }`, or the Linear MCP's `[{ identifier, title, project }]` array —
 * `project` optional in every shape, so a file written before LIA-121 still loads.
 */
export function normaliseTitles(raw: unknown): Titles {
  const out: Titles = {};
  const add = (key: unknown, title: unknown, project: unknown) => {
    if (typeof key !== "string" || typeof title !== "string") return;
    const name = projectName(project);
    out[key] = name ? { title, project: name } : { title };
  };
  if (Array.isArray(raw)) {
    for (const r of raw) add(r?.identifier ?? r?.id ?? r?.key, r?.title, r?.project);
  } else if (raw && typeof raw === "object") {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") add(key, v, undefined);
      else add(key, (v as { title?: unknown })?.title, (v as { project?: unknown })?.project);
    }
  }
  return out;
}

export function ticketOf(item: Item): string | undefined {
  const keys = new Set(`${item.subject} ${item.detail ?? ""}`.match(TICKET_RE) ?? []);
  return keys.size === 1 ? [...keys][0] : undefined;
}

/**
 * The repo a ticket's point should carry, from its project first — Argus → `argus`,
 * Pensieve → `pensieve`, Foundry → `foundry` — and from the title tag only inside Alden
 * Portal: `[FE]` → alden-portal-fe, `[BE]` → alden-connect-portal-be, both or neither →
 * undefined. No project (a title-only file) reads as Alden Portal, so the tags still
 * resolve; a project the map does not name yields nothing, whatever the title says.
 */
export function repoOf(title: string | undefined, project?: string): string | undefined {
  if (project !== undefined && project !== TAGGED_PROJECT) return PROJECT_REPOS[project];
  if (!title) return undefined;
  const tags = new Set([...title.matchAll(/\[(FE|BE)\]/g)].map((m) => m[1]!));
  return tags.size === 1 ? TAG_REPOS[[...tags][0]!] : undefined;
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

/** title → slug for every `arcs/*.md`, both keys normalised through `slug` so a tag matches by shape */
export type Arcs = Record<string, string>;

/**
 * The arc titles the sweep may tag a card with, as `slug(title)` → slug (LIA-148). Both
 * the title and the slug are keys, so a sweep that wrote the slug instead of the title
 * still resolves. Frontmatter only: this must not depend on `arcs.ts`, which imports this
 * module.
 */
export function arcTitles(files: { name: string; text: string }[]): Arcs {
  const out: Arcs = {};
  for (const { name, text } of files) {
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
    if (!fm) continue;
    const field = (k: string) => fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"))?.[1]?.trim();
    const id = field("slug") || name.replace(/\.md$/, "");
    const title = field("title");
    out[id] = id;
    if (title) out[slug(title)] = id;
  }
  return out;
}

/** every `arcs/*.md` under `root`, as `arcTitles` wants them; no directory is an empty map */
export async function readArcTitles(root = ROOT): Promise<Arcs> {
  const dir = join(root, "arcs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return {};
  }
  const files = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort())
    files.push({ name, text: await Bun.file(join(dir, name)).text() });
  return arcTitles(files);
}

/**
 * The slug of the arc a card's tag names, or undefined when no arc file claims it. Never a
 * guess: an unmapped tag is this tick's drift between the arc step and the report, and the
 * run line says so — a made-up slug would group the cockpit's Points page by a fiction.
 */
export const arcOf = (tag: string | undefined, arcs: Arcs): string | undefined => (tag ? arcs[slug(tag)] : undefined);

export type Derive = {
  day: string;
  tick: string;
  previous: PointsFile | null;
  titles: Titles;
  featureIds: string[];
  /** `arcs/*.md` title → slug; absent (or empty) leaves every tagged point without an `arc` */
  arcs?: Arcs;
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
    const entry = ticket ? d.titles[ticket] : undefined;
    const repo = repoOf(entry?.title, entry?.project);
    if (repo) point.repo = repo;
    const features = featuresOf(item, d.featureIds);
    if (features) point.features = features;
    const arc = arcOf(item.arc, d.arcs ?? {});
    if (arc) point.arc = arc;
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
    const [body, age, arc] = splitAge(lines[item.line]!.replace(/\s+$/, ""));
    const wanted = ageOf(point.firstSeen, file.date);
    if (age === undefined && (item.group === "hold" || item.group === "housekeeping")) return;
    // the arc tag sits after the age, so rewriting the age must carry it across (LIA-148)
    if (age !== wanted) lines[item.line] = `${body} · ${wanted}${arc ? ` · ${arc}` : ""}`;
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
  if (d.action !== "sent" && d.action !== "ignored" && d.action !== "verified")
    return { error: '`action` must be "sent", "ignored" or "verified"' };
  if (d.action === "ignored" && (typeof d.reason !== "string" || !d.reason.trim()))
    return { error: "`reason` required for an ignored point" };
  return { decision: d as Decision };
}

/**
 * One `decisions/arc/<slug>.json` → the arc verdict, or the one reason it cannot be used.
 * `seeds` is required on `opened` (an arc with no keys files nothing) and ignored on
 * `closed`, which only flips the status of an arc that already exists.
 */
export function parseArcDecision(text: string): { decision: ArcDecision } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON: ${(err as Error).message}` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "not a JSON object" };
  const d = raw as Record<string, unknown>;
  if (typeof d.point !== "string" || !d.point.startsWith("arc/") || d.point.length <= 4)
    return { error: "`point` must be `arc/<slug>`" };
  if (d.action !== "opened" && d.action !== "closed") return { error: '`action` must be "opened" or "closed"' };
  const seeds = emptySeeds();
  if (d.seeds !== undefined) {
    if (!d.seeds || typeof d.seeds !== "object" || Array.isArray(d.seeds)) return { error: "`seeds` must be an object of string arrays" };
    for (const [kind, value] of Object.entries(d.seeds as Record<string, unknown>)) {
      if (!SEED_KINDS.includes(kind as (typeof SEED_KINDS)[number]))
        return { error: `\`seeds.${kind}\` is not a seed kind (${SEED_KINDS.join(", ")})` };
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim()))
        return { error: `\`seeds.${kind}\` must be an array of non-empty strings` };
      seeds[kind as keyof ArcSeeds] = [...new Set((value as string[]).map((v) => v.trim()))];
    }
  }
  if (d.action === "opened" && !SEED_KINDS.some((k) => seeds[k].length))
    return { error: "`seeds` required for an opened arc — an arc with no keys files nothing" };
  return { decision: { ...(d as Record<string, unknown>), point: d.point, slug: d.point.slice(4), action: d.action, seeds } as ArcDecision };
}

/** Every arc named by a `decisions/arc/*.json`, its `opened` and `closed` files kept apart. */
export type ArcVerdicts = { slug: string; opened?: ArcDecision; closed?: ArcDecision };

/**
 * `decisions/arc/**\/*.json` by slug — the arc group alone, read by the sweep's arc step
 * and by nothing in the points join (AC4). Two files for one slug and action: the later
 * `at` wins, as everywhere else. Files that fail `parseArcDecision` come back for Audit.
 */
export async function readArcDecisions(dir = DECISIONS): Promise<{ arcs: ArcVerdicts[]; unreadable: Unreadable[] }> {
  const by = new Map<string, ArcVerdicts>();
  const unreadable: Unreadable[] = [];
  for (const { file, text } of await decisionFiles(dir, (n) => n.startsWith(`${ARC_GROUP}/`))) {
    const parsed = parseArcDecision(text);
    if ("error" in parsed) {
      unreadable.push({ file, error: parsed.error });
      continue;
    }
    const arc = by.get(parsed.decision.slug) ?? { slug: parsed.decision.slug };
    const prev = arc[parsed.decision.action];
    if (!prev || String(parsed.decision.at ?? "") >= String(prev.at ?? "")) arc[parsed.decision.action] = parsed.decision;
    by.set(arc.slug, arc);
  }
  return { arcs: [...by.values()].sort((a, b) => a.slug.localeCompare(b.slug)), unreadable };
}

/** every `<dir>/**\/*.json` the filter keeps, sorted by name, read as text */
async function decisionFiles(dir: string, keep: (name: string) => boolean) {
  let names: string[];
  try {
    names = (await readdir(dir, { recursive: true })) as string[];
  } catch {
    return [];
  }
  const out: { file: string; text: string }[] = [];
  for (const name of names.filter((n) => n.endsWith(".json") && keep(n)).sort()) {
    const path = join(dir, name);
    out.push({ file: path.startsWith(`${ROOT}/`) ? relative(ROOT, path) : path, text: await Bun.file(path).text() });
  }
  return out;
}

/**
 * Every `decisions/**\/*.json`, keyed by its `point`. Two files for one point: the later
 * `at` wins. Files that fail `parseDecision` come back separately, for Audit. The `arc/`
 * group is skipped whole — an arc is not a verdict on a point, so it must never land on
 * one, nor in the Housekeeping count (LIA-145); `readArcDecisions` is its reader.
 */
export async function readDecisions(dir = DECISIONS): Promise<{ decisions: Map<string, Decision>; unreadable: Unreadable[] }> {
  const decisions = new Map<string, Decision>();
  const unreadable: Unreadable[] = [];
  const notAPoint = (n: string) => n.startsWith(`${ARC_GROUP}/`) || n.startsWith(`${MARAUDER_GROUP}/`);
  for (const { file, text } of await decisionFiles(dir, (n) => !notAPoint(n))) {
    const parsed = parseDecision(text);
    if ("error" in parsed) {
      unreadable.push({ file, error: parsed.error });
      continue;
    }
    const prev = decisions.get(parsed.decision.point);
    if (!prev || String(parsed.decision.at ?? "") >= String(prev.at ?? "")) decisions.set(parsed.decision.point, parsed.decision);
  }
  return { decisions, unreadable };
}

/**
 * The points in `file` the cockpit has marked `verified` — the sweep's licensed edits for
 * this tick (LIA-114). A verified point is the user's confirmation of that point's own
 * inference, so its `ask` and `detail` are the instruction; there is no separate field.
 *
 * The join is against `points.json`, not against `decisions/` alone, and that is what
 * bounds it: the same tick's step 9 drops the point's bullet from the report, so the next
 * tick's `points.json` no longer holds the record and this returns nothing for it. The
 * worker's compare-before-editing is the backstop for a tick that died in between.
 */
export function verifiedPoints(file: PointsFile, decisions: Map<string, Decision>): Point[] {
  return file.points.flatMap((p) => {
    const decision = decisions.get(p.id);
    return decision?.action === "verified" ? [{ ...p, decision }] : [];
  });
}

/** `verifiedPoints` as the block a sweep pastes into the `ticket-pass` brief. */
export function formatVerified(points: Point[]): string {
  return points
    .map((p) => {
      const lines = [`${p.id} — ${p.subject} — ${p.ask}`];
      if (p.detail) lines.push(`  ${p.detail}`);
      const fields: string[] = [];
      if (p.ticket) fields.push(`ticket: ${p.ticket}`);
      if (p.features?.length) fields.push(`features: ${p.features.join(", ")}`);
      if (p.decision?.reason) fields.push(`reason: ${p.decision.reason}`);
      if (fields.length) lines.push(`  ${fields.join(" · ")}`);
      return lines.join("\n");
    })
    .join("\n");
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

  const decisionsDir = opts.decisions ?? DECISIONS;
  const { decisions, unreadable: badPoints } = await readDecisions(decisionsDir);
  // arc files never decide a point, but a malformed one is still a file the blackboard
  // cannot read, so it earns the same Audit line (LIA-145)
  const { unreadable: badArcs } = await readArcDecisions(decisionsDir);
  const unreadable = [...badPoints, ...badArcs].sort((a, b) => a.file.localeCompare(b.file));
  const previous = (await Bun.file(POINTS).exists()) ? ((await Bun.file(POINTS).json()) as PointsFile) : null;
  const titlesPath = opts.titles ?? TITLES;
  const titles = (await Bun.file(titlesPath).exists()) ? normaliseTitles(await Bun.file(titlesPath).json()) : {};
  const featureIds = (await Bun.file(MANIFEST).exists())
    ? ((await Bun.file(MANIFEST).json()).features as { id: string }[]).map((f) => f.id)
    : [];
  // the arc step (SKILL.md step 7) ran earlier in this same tick, so `arcs/*.md` is current
  const arcs = await readArcTitles();

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
  const file = derive(items, { day, tick: tickOf(md, day), previous, titles, featureIds, arcs, oldestReportNaming, decisions });
  const synced = applyDecisions(syncAges(md, items, file), items, file, unreadable);
  const original = await reportFile.text();

  if (!opts.dryRun) {
    await Bun.write(POINTS, JSON.stringify(file, null, 2) + "\n");
    if (synced !== original) await Bun.write(reportPath, synced);
  }
  return {
    file,
    reportChanged: synced !== original,
    /** arc tags on cards that no `arcs/*.md` claims — the tick's drift, not the script's (LIA-148) */
    unmappedArcs: [...new Set(items.flatMap((i) => (i.arc && !arcOf(i.arc, arcs) ? [i.arc] : [])))],
    titlesLoaded: Object.keys(titles).length > 0,
    /** false when the titles file is the pre-LIA-121 title-only shape: only `[FE]` / `[BE]` can resolve */
    titlesCarryProject: Object.values(titles).some((t) => t.project !== undefined),
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
  const decisionsDir = flag("--decisions");
  const dryRun = args.includes("--dry-run");
  const report = args.filter((a) => !a.startsWith("--"))[0];

  // --verified reads points.json and decisions/ only: it runs before the tick has written
  // today's report, so it must not go through `run`, which requires one.
  if (args.includes("--verified")) {
    try {
      if (!(await Bun.file(POINTS).exists())) throw new Error(`no ${relative(ROOT, POINTS)} yet — run a tick first`);
      const file = (await Bun.file(POINTS).json()) as PointsFile;
      const { decisions } = await readDecisions(decisionsDir ?? DECISIONS);
      const points = verifiedPoints(file, decisions);
      if (points.length) console.log(formatVerified(points));
      console.error(`points: ${points.length} verified of ${file.points.length} for ${file.date}`);
    } catch (err) {
      console.error(`points: ${(err as Error).message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  try {
    const opts = { report, titles, decisions: decisionsDir, dryRun };
    const { file, reportChanged, titlesLoaded, titlesCarryProject, decided, unreadable, unmappedArcs } = await run(opts);
    if (dryRun) console.log(JSON.stringify(file, null, 2));
    const withRepo = file.points.filter((p) => p.repo).length;
    const withTicket = file.points.filter((p) => p.ticket).length;
    const repoLine = !titlesLoaded
      ? " · no .state/linear-titles.json, repo left absent"
      : ` · repo on ${withRepo} of ${withTicket} with a ticket` +
        (titlesCarryProject ? "" : " (titles carry no project — only [FE]/[BE] resolve; step 3 should write it)");
    console.error(
      `points: ${file.points.length} for ${file.date} → ${dryRun ? "(dry run)" : "reports/points.json"}` +
        `${reportChanged ? " · report rewritten (ages / decisions)" : ""}` +
        repoLine +
        `${decided ? ` · ${decided} decided` : ""}` +
        `${file.points.filter((p) => p.arc).length ? ` · arc on ${file.points.filter((p) => p.arc).length}` : ""}` +
        `${unmappedArcs.length ? ` · no arcs/*.md for ${unmappedArcs.map((a) => `"${a}"`).join(", ")} — the report tagged an arc that does not exist` : ""}` +
        `${unreadable.length ? ` · ${unreadable.length} unreadable decision file(s), see Audit` : ""}`,
    );
  } catch (err) {
    console.error(`points: ${(err as Error).message}`);
    process.exit(1);
  }
}
