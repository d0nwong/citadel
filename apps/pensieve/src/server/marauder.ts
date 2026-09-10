/**
 * The map of the work, read (LIA-154/155, read here for LIA-160).
 *
 * Two trees in the blackboard, both the sweep's: `workstreams/<slug>.json` is the record —
 * one file per thing a person asks "is that done yet?" about — and `marauder/*.md` are the
 * pages `marauder render` writes from those records and nothing else. Pensieve parses and
 * renders them; the only thing it writes back is a decision on an Unsorted entry, which is
 * `server/decisions.ts`'s job.
 *
 * Two things happen to a page on the way through, and neither invents anything:
 *
 *   - Links are rewritten. The pages are written to be read in a terminal too, so a journal
 *     entry is `../alden/…/journal/…/<slug>.md` — a path relative to `marauder/`. Resolved
 *     against the workspace root it is a file this app already has a route for, so it
 *     becomes that route and a click stays inside the app.
 *   - A workstream's name becomes a link to its own page. The board writes each name as a
 *     bold line, since a terminal has nowhere to click; here the name of a record that
 *     exists is linked to `/work/<slug>`, and a bold line that names no record is left as
 *     it is.
 *
 * Every reader takes its directory, so a test can point one at a temp blackboard without
 * setting `WORKSPACE_DIR` — which is fixed at module load, and would leak across `bun test`'s
 * shared module registry, in an order that depends on which file ran first.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type {
  BlockNode,
  InlineNode,
  MarkdownDocument,
} from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import type { Side, Stage } from "../lib/marauder";
import { SLUG_RE } from "../lib/marauder";
import { dropTitle, outline } from "./sections";
import type { AppRoot, Rendered } from "./workspace";
import { listApps, WORKSPACE_DIR } from "./workspace";

/** Where `marauder render` writes its pages, and where the records it renders live. */
export const MARAUDER_DIR = join(WORKSPACE_DIR, "marauder");
export const WORKSTREAMS_DIR = join(WORKSPACE_DIR, "workstreams");

// ── the record ─────────────────────────────────────────────────────────────────

/** One event on a workstream, as `record.ts` writes it. */
export interface WorkstreamEvent {
  /** What this event did to the record, in the record's own words; a confirmation stamps it. */
  action?: string;
  at: string;
  kind: string;
  side?: Side;
  source?: { ref: string; type: string; url?: string };
  summary: string;
  ticket?: string;
  /** Who an ask is aimed at; `you` is the user, and Verify reads this (LIA-162 AC3). */
  to?: string[];
}

/** The keys an event attaches by — the ticket and PR lists are what the page links out to. */
export interface WorkstreamKeys {
  people: string[];
  prs: string[];
  threads: string[];
  tickets: string[];
  vocab: string[];
}

/**
 * A workstream, in the fields a page here reads. Copied across field by field rather than
 * cast, so a key the sweep adds later cannot reach the wire unnamed — `readPoints` does the
 * same with `points.json`, for the same reason.
 */
export interface Workstream {
  driver?: string;
  events: WorkstreamEvent[];
  features: string[];
  keys: WorkstreamKeys;
  milestone: string | null;
  name: string;
  parked: boolean;
  slug: string;
  stage: Partial<Record<Side, Stage>>;
  updated: string;
  wants: string[];
}

/** A date the workstreams point at — `workstreams/_milestones.json`, keyed by slug. */
export interface Milestone {
  date: string;
  name: string;
  owner: string;
}

/**
 * One entry in the corrections queue: what ingest could not attach on its own, with its
 * guess. `kind: "split"` is not an event at all — it is a proposal to cut a workstream in
 * two, and the page shows it as one.
 */
export interface UnsortedItem {
  at: string;
  candidates: Array<{ how: string; slug: string; why: string }>;
  features?: string[];
  groups?: Array<{ events: string[]; name: string }>;
  id: string;
  kind: "landing" | "new" | "slack" | "split";
  name?: string;
  needs?: string;
  slug?: string;
  source?: { ref: string; type: string; url?: string };
  suggest: string | null;
  summary: string;
  text?: string;
  to?: string[];
  why?: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];

function source(v: unknown) {
  if (!v || typeof v !== "object") {
    return;
  }
  const s = v as Record<string, unknown>;
  const ref = str(s.ref);
  return ref ? { ref, type: str(s.type) ?? "", url: str(s.url) } : undefined;
}

function events(v: unknown): WorkstreamEvent[] {
  const out: WorkstreamEvent[] = [];
  for (const e of Array.isArray(v) ? v : []) {
    if (!e || typeof e !== "object") {
      continue;
    }
    const r = e as Record<string, unknown>;
    out.push({
      action: str(r.action),
      at: str(r.at) ?? "",
      kind: str(r.kind) ?? "chat",
      side: str(r.side) as Side | undefined,
      source: source(r.source),
      summary: str(r.summary) ?? "",
      ticket: str(r.ticket),
      to: strs(r.to),
    });
  }
  return out;
}

function stage(v: unknown): Partial<Record<Side, Stage>> {
  const out: Partial<Record<Side, Stage>> = {};
  if (v && typeof v === "object") {
    for (const side of ["fe", "be"] as const) {
      const s = str((v as Record<string, unknown>)[side]);
      if (s) {
        out[side] = s as Stage;
      }
    }
  }
  return out;
}

/** One file's text as a workstream, or null when it is not one. */
export function parseWorkstream(text: string, slug: string): Workstream | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const w = v as Record<string, unknown>;
  const keys = (w.keys ?? {}) as Record<string, unknown>;
  const name = str(w.name);
  if (!name) {
    return null;
  }
  return {
    driver: str(w.driver),
    events: events(w.events),
    features: strs(w.features),
    keys: {
      people: strs(keys.people),
      prs: strs(keys.prs),
      threads: strs(keys.threads),
      tickets: strs(keys.tickets),
      vocab: strs(keys.vocab),
    },
    milestone: str(w.milestone) ?? null,
    name,
    parked: w.parked === true,
    slug: str(w.slug) ?? slug,
    stage: stage(w.stage),
    updated: str(w.updated) ?? "",
    wants: strs(w.wants),
  };
}

/**
 * Every workstream, most recently moved first. Files starting with `_` are never a
 * workstream — that is where the milestones and the Unsorted queue live.
 */
export async function listWorkstreams(
  dir = WORKSTREAMS_DIR
): Promise<Workstream[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Workstream[] = [];
  for (const name of names
    .filter((n) => n.endsWith(".json") && !n.startsWith("_"))
    .sort()) {
    const w = parseWorkstream(
      await readFile(join(dir, name), "utf8"),
      basename(name, ".json")
    );
    if (w) {
      out.push(w);
    }
  }
  return out.sort(
    (a, b) => b.updated.localeCompare(a.updated) || a.slug.localeCompare(b.slug)
  );
}

export async function readMilestones(
  dir = WORKSTREAMS_DIR
): Promise<Record<string, Milestone>> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "_milestones.json"), "utf8");
  } catch {
    return {};
  }
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {};
  }
  const out: Record<string, Milestone> = {};
  for (const [slug, m] of Object.entries(v as Record<string, unknown>)) {
    if (m && typeof m === "object") {
      const r = m as Record<string, unknown>;
      out[slug] = {
        date: str(r.date) ?? "",
        name: str(r.name) ?? slug,
        owner: str(r.owner) ?? "",
      };
    }
  }
  return out;
}

/** The candidates ingest weighed, dropping any that names no workstream. */
function candidates(v: unknown): UnsortedItem["candidates"] {
  return (Array.isArray(v) ? v : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      how: str(c.how) ?? "",
      slug: str(c.slug) ?? "",
      why: str(c.why) ?? "",
    }))
    .filter((c) => c.slug);
}

/** A `split` proposal's groupings; an empty list is none, so the page renders no heading. */
function groups(v: unknown): UnsortedItem["groups"] {
  const out = (Array.isArray(v) ? v : [])
    .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
    .map((g) => ({ events: strs(g.events), name: str(g.name) ?? "" }));
  return out.length > 0 ? out : undefined;
}

const KINDS = ["landing", "new", "slack", "split"] as const;

/** One queue entry, or null when the record names nothing that could be decided. */
function parseUnsorted(value: unknown): UnsortedItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const r = value as Record<string, unknown>;
  const id = str(r.id);
  if (!id) {
    return null;
  }
  const kind = str(r.kind) ?? "slack";
  return {
    at: str(r.at) ?? "",
    candidates: candidates(r.candidates),
    features: Array.isArray(r.features) ? strs(r.features) : undefined,
    groups: groups(r.groups),
    id,
    kind: (KINDS as readonly string[]).includes(kind)
      ? (kind as UnsortedItem["kind"])
      : "slack",
    name: str(r.name),
    needs: str(r.needs),
    slug: str(r.slug),
    source: source(r.source),
    suggest: str(r.suggest) ?? null,
    summary: str(r.summary) ?? "",
    text: str(r.text),
    to: strs(r.to),
    why: str(r.why),
  };
}

/** The corrections queue, newest first — the order the Unsorted page lists it in (AC3). */
export async function readUnsorted(
  dir = WORKSTREAMS_DIR
): Promise<UnsortedItem[]> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "_unsorted.json"), "utf8");
  } catch {
    return [];
  }
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  const out = (Array.isArray(v) ? v : [])
    .map(parseUnsorted)
    .filter((i): i is UnsortedItem => i !== null);
  return out.sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)
  );
}

// ── links ──────────────────────────────────────────────────────────────────────

const JOURNAL_RE = /^(.*)\/journal\/(?:.*\/)?([^/]+)\.md$/;
const DOC_RE = /^(.*)\/docs\/(product|arch)\.md$/;
const DAY_RE = /^(reports|digests)\/(\d{4}-\d{2}-\d{2})\.md$/;

/** `a/b/../c` → `a/c`, and a leading `./` dropped. Same rule as a shell, no fs involved. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

/**
 * The route inside Pensieve for a path the sweep wrote, or undefined when there is none —
 * in which case the link is left exactly as it was written, so a page never grows a link
 * that goes nowhere.
 *
 * `href` is relative to `base` (the page's own directory under the workspace root), which
 * is what makes the same record render correctly from `marauder/` and from `reports/`.
 */
export function routeFor(
  href: string,
  base: string,
  roots: AppRoot[]
): string | undefined {
  if (/^[a-z]+:/i.test(href) || href.startsWith("/") || href.startsWith("#")) {
    return undefined;
  }
  const path = normalise(`${base}/${href}`);
  const encode = (p: string) => p.split("/").map(encodeURIComponent).join("/");

  const day = path.match(DAY_RE);
  if (day) {
    return `/${day[1]}/${day[2]}`;
  }
  if (path.startsWith("marauder/") && path.endsWith(".md")) {
    return `/work/${encodeURIComponent(path.slice(9, -3))}`;
  }
  // A features path is `<app>/features/<dir>/...`, and `<app>` is discovered rather than
  // hardcoded — so the roots decide where the app ends and the feature directory begins.
  const root = roots.find((r) => path.startsWith(`${r.app}/features/`));
  if (!root) {
    return undefined;
  }
  const rest = path.slice(`${root.app}/features/`.length);
  const entry = rest.match(JOURNAL_RE);
  if (entry) {
    return `/journal/${encode(`${root.app}/${entry[1]}/${entry[2]}`)}`;
  }
  const doc = rest.match(DOC_RE);
  if (doc) {
    return `/docs/${encode(`${root.app}/${doc[1]}`)}${doc[2] === "arch" ? "?tier=arch" : ""}`;
  }
  return undefined;
}

const inlineText = (nodes: InlineNode[]): string => {
  let out = "";
  for (const n of nodes) {
    if ("value" in n && typeof n.value === "string") {
      out += n.value;
    } else if ("children" in n && Array.isArray(n.children)) {
      out += inlineText(n.children as InlineNode[]);
    }
  }
  return out;
};

type Rewrite = (node: InlineNode) => InlineNode;

function mapInline(nodes: InlineNode[], fn: Rewrite): InlineNode[] {
  return nodes.map((node) => {
    const next = fn(node);
    if ("children" in next && Array.isArray(next.children)) {
      return {
        ...next,
        children: mapInline(next.children as InlineNode[], fn),
      } as InlineNode;
    }
    return next;
  });
}

function mapBlocks(nodes: BlockNode[], fn: Rewrite): BlockNode[] {
  return nodes.map((node) => {
    if (!("children" in node && Array.isArray(node.children))) {
      return node;
    }
    const kids = node.children as Array<BlockNode | InlineNode>;
    const isBlock = kids.some(
      (k) =>
        k && typeof k === "object" && "type" in k && BLOCK_TYPES.has(k.type)
    );
    return {
      ...node,
      children: isBlock
        ? mapBlocks(kids as BlockNode[], fn)
        : mapInline(kids as InlineNode[], fn),
    } as BlockNode;
  });
}

const BLOCK_TYPES = new Set([
  "blockquote",
  "heading",
  "list",
  "listItem",
  "paragraph",
  "table",
  "tableCell",
  "tableRow",
]);

/** Every link in the document that names a file this app has a page for, pointed at it. */
function linkFilesToRoutes(
  doc: MarkdownDocument,
  base: string,
  roots: AppRoot[]
): MarkdownDocument {
  return {
    ...doc,
    children: mapBlocks(doc.children, (node) => {
      if (node.type !== "link") {
        return node;
      }
      const { href } = node as { href?: string };
      const to = href ? routeFor(href, base, roots) : undefined;
      return to ? ({ ...node, href: to } as InlineNode) : node;
    }),
  };
}

/**
 * The board writes a workstream's name as a bold line of its own, because the page is read
 * in a terminal too. Here that line becomes a link to the workstream's page — but only
 * when a record of that name exists, so a bold word in a sentence, or a name for something
 * that was renamed since, is left alone rather than linked to a 404.
 */
function linkNames(
  doc: MarkdownDocument,
  workstreams: Workstream[]
): MarkdownDocument {
  const bySlug = new Map(workstreams.map((w) => [w.name, w.slug]));
  return {
    ...doc,
    children: doc.children.map((node) => {
      if (node.type !== "paragraph" || node.children.length !== 1) {
        return node;
      }
      const [only] = node.children as InlineNode[];
      if (only.type !== "strong") {
        return node;
      }
      const slug = bySlug.get(inlineText(only.children as InlineNode[]).trim());
      if (!slug) {
        return node;
      }
      return {
        ...node,
        children: [
          {
            children: [only],
            href: `/work/${encodeURIComponent(slug)}`,
            type: "link",
          } as unknown as InlineNode,
        ],
      } as BlockNode;
    }),
  };
}

// ── the pages ──────────────────────────────────────────────────────────────────

/**
 * What a page needs beyond its own bytes. Both are read from the workspace when they are
 * not passed, and both are passed by a test pointing at a temp blackboard — `WORKSPACE_DIR`
 * is fixed at module load, so overriding it in-process would leak across `bun test`'s
 * shared module registry.
 */
export interface PageSources {
  /** Where the page sits, relative to the workspace root — what its links resolve against. */
  base?: string;
  roots?: AppRoot[];
  workstreams?: Workstream[];
}

/** One `marauder/*.md` parsed, with its links pointed at the routes that serve them. */
async function readPage(
  file: string,
  dir: string,
  sources: PageSources
): Promise<Rendered | null> {
  let raw: string;
  try {
    raw = await readFile(join(dir, file), "utf8");
  } catch {
    return null;
  }
  const roots = sources.roots ?? (await listApps());
  const workstreams = sources.workstreams ?? (await listWorkstreams());
  const base = sources.base ?? (relative(WORKSPACE_DIR, dir) || "marauder");
  // The page names itself in its own header, as every other page here does.
  const parsed = dropTitle(parseMarkdown(raw, { headingIds: true }));
  const doc = linkNames(linkFilesToRoutes(parsed, base, roots), workstreams);
  doc.headings = outline(doc);
  return {
    doc,
    frontmatter: {},
    path: relative(WORKSPACE_DIR, join(dir, file)),
  };
}

/** The board — `marauder/board.md` — or null when no run has written one yet. */
export function readBoard(
  dir = MARAUDER_DIR,
  sources: PageSources = {}
): Promise<Rendered | null> {
  return readPage("board.md", dir, sources);
}

/** One workstream's page — `marauder/<slug>.md` — with the record behind it. */
export async function readWorkstream(
  slug: string,
  dir = MARAUDER_DIR,
  sources: PageSources = {}
): Promise<{ page: Rendered | null; workstream: Workstream | null } | null> {
  if (!SLUG_RE.test(slug)) {
    return null;
  }
  const all = sources.workstreams ?? (await listWorkstreams());
  const page = await readPage(`${slug}.md`, dir, {
    ...sources,
    workstreams: all,
  });
  const workstream = all.find((w) => w.slug === slug) ?? null;
  return page || workstream ? { page, workstream } : null;
}
