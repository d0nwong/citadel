/**
 * The map of the work, read (LIA-154/155, read here for LIA-160, over features since
 * ARG-167).
 *
 * The feature is the unit (argus ARG-164). Its record is `<app>/features/<dir>/work.json` —
 * what is going on in it, if anything — and beside it `board.md` is the page `marauder
 * render` writes from that record (ARG-166). What attached to no feature waits in
 * `queue/_unsorted.json`, and the dates the team set are in `queue/_milestones.json`; the
 * one page over everything is `marauder/board.md`. Pensieve parses and renders them; the
 * only thing it writes back is a decision, which is `server/decisions.ts`'s job.
 *
 * Two things happen to a page on the way through, and neither invents anything:
 *
 *   - Links are rewritten. The pages are written to be read in a terminal too, so a journal
 *     entry is `../alden/…/journal/…/<slug>.md` — a path relative to the page. Resolved
 *     against the workspace root it is a file this app already has a route for, so it
 *     becomes that route and a click stays inside the app.
 *   - A feature's name becomes a link to its own page. The board writes a name as a bold
 *     line or a heading; where argus has not linked it already, the name of a feature that
 *     exists is linked to `/features/<dir>`, and a name that is no feature is left alone.
 *
 * Every reader takes its directory or its app roots, so a test can point one at a temp
 * blackboard without setting `WORKSPACE_DIR` — which is fixed at module load, and would
 * leak across `bun test`'s shared module registry.
 */

import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  BlockNode,
  InlineNode,
  MarkdownDocument,
} from "@tanstack/markdown";
import { parseMarkdown } from "@tanstack/markdown/parser";
import type { Side } from "../lib/marauder";
import { isFeature } from "../lib/marauder";
import { dropTitle, outline } from "./sections";
import type { AppRoot, Rendered } from "./workspace";
import { listApps, WORKSPACE_DIR } from "./workspace";

/** Where `marauder render` writes the board, and where the queue and milestones live. */
export const MARAUDER_DIR = join(WORKSPACE_DIR, "marauder");
export const QUEUE_DIR = join(WORKSPACE_DIR, "queue");

/** A feature's record, and the page argus renders beside its docs (ARG-164, ARG-166). */
export const WORK_FILE = "work.json";
export const FEATURE_PAGE = "board.md";

/** Where an app's manifest sits, relative to the app — what names its features. */
const MANIFEST = ".doc-workspace/feature-manifest.json";

// ── the record ─────────────────────────────────────────────────────────────────

/** One event on a feature's record, as `record.ts` writes it. */
export interface WorkEvent {
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
export interface WorkKeys {
  prs: string[];
  threads: string[];
  tickets: string[];
  vocab: string[];
}

/** A question still standing on a feature, and whose move it is. */
export interface OpenQuestion {
  askedBy: string;
  at: string;
  owner?: string;
  q: string;
  ticket?: string;
}

/**
 * A feature the queue can attach to: every directory under an app's `features/` holding
 * `docs/`, `journal/` or a `work.json` — argus `loadFeatures`, rule for rule — with the
 * name the app's manifest gives it.
 */
export interface FeatureRef {
  /** The app it sits in, relative to the workspace root — `alden/alden-portal`. */
  app: string;
  /** Its directory under that app's `features/` — `admin/invoicing`, `tasks`. */
  feature: string;
  name: string;
}

/**
 * A feature's record, in the fields a page here reads. Copied across field by field rather
 * than cast, so a key the sweep adds later cannot reach the wire unnamed. `app` and `name`
 * are not in the file: they are where it was found and what the manifest calls it.
 */
export interface Work extends FeatureRef {
  events: WorkEvent[];
  keys: WorkKeys;
  milestone: string | null;
  openQuestions: OpenQuestion[];
  updated: string;
}

/** A date the features point at — `queue/_milestones.json`, keyed by id. */
export interface Milestone {
  date: string;
  name: string;
  owner: string;
}

/** One entry in the corrections queue: what ingest could not attach on its own, with its guess. */
export interface UnsortedItem {
  at: string;
  candidates: Array<{ feature: string; how: string; why: string }>;
  features?: string[];
  id: string;
  kind: "landing" | "slack";
  needs?: string;
  source?: { ref: string; type: string; url?: string };
  /** The feature the sweep would attach it to — preselected on the row. */
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
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function source(v: unknown) {
  if (!isRecord(v)) {
    return;
  }
  const ref = str(v.ref);
  return ref ? { ref, type: str(v.type) ?? "", url: str(v.url) } : undefined;
}

function events(v: unknown): WorkEvent[] {
  const out: WorkEvent[] = [];
  for (const r of Array.isArray(v) ? v : []) {
    if (!isRecord(r)) {
      continue;
    }
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

function questions(v: unknown): OpenQuestion[] {
  return (Array.isArray(v) ? v : []).filter(isRecord).flatMap((r) => {
    const q = str(r.q);
    return q
      ? [
          {
            askedBy: str(r.asked_by) ?? "",
            at: str(r.at) ?? "",
            owner: str(r.owner),
            q,
            ticket: str(r.ticket),
          },
        ]
      : [];
  });
}

/**
 * One `work.json`'s text as the record of `ref`, or null when it is not one. A file whose
 * `feature` names another directory is refused, as argus's `validate` refuses it: a record
 * in the wrong place is how the old workstreams drifted.
 */
export function parseWork(text: string, ref: FeatureRef): Work | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v)) {
    return null;
  }
  const updated = str(v.updated);
  if (!(updated && str(v.feature) === ref.feature)) {
    return null;
  }
  const keys = isRecord(v.keys) ? v.keys : {};
  return {
    ...ref,
    events: events(v.events),
    keys: {
      prs: strs(keys.prs),
      threads: strs(keys.threads),
      tickets: strs(keys.tickets),
      vocab: strs(keys.vocab),
    },
    milestone: str(v.milestone) ?? null,
    openQuestions: questions(v.open_questions),
    updated,
  };
}

// ── the features ───────────────────────────────────────────────────────────────

/** The directories inside a feature that are its own, never another feature. */
const OWN_DIRS = new Set(["docs", "journal", "node_modules"]);

/** argus `featureDir`: where a manifest entry's docs live under `features/`. */
function manifestDir(f: Record<string, unknown>): string | undefined {
  const id = str(f.id);
  const dir = str(f.dir);
  if (dir || !id) {
    return dir;
  }
  return f.type === "shared"
    ? `shared/${id.replace(/^shared-/, "")}`
    : id.replace(/^admin-/, "admin/");
}

/** An app's manifest, as directory → name. An app with none names nothing. */
async function manifestNames(appDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let v: unknown;
  try {
    v = JSON.parse(await readFile(join(appDir, MANIFEST), "utf8"));
  } catch {
    return out;
  }
  const features = isRecord(v) && Array.isArray(v.features) ? v.features : [];
  for (const f of features.filter(isRecord)) {
    const dir = manifestDir(f);
    const name = str(f.name);
    if (dir && name) {
      out.set(dir, name);
    }
  }
  return out;
}

/** How a feature is said when the manifest does not name it: its last folder, in words. */
const folderTitle = (feature: string) => {
  const last = (feature.split("/").at(-1) ?? feature).replace(/-/g, " ");
  return last.slice(0, 1).toUpperCase() + last.slice(1);
};

/**
 * Every feature directory under one `features/` root. Features nest (`admin` has docs, and
 * so does `admin/usage`), so the walk goes on below one; it never goes into a feature's own
 * `docs/` or `journal/`.
 */
async function featureDirs(root: string, rel = ""): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(rel ? join(root, rel) : root, {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const out: string[] = [];
  const isOne = entries.some((e) =>
    e.isDirectory()
      ? e.name === "docs" || e.name === "journal"
      : e.name === WORK_FILE
  );
  if (rel && isOne) {
    out.push(rel);
  }
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".") && !OWN_DIRS.has(e.name)) {
      out.push(...(await featureDirs(root, rel ? `${rel}/${e.name}` : e.name)));
    }
  }
  return out;
}

/**
 * Every feature of every app, by manifest name. A directory two apps both have is the
 * first app's, as argus refuses the second — so a feature key is one directory.
 */
export async function listFeatures(roots?: AppRoot[]): Promise<FeatureRef[]> {
  const out: FeatureRef[] = [];
  const seen = new Set<string>();
  for (const root of roots ?? (await listApps())) {
    const names = await manifestNames(dirname(root.dir));
    for (const feature of await featureDirs(root.dir)) {
      if (!seen.has(feature)) {
        seen.add(feature);
        out.push({
          app: root.app,
          feature,
          name: names.get(feature) ?? folderTitle(feature),
        });
      }
    }
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature));
}

/** The absolute directory a feature sits in, given the roots it was found under. */
const featurePath = (ref: FeatureRef, roots: AppRoot[]) => {
  const root = roots.find((r) => r.app === ref.app);
  return root ? join(root.dir, ref.feature) : undefined;
};

async function readWork(
  ref: FeatureRef,
  roots: AppRoot[]
): Promise<Work | null> {
  const dir = featurePath(ref, roots);
  if (!dir) {
    return null;
  }
  try {
    return parseWork(await readFile(join(dir, WORK_FILE), "utf8"), ref);
  } catch {
    return null;
  }
}

/**
 * Every feature with something going on — every `work.json` under every app's `features/`
 * — most recently moved first. A feature with nothing going on has no record, and a file
 * that is not one is skipped.
 */
export async function listWork(roots?: AppRoot[]): Promise<Work[]> {
  const apps = roots ?? (await listApps());
  const found = await Promise.all(
    (await listFeatures(apps)).map((f) => readWork(f, apps))
  );
  return found
    .filter((w): w is Work => w !== null)
    .sort(
      (a, b) =>
        b.updated.localeCompare(a.updated) || a.feature.localeCompare(b.feature)
    );
}

// ── the queue ──────────────────────────────────────────────────────────────────

/** One JSON file under `queue/`, or undefined when there is none or it does not parse. */
async function readQueueFile(dir: string, file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, file), "utf8"));
  } catch {
    return undefined;
  }
}

export async function readMilestones(
  dir = QUEUE_DIR
): Promise<Record<string, Milestone>> {
  const v = await readQueueFile(dir, "_milestones.json");
  const out: Record<string, Milestone> = {};
  if (!isRecord(v)) {
    return out;
  }
  for (const [id, m] of Object.entries(v)) {
    if (isRecord(m)) {
      out[id] = {
        date: str(m.date) ?? "",
        name: str(m.name) ?? id,
        owner: str(m.owner) ?? "",
      };
    }
  }
  return out;
}

/** The candidates ingest weighed, dropping any that names no feature. */
function candidates(v: unknown): UnsortedItem["candidates"] {
  return (Array.isArray(v) ? v : [])
    .filter(isRecord)
    .map((c) => ({
      feature: str(c.feature) ?? "",
      how: str(c.how) ?? "",
      why: str(c.why) ?? "",
    }))
    .filter((c) => c.feature);
}

/** One queue entry, or null when the record names nothing that could be decided. */
function parseUnsorted(r: unknown): UnsortedItem | null {
  if (!isRecord(r)) {
    return null;
  }
  const id = str(r.id);
  if (!id) {
    return null;
  }
  return {
    at: str(r.at) ?? "",
    candidates: candidates(r.candidates),
    features: Array.isArray(r.features) ? strs(r.features) : undefined,
    id,
    kind: r.kind === "landing" ? "landing" : "slack",
    needs: str(r.needs),
    source: source(r.source),
    suggest: str(r.suggest) ?? null,
    summary: str(r.summary) ?? "",
    text: str(r.text),
    to: strs(r.to),
    why: str(r.why),
  };
}

/** The corrections queue, newest first — the order the Unsorted page lists it in (AC3). */
export async function readUnsorted(dir = QUEUE_DIR): Promise<UnsortedItem[]> {
  const v = await readQueueFile(dir, "_unsorted.json");
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
const SCHEME_RE = /^[a-z]+:/i;

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
 * is what makes the same record render correctly from `marauder/` and from a feature.
 */
export function routeFor(
  href: string,
  base: string,
  roots: AppRoot[]
): string | undefined {
  if (SCHEME_RE.test(href) || href.startsWith("/") || href.startsWith("#")) {
    return undefined;
  }
  const path = normalise(`${base}/${href}`);
  const encode = (p: string) => p.split("/").map(encodeURIComponent).join("/");

  const day = path.match(DAY_RE);
  if (day) {
    return `/${day[1]}/${day[2]}`;
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
  // The page beside a feature's docs opens on the feature page (ARG-167 AC2).
  if (rest.endsWith(`/${FEATURE_PAGE}`)) {
    return `/features/${encode(rest.slice(0, -(FEATURE_PAGE.length + 1)))}`;
  }
  return undefined;
}

/** The route a feature's page is served on. */
export const featureRoute = (feature: string) =>
  `/features/${feature.split("/").map(encodeURIComponent).join("/")}`;

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

const hasLink = (nodes: InlineNode[]): boolean =>
  nodes.some(
    (n) =>
      n.type === "link" ||
      ("children" in n &&
        Array.isArray(n.children) &&
        hasLink(n.children as InlineNode[]))
  );

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

/** Is this block a name standing on its own — a heading, or a paragraph of one bold run? */
function nameOf(node: BlockNode): string | undefined {
  const kids = (
    "children" in node && Array.isArray(node.children) ? node.children : []
  ) as InlineNode[];
  if (hasLink(kids)) {
    return undefined;
  }
  if (node.type === "heading") {
    return inlineText(kids).trim();
  }
  const [only] = kids;
  return node.type === "paragraph" &&
    kids.length === 1 &&
    only?.type === "strong"
    ? inlineText(only.children as InlineNode[]).trim()
    : undefined;
}

/**
 * The board writes a feature's name as a heading or a bold line of its own. argus links
 * it to the feature's page when it knows the app; where it did not, the line becomes a link
 * here — but only when a feature of that name exists, so a bold word, or a name for
 * something renamed since, is left alone rather than linked to a 404.
 */
function linkNames(
  doc: MarkdownDocument,
  features: FeatureRef[]
): MarkdownDocument {
  const byName = new Map(features.map((f) => [f.name, f.feature]));
  return {
    ...doc,
    children: doc.children.map((node) => {
      const name = nameOf(node);
      const feature = name ? byName.get(name) : undefined;
      if (!feature) {
        return node;
      }
      return {
        ...node,
        children: [
          {
            children: (node as { children: InlineNode[] }).children,
            href: featureRoute(feature),
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
  features?: FeatureRef[];
  roots?: AppRoot[];
}

/** One rendered page parsed, with its links pointed at the routes that serve them. */
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
  const features = sources.features ?? (await listFeatures(roots));
  const base = sources.base ?? (relative(WORKSPACE_DIR, dir) || "marauder");
  // The page names itself in its own header, as every other page here does.
  const parsed = dropTitle(parseMarkdown(raw, { headingIds: true }));
  const doc = linkNames(linkFilesToRoutes(parsed, base, roots), features);
  doc.headings = outline(doc);
  return { doc, frontmatter: {}, path: `${base}/${file}` };
}

/** The board — `marauder/board.md` — or null when no run has written one yet. */
export function readBoard(
  dir = MARAUDER_DIR,
  sources: PageSources = {}
): Promise<Rendered | null> {
  return readPage("board.md", dir, sources);
}

/** One feature: where it is, the page argus rendered beside its docs, and its record. */
export interface FeatureFound extends FeatureRef {
  page: Rendered | null;
  work: Work | null;
}

/**
 * One feature's page — `<app>/features/<dir>/board.md` — with the record behind it. A
 * directory that is not a feature, or one with neither a page nor a record, is nothing; a
 * key with a `..` segment is refused before any path is built (AC2).
 */
export async function readFeature(
  feature: string,
  sources: Omit<PageSources, "base"> = {}
): Promise<FeatureFound | null> {
  if (!isFeature(feature)) {
    return null;
  }
  const roots = sources.roots ?? (await listApps());
  const features = sources.features ?? (await listFeatures(roots));
  const ref = features.find((f) => f.feature === feature);
  const dir = ref ? featurePath(ref, roots) : undefined;
  if (!(ref && dir)) {
    return null;
  }
  const [page, work] = await Promise.all([
    readPage(FEATURE_PAGE, dir, {
      base: `${ref.app}/features/${feature}`,
      features,
      roots,
    }),
    readWork(ref, roots),
  ]);
  return page || work ? { ...ref, page, work } : null;
}

// ── apply: the click takes effect at the click (ARG-169) ───────────────────────

/** What one `marauder apply` run answered — `note` is argus's last stderr line when it did not apply. */
export interface ApplyResult {
  applied: boolean;
  note?: string;
}

export const APPLY_COMMAND = ["bun", "run", "marauder", "apply"] as const;
export const APPLY_TIMEOUT_MS = 30_000;

const LATER = "the next sweep will apply it";

/** The last non-empty line of a stream's text — argus prints its one-line result there. */
const lastLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);

/**
 * Run `marauder apply` in the workspace so a verdict just written takes effect now. The
 * verb is argus's code in argus's checkout, under the lock the sweep also holds (ARG-168),
 * so this app still writes nothing but the decision file. It never throws: a busy lock, a
 * failing run, a timeout or a missing `bun` all answer `applied: false` with a note, and
 * the file stays on disk for the next sweep — today's behaviour as the fallback.
 */
export async function applyDecisions(
  cmd: readonly string[] = APPLY_COMMAND,
  { cwd = WORKSPACE_DIR, timeout = APPLY_TIMEOUT_MS } = {}
): Promise<ApplyResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([...cmd], {
      cwd,
      env: process.env,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
      timeout,
    });
  } catch (e) {
    const missing = (e as { code?: string }).code === "ENOENT";
    return {
      applied: false,
      note: missing
        ? `${cmd[0]} was not found on the server's PATH — ${LATER}`
        : `${(e as Error).message} — ${LATER}`,
    };
  }
  const [code, err] = await Promise.all([
    proc.exited,
    new Response(proc.stderr as ReadableStream).text(),
  ]);
  if (code === 0) {
    return { applied: true };
  }
  if (proc.signalCode) {
    return {
      applied: false,
      note: `marauder apply took longer than ${Math.round(timeout / 1000)} s — ${LATER}`,
    };
  }
  return {
    applied: false,
    note: `${lastLine(err) ?? `marauder apply exited ${code}`} — ${LATER}`,
  };
}
