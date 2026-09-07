/**
 * The blackboard reader. The argus loop owns every file under WORKSPACE_DIR except
 * `decisions/` (see ./decisions.ts, the one writer); this module only turns them into
 * typed, serialisable shapes.
 *
 * Layout it expects (see argus/README.md "Layout"):
 *   reports/YYYY-MM-DD.md                       sweep report, one per day
 *   digests/YYYY-MM-DD.md                       Slack digest, one per day
 *   <app>/features/<dir>/journal/**\/*.md       one entry per landing
 *   <app>/features/<dir>/docs/{product,arch}.md
 *   reports/points.json                         Needs-you as data, one record per point
 *
 * `<app>` is discovered, not hardcoded: any directory one or two levels under
 * WORKSPACE_DIR holding a `features/` tree is an app — `foundry` and `pensieve` are one
 * deep, `alden/alden-portal` two. A feature is addressed as `<app>/<dir>`, and a bare
 * `<dir>` still resolves when it is unique across apps, so links written before the
 * workspace held more than one app keep working.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { MarkdownDocument } from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import { parse as parseYaml } from "yaml";

export const WORKSPACE_DIR = resolve(
  process.env.WORKSPACE_DIR || join(homedir(), "git/argus")
);
const REPORTS_DIR = join(WORKSPACE_DIR, "reports");
const DIGESTS_DIR = join(WORKSPACE_DIR, "digests");

/** Workspace directories that are never an app, so the scan does not descend into them. */
const NOT_APPS = new Set([
  "reports",
  "digests",
  "skills",
  "scripts",
  "node_modules",
  "features",
  "dist",
]);

export interface AppRoot {
  /** Path relative to WORKSPACE_DIR — `foundry`, `pensieve`, `alden/alden-portal`. */
  app: string;
  /** Absolute path of that app's `features/` directory. */
  dir: string;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };
export type Frontmatter = Record<string, Json>;

/** YAML can yield Dates and undefined; the wire only carries JSON. */
function toJson(v: unknown): Frontmatter {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {};
  }
  return JSON.parse(JSON.stringify(v)) as Frontmatter;
}

export interface Rendered {
  /** Serialisable AST — parsed once here, rendered by React on the client. */
  doc: MarkdownDocument;
  frontmatter: Frontmatter;
  /** Path relative to WORKSPACE_DIR, for "open in editor" affordances. */
  path: string;
}

export interface DayFile {
  day: string;
  /** First non-heading line, for list previews. */
  lede?: string;
  path: string;
}

export type JournalStatus =
  | "decided"
  | "implemented"
  | "documented"
  | "superseded";

export interface JournalEntry {
  /** Which app's features tree this entry lives in, e.g. `foundry`. */
  app: string;
  date: string;
  /** `<app>/<dir>` — the routing key. */
  feature: string;
  features: string[];
  hold?: string;
  /** `<feature>/<slug>` — slugs alone are not unique (older day-level entries share `YYYY-MM-DD`). */
  id: string;
  merge?: string;
  path: string;
  pr?: string;
  scope?: string;
  slug: string;
  source?: string;
  status?: JournalStatus;
  summary?: string;
  ticket?: string;
  url?: string;
}

export interface DocMeta {
  /** Which app's features tree this doc lives in, e.g. `pensieve`. */
  app: string;
  /** `<app>/<dir>` — the routing key. */
  feature: string;
  id?: string;
  lastVerified?: string;
  lastVerifiedBe?: string;
  lastVerifiedBeDate?: string;
  lastVerifiedDate?: string;
  name?: string;
  owner?: string;
  path: string;
  related: string[];
  status?: string;
  tier: "product" | "arch";
}

// ── helpers ────────────────────────────────────────────────────────────────────

const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every app in the workspace, by shallow scan. Cheap enough to redo per request (a
 * handful of `stat`s) and deliberately not cached: an app appears the moment its
 * `features/` directory does, with no restart.
 */
export async function listApps(): Promise<AppRoot[]> {
  const out: AppRoot[] = [];
  const scan = async (rel: string, depth: number): Promise<void> => {
    const abs = rel ? join(WORKSPACE_DIR, rel) : WORKSPACE_DIR;
    if (rel && (await isDir(join(abs, "features")))) {
      out.push({ app: rel, dir: join(abs, "features") });
      return; // an app never contains another app
    }
    if (depth === 0) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || NOT_APPS.has(e.name)) {
        continue;
      }
      await scan(rel ? `${rel}/${e.name}` : e.name, depth - 1);
    }
  };
  await scan("", 2);
  return out.sort((a, b) => a.app.localeCompare(b.app));
}

/** The root an absolute path belongs to, if any. */
const rootOf = (abs: string, roots: AppRoot[]) =>
  roots.find((r) => abs.startsWith(`${r.dir}/`));

/**
 * Split a feature key into the app that owns it and the directory under its
 * `features/`. A bare key (no app prefix) is resolved by the callers, which accept it
 * only when exactly one app has it.
 */
function splitKey(
  feature: string,
  roots: AppRoot[]
): { root: AppRoot; dir: string } | undefined {
  for (const root of roots) {
    if (feature.startsWith(`${root.app}/`)) {
      return { dir: feature.slice(root.app.length + 1), root };
    }
  }
  return undefined;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") {
      continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(p);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      yield p;
    }
  }
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) {
    return undefined;
  }
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  return String(v);
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String);
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Wikilinks are the journal's own cross-reference syntax: `[[slug]]` points at a sibling
 * entry, `[[YYYY-MM-DD]]` at a day. Resolve them to app routes before parsing so the
 * renderer only ever sees ordinary links.
 */
export function resolveWikilinks(src: string, feature?: string): string {
  return src.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
    (_m, target: string, label?: string) => {
      const t = target.trim();
      const text = (label ?? t).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        return `[${text}](/journal?day=${t})`;
      }
      const id = feature ? `${feature}/${t}` : t;
      return `[${text}](/journal/${id.split("/").map(encodeURIComponent).join("/")})`;
    }
  );
}

/** Doc regions are fenced with HTML comments (`<!-- accio:begin … -->`); readers never need them. */
const stripHtmlComments = (src: string) =>
  src.replace(/<!--[\s\S]*?-->\n?/g, "");

/** `<app>/<dir>` for a file inside some app's features tree. */
function featureOf(abs: string, roots: AppRoot[]): string | undefined {
  const root = rootOf(abs, roots);
  if (!root) {
    return undefined;
  }
  const m = relative(root.dir, abs).match(/^(.*?)\/(journal|docs)\//);
  return m ? `${root.app}/${m[1]}` : undefined;
}

/**
 * Split frontmatter off, parse both halves, return the pair. `feature` is the key
 * wikilinks in this file resolve against — the callers know it, so it is passed in
 * rather than re-derived (deriving it needs the app roots, and this stays sync-free).
 */
export async function render(
  absPath: string,
  feature?: string
): Promise<Rendered> {
  const raw = await readFile(absPath, "utf8");
  const src = stripHtmlComments(resolveWikilinks(raw, feature));
  const doc = parseMarkdown(src, { frontmatter: true, headingIds: true });
  let frontmatter: Frontmatter = {};
  if (doc.frontmatter) {
    try {
      frontmatter = toJson(parseYaml(doc.frontmatter));
    } catch {
      frontmatter = { _error: "frontmatter did not parse as YAML" };
    }
  }
  return { doc, frontmatter, path: relative(WORKSPACE_DIR, absPath) };
}

async function readFrontmatter(absPath: string): Promise<Frontmatter> {
  const raw = await readFile(absPath, "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) {
    return {};
  }
  try {
    return toJson(parseYaml(m[1]));
  } catch {
    return {};
  }
}

async function dayFiles(dir: string): Promise<DayFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: DayFile[] = [];
  for (const n of names) {
    const m = n.match(DAY_RE);
    if (!m) {
      continue;
    }
    const abs = join(dir, n);
    const raw = await readFile(abs, "utf8");
    const lede = raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"))
      ?.replace(/^_|_$/g, "");
    out.push({ day: m[1], lede, path: relative(WORKSPACE_DIR, abs) });
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1));
}

// ── reports ────────────────────────────────────────────────────────────────────

export const listReports = () => dayFiles(REPORTS_DIR);

export async function readReport(day: string): Promise<Rendered | null> {
  const p = join(REPORTS_DIR, `${day}.md`);
  return (await exists(p)) ? render(p) : null;
}

// ── digests ────────────────────────────────────────────────────────────────────

export const listDigests = () => dayFiles(DIGESTS_DIR);

export async function readDigest(day: string): Promise<Rendered | null> {
  const p = join(DIGESTS_DIR, `${day}.md`);
  return (await exists(p)) ? render(p) : null;
}

// ── journal ────────────────────────────────────────────────────────────────────

function journalMeta(
  abs: string,
  fm: Frontmatter,
  roots: AppRoot[]
): JournalEntry | null {
  const root = rootOf(abs, roots);
  if (!root) {
    return null;
  }
  const rel = relative(root.dir, abs);
  const idx = rel.indexOf("/journal/");
  if (idx < 0) {
    return null;
  }
  const date = str(fm.date)?.slice(0, 10);
  if (!date) {
    return null;
  }
  const status = str(fm.status) as JournalStatus | undefined;
  const feature = `${root.app}/${rel.slice(0, idx)}`;
  const slug = basename(abs, ".md");
  return {
    app: root.app,
    date,
    feature,
    features: list(fm.features),
    hold: str(fm.hold),
    id: `${feature}/${slug}`,
    merge: str(fm.merge),
    path: relative(WORKSPACE_DIR, abs),
    pr: str(fm.pr),
    scope: str(fm.scope),
    slug,
    source: str(fm.source),
    status,
    summary: str(fm.summary),
    ticket: str(fm.ticket),
    url: str(fm.url),
  };
}

export async function listJournal(): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  const roots = await listApps();
  for (const root of roots) {
    for await (const p of walk(root.dir)) {
      if (!p.includes("/journal/")) {
        continue;
      }
      const meta = journalMeta(p, await readFrontmatter(p), roots);
      if (meta) {
        out.push(meta);
      }
    }
  }
  return out.sort((a, b) =>
    a.date === b.date ? (a.slug < b.slug ? 1 : -1) : a.date < b.date ? 1 : -1
  );
}

/**
 * `id` is `<feature>/<slug>`. A wikilink that crosses features resolves against the wrong
 * feature, so fall back to the slug alone when it is unique across the tree.
 */
export async function readJournalEntry(
  id: string
): Promise<(Rendered & { meta: JournalEntry }) | null> {
  if (id.includes("..")) {
    return null;
  }
  const cut = id.lastIndexOf("/");
  const feature = cut > 0 ? id.slice(0, cut) : "";
  const slug = id.slice(cut + 1);
  const roots = await listApps();
  const candidates: string[] = [];
  outer: for (const root of roots) {
    for await (const p of walk(root.dir)) {
      if (!p.includes("/journal/") || basename(p, ".md") !== slug) {
        continue;
      }
      const key = featureOf(p, roots);
      // An exact `<app>/<dir>` match ends the search. A bare `<dir>` — what a wikilink
      // written before the workspace held several apps says — is kept as a candidate and
      // accepted only if it turns out to be unique, as an unqualified slug already is.
      if (key === feature) {
        candidates.length = 0;
        candidates.push(p);
        break outer;
      }
      if (feature === "" || key?.endsWith(`/${feature}`)) {
        candidates.push(p);
      }
    }
  }
  if (candidates.length !== 1) {
    return null;
  }
  const r = await render(candidates[0], featureOf(candidates[0], roots));
  const meta = journalMeta(candidates[0], r.frontmatter, roots);
  return meta ? { ...r, meta } : null;
}

// ── docs ───────────────────────────────────────────────────────────────────────

function docMeta(
  abs: string,
  fm: Frontmatter,
  roots: AppRoot[]
): DocMeta | null {
  const root = rootOf(abs, roots);
  if (!root) {
    return null;
  }
  const m = relative(root.dir, abs).match(/^(.*)\/docs\/(product|arch)\.md$/);
  if (!m) {
    return null;
  }
  return {
    app: root.app,
    feature: `${root.app}/${m[1]}`,
    id: str(fm.id),
    lastVerified: str(fm.last_verified),
    lastVerifiedBe: str(fm.last_verified_be),
    lastVerifiedBeDate: str(fm.last_verified_be_date),
    lastVerifiedDate: str(fm.last_verified_date),
    name: str(fm.feature_name),
    owner: str(fm.owner),
    path: relative(WORKSPACE_DIR, abs),
    related: list(fm.related_features),
    status: str(fm.status),
    tier: m[2] as DocMeta["tier"],
  };
}

export async function listDocs(): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  const roots = await listApps();
  for (const root of roots) {
    for await (const p of walk(root.dir)) {
      if (!p.includes("/docs/")) {
        continue;
      }
      const meta = docMeta(p, await readFrontmatter(p), roots);
      if (meta) {
        out.push(meta);
      }
    }
  }
  return out.sort(
    (a, b) => a.feature.localeCompare(b.feature) || a.tier.localeCompare(b.tier)
  );
}

/**
 * The file behind a feature key. An `<app>/<dir>` key addresses one file directly; a
 * bare `<dir>` is accepted only when exactly one app has it, so an ambiguous key reads
 * as "no such doc" rather than silently picking an app.
 */
async function resolveDocPath(
  feature: string,
  tier: "product" | "arch",
  roots: AppRoot[]
): Promise<string | null> {
  const split = splitKey(feature, roots);
  if (split) {
    const p = join(split.root.dir, split.dir, "docs", `${tier}.md`);
    return (await exists(p)) ? p : null;
  }
  const hits: string[] = [];
  for (const root of roots) {
    const p = join(root.dir, feature, "docs", `${tier}.md`);
    if (await exists(p)) {
      hits.push(p);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

export async function readDoc(
  feature: string,
  tier: "product" | "arch"
): Promise<(Rendered & { meta: DocMeta }) | null> {
  // `feature` is a path segment list from the URL; refuse anything that escapes the tree.
  if (feature.includes("..") || feature.startsWith("/")) {
    return null;
  }
  const roots = await listApps();
  const p = await resolveDocPath(feature, tier, roots);
  if (!p) {
    return null;
  }
  const r = await render(p, featureOf(p, roots));
  const meta = docMeta(p, r.frontmatter, roots);
  return meta ? { ...r, meta } : null;
}

// ── points ─────────────────────────────────────────────────────────────────────

export type PointGroup =
  | "decide"
  | "verify"
  | "confirm"
  | "hold"
  | "housekeeping";

/** The sweep's own copy of a verdict, attached when it re-emits a decided point (LIA-88). */
export interface PointDecision {
  action: "sent" | "ignored" | "verified";
  at: string;
  job?: { id: string; url: string };
  point: string;
  reason?: string;
  subject: string;
}

/** One Needs-you item as `skills/sweep/scripts/points.ts` emits it (LIA-87). */
export interface Point {
  ask: string;
  decision?: PointDecision;
  detail?: string;
  features?: string[];
  firstSeen: string;
  group: PointGroup;
  /** `<group>/<slug>` — stable tick to tick, and the decision file's path. */
  id: string;
  repo?: string;
  subject: string;
  ticket?: string;
}

export interface PointsFile {
  date: string;
  points: Point[];
  tick: string;
}

/**
 * `reports/points.json`, or null when the sweep has not written it. Its name fails
 * `DAY_RE`, so the reports listing never shows it — this is its only reader. Records are
 * copied field by field so a shape the sweep adds later cannot leak onto the wire unnamed.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one field-by-field validator; splitting it hides the shape
export async function readPoints(): Promise<PointsFile | null> {
  let raw: string;
  try {
    raw = await readFile(join(REPORTS_DIR, "points.json"), "utf8");
  } catch {
    return null;
  }
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") {
    return null;
  }
  const f = v as { tick?: unknown; date?: unknown; points?: unknown };
  const points: Point[] = [];
  for (const r of Array.isArray(f.points) ? f.points : []) {
    if (
      !r ||
      typeof r !== "object" ||
      typeof r.id !== "string" ||
      typeof r.group !== "string"
    ) {
      continue;
    }
    const d =
      r.decision && typeof r.decision === "object"
        ? (r.decision as {
            action?: unknown;
            at?: unknown;
            job?: { id?: unknown; url?: unknown } | null;
            point?: unknown;
            reason?: unknown;
            subject?: unknown;
          })
        : undefined;
    points.push({
      ask: String(r.ask ?? ""),
      decision:
        d &&
        typeof d.point === "string" &&
        (d.action === "sent" ||
          d.action === "ignored" ||
          d.action === "verified")
          ? {
              action: d.action,
              at: String(d.at ?? ""),
              job:
                d.job &&
                typeof d.job === "object" &&
                typeof d.job.id === "string"
                  ? { id: d.job.id, url: String(d.job.url ?? "") }
                  : undefined,
              point: d.point,
              reason: str(d.reason),
              subject: String(d.subject ?? ""),
            }
          : undefined,
      detail: str(r.detail),
      features: Array.isArray(r.features) ? r.features.map(String) : undefined,
      firstSeen: String(r.firstSeen ?? ""),
      group: r.group as PointGroup,
      id: r.id,
      repo: str(r.repo),
      subject: String(r.subject ?? ""),
      ticket: str(r.ticket),
    });
  }
  return { date: String(f.date ?? ""), points, tick: String(f.tick ?? "") };
}
