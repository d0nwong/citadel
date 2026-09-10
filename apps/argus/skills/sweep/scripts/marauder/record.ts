#!/usr/bin/env bun
/**
 * The feature record (ARG-164).
 *
 * The feature is the unit. Its dual-tier docs under `<app>/features/<dir>/docs/` are what
 * is true, its journal is why, and `work.json` beside them is what is going on in it, if
 * anything: the keys an arriving event attaches by, the questions still open, and the
 * events themselves. A feature with nothing going on has no `work.json`, and that is not a
 * problem. Linear carries a ticket's status; nothing here keeps a stage.
 *
 * What attached to nothing waits in `queue/_unsorted.json`, the dates the team set in
 * `queue/_milestones.json`, and the Slack cursor in `queue/.state.json`.
 *
 * This module owns the shape and nothing else: the types, the readers, the validator, and
 * the one serializer every writer goes through so a `git diff` of a `work.json` stays the
 * review surface. Ingest, corrections and rendering are their own files.
 */

import { join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import { appRoots } from "../../../../scripts/lib/journal.ts";
import { featureDir, type Feature } from "../../../../scripts/lib/manifest.ts";

// ---------------------------------------------------------------- the vocabulary

/** the reader: `you` everywhere a page addresses them, their own name where it names them */
export const USER = { token: "you", name: "Liam Leung" };

/** the two sides a landing can arrive on; an event says which, a record keeps no stage */
export const SIDES = ["fe", "be"] as const;
export type Side = (typeof SIDES)[number];

/** what an event is, as a closed set; the action a kind licenses is the ticket pass's table, not this file's */
export const EVENT_KINDS = [
  "answers-question",
  "contract-change",
  "claimed-landing",
  "verified-landing",
  "new-ask",
  "directed-at-person",
  "deadline",
  "chat",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** the rung of the attachment ladder that put this event here */
export const ATTACH_HOWS = ["thread", "ref", "vocab", "read", "human"] as const;
export type AttachHow = (typeof ATTACH_HOWS)[number];

export const CONFIDENCES = ["certain", "likely", "guess"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SOURCE_TYPES = ["pr", "slack", "huddle", "ticket", "journal"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// ---------------------------------------------------------------- the record

export type EventSource = {
  type: SourceType;
  /** `fe#417`, a Slack `ts`, `ALD-2`, a journal path — whatever identifies the thing */
  ref: string;
  url?: string;
  sha?: string;
};

/** `human` is what a correction writes, and it carries who made it */
export type Attachment = { how: AttachHow; confidence: Confidence; by?: string };

export type WorkEvent = {
  /** an ISO instant when the minute is known, a plain `YYYY-MM-DD` when only the day is */
  at: string;
  kind: EventKind;
  side?: Side;
  summary: string;
  /** who an ask is aimed at; `you` is the user, and the board's Needs you reads this */
  to?: string[];
  source?: EventSource;
  attached: Attachment;
  ticket?: string;
  /** the journal entry that holds the why, relative to the workspace root */
  evidence?: string;
  /** what this event did to the record, in the record's own words */
  action?: string;
};

export type OpenQuestion = {
  q: string;
  asked_by: string;
  at: string;
  /** the exact Pending bullet on `ticket` this question is waiting on, once someone paired them */
  pending_ref?: string;
  /** whose move it is; `you` is the user, and the board's Needs you reads this */
  owner?: string;
  ticket?: string;
};

/** the keys an event attaches by, deterministically, before anyone reads anything */
export type WorkKeys = {
  tickets: string[];
  prs: string[];
  threads: string[];
  vocab: string[];
};

export type Work = {
  /** the feature's directory under its app's `features/` — `admin/invoicing`, `tasks` */
  feature: string;
  keys: WorkKeys;
  milestone?: string | null;
  open_questions: OpenQuestion[];
  events: WorkEvent[];
  updated: string;
};

export type Milestone = { name: string; date: string; owner: string };
export type Milestones = Record<string, Milestone>;

/** a feature the ladder can attach to: every directory under an app's `features/` that is one */
export type FeatureRef = {
  feature: string;
  /** relative to the workspace root — `alden/alden-portal`, `pensieve` */
  app: string;
  /** the manifest id, when the app's manifest names this directory */
  id?: string;
  /** the manifest's name for it — what a page calls the feature */
  name?: string;
  /** the manifest's words for it — the vocabulary the ladder reads beside the learned keys */
  aliases: string[];
};

export type Candidate = { feature: string; how: AttachHow; why: string };

/** an event that attached to nothing, or to more than one feature — the corrections queue */
export type UnsortedItem = {
  id: string;
  kind: "landing" | "slack";
  summary: string;
  /** the features a reader would look at first, when the item did not name one */
  features?: string[];
  /** the item as it was said, so a correction can learn its vocabulary */
  text?: string;
  /** who an ask is aimed at; `you` is the user, and the board's Needs you reads this */
  to?: string[];
  source?: EventSource;
  candidates: Candidate[];
  /** why it is here at all, when no candidate says it */
  why?: string;
  suggest: string | null;
  /** what the script wants done: read it against the features (or, for a huddle's notes, read them and run `marauder huddle`), or ask a person */
  needs?: "read" | "ask";
  at: string;
};

/** everything the verbs read and write, loaded once per run */
export type State = { work: Work[]; unsorted: UnsortedItem[]; milestones: Milestones; features: FeatureRef[] };

// ---------------------------------------------------------------- reading and writing

/** A name to a slug: lowercased, runs of non-alphanumerics to one `-`, trimmed. Milestone ids use it. */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const QUEUE_DIR = "queue";
export const MILESTONES_FILE = "_milestones.json";
export const UNSORTED_FILE = "_unsorted.json";
export const WORK_FILE = "work.json";

/** the file's key order, so two writers produce the same bytes and a diff reads top down */
const KEY_ORDER = ["feature", "keys", "milestone", "open_questions", "events", "updated"] as const;
const KEYS_ORDER = ["tickets", "prs", "threads", "vocab"] as const;
const EVENT_ORDER = ["at", "kind", "side", "summary", "to", "source", "attached", "ticket", "evidence", "action"] as const;
const SOURCE_ORDER = ["type", "ref", "url", "sha"] as const;

const ordered = <T extends object>(value: T, order: readonly string[]): T => {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in value && (value as Record<string, unknown>)[k] !== undefined) out[k] = (value as Record<string, unknown>)[k];
  for (const k of Object.keys(value)) if (!(k in out) && (value as Record<string, unknown>)[k] !== undefined) out[k] = (value as Record<string, unknown>)[k];
  return out as T;
};

/** the one way a record is written: fixed key order, two spaces, trailing newline */
export function serializeWork(w: Work): string {
  const shaped = ordered(
    {
      ...w,
      keys: ordered(w.keys, KEYS_ORDER),
      events: w.events.map((e) => ordered({ ...e, source: e.source ? ordered(e.source, SOURCE_ORDER) : undefined }, EVENT_ORDER)),
    },
    KEY_ORDER,
  );
  return `${JSON.stringify(shaped, null, 2)}\n`;
}

/** an empty record for a feature that had nothing going on until now */
export const emptyWork = (feature: string, at: string): Work => ({
  feature,
  keys: { tickets: [], prs: [], threads: [], vocab: [] },
  open_questions: [],
  events: [],
  updated: at,
});

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Everything wrong with a record, as sentences a person can act on. An empty array means
 * the file is a feature's record; anything else and no reader may use it. `feature` is
 * the directory the file sits in, which the record has to agree with.
 */
export function validate(value: unknown, feature?: string): string[] {
  const p: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the file is not a JSON object"];
  const w = value as Record<string, unknown>;

  for (const k of ["feature", "updated"]) if (!isStr(w[k])) p.push(`${k} is missing`);
  if (feature && isStr(w.feature) && w.feature !== feature) p.push(`feature "${w.feature}" does not match the directory "${feature}"`);
  if (w.milestone !== undefined && w.milestone !== null && !isStr(w.milestone)) p.push("milestone is not a milestone id");

  const keys = w.keys as Record<string, unknown> | undefined;
  if (typeof keys !== "object" || keys === null) p.push("keys is missing");
  else {
    for (const k of KEYS_ORDER) if (!isStrList(keys[k])) p.push(`keys.${k} is missing`);
    for (const k of Object.keys(keys)) if (!(KEYS_ORDER as readonly string[]).includes(k)) p.push(`keys has an unknown list "${k}"`);
  }

  if (!Array.isArray(w.open_questions)) p.push("open_questions is missing");
  else
    for (const [i, q] of w.open_questions.entries()) {
      const o = q as Record<string, unknown>;
      if (!isStr(o.q)) p.push(`open question ${i + 1} has no question`);
      if (!isStr(o.asked_by)) p.push(`open question ${i + 1} has no asked_by`);
      if (!isStr(o.at)) p.push(`open question ${i + 1} has no at`);
    }

  if (!Array.isArray(w.events)) p.push("events is missing");
  else
    for (const [i, e] of w.events.entries()) {
      const ev = e as Record<string, unknown>;
      const at = `event ${i + 1}`;
      if (!isStr(ev.at)) p.push(`${at} has no at`);
      if (!(EVENT_KINDS as readonly string[]).includes(String(ev.kind))) p.push(`${at} has an unknown kind "${String(ev.kind)}"`);
      if (!isStr(ev.summary)) p.push(`${at} has no summary`);
      if (ev.side !== undefined && !(SIDES as readonly string[]).includes(String(ev.side))) p.push(`${at} has an unknown side "${String(ev.side)}"`);
      if (ev.to !== undefined && !isStrList(ev.to)) p.push(`${at} to is not a list of people`);
      if (ev.kind === "directed-at-person" && !isStrList(ev.to)) p.push(`${at} is aimed at someone and does not say who`);
      const a = ev.attached as Record<string, unknown> | undefined;
      if (typeof a !== "object" || a === null) p.push(`${at} has no attached`);
      else {
        if (!(ATTACH_HOWS as readonly string[]).includes(String(a.how))) p.push(`${at} attached.how is "${String(a.how)}", which is not a rung of the ladder`);
        if (!(CONFIDENCES as readonly string[]).includes(String(a.confidence))) p.push(`${at} attached.confidence is "${String(a.confidence)}"`);
        if (a.how === "human" && !isStr(a.by)) p.push(`${at} was attached by hand and does not say by whom`);
      }
      const s = ev.source as Record<string, unknown> | undefined;
      if (s !== undefined) {
        if (!(SOURCE_TYPES as readonly string[]).includes(String(s.type))) p.push(`${at} source.type is "${String(s.type)}"`);
        if (!isStr(s.ref)) p.push(`${at} source has no ref`);
      }
    }

  for (const k of Object.keys(w)) if (!(KEY_ORDER as readonly string[]).includes(k)) p.push(`unknown field "${k}"`);
  return p;
}

export type ParseResult = { work: Work | null; problems: string[] };

/** one file's text back into the record, with everything wrong with it */
export function parseWork(text: string, feature?: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { work: null, problems: [`the file is not JSON — ${(err as Error).message}`] };
  }
  const problems = validate(value, feature);
  return { work: problems.length ? null : (value as Work), problems };
}

export type LoadResult = {
  work: Work[];
  milestones: Milestones;
  /** files that could not be read, relative to the workspace root */
  problems: { file: string; problems: string[] }[];
};

/** where a feature's record lives, relative to the workspace root */
export const workPath = (app: string, feature: string) => join(app, "features", feature, WORK_FILE);

/** every `work.json` under every app's `features/`, newest update first, with the milestones they point at */
export async function loadWork(root = "."): Promise<LoadResult> {
  const work: Work[] = [];
  const problems: LoadResult["problems"] = [];
  const seen = new Set<string>();
  for (const { dir } of await appRoots(root)) {
    const files: string[] = [];
    for await (const f of new Bun.Glob(`**/${WORK_FILE}`).scan({ cwd: dir, onlyFiles: true })) files.push(f);
    for (const file of files.sort()) {
      const feature = file.slice(0, -`/${WORK_FILE}`.length);
      const rel = relative(root, join(dir, file));
      const parsed = parseWork(await Bun.file(join(dir, file)).text(), feature);
      if (!parsed.work) problems.push({ file: rel, problems: parsed.problems });
      else if (seen.has(feature)) problems.push({ file: rel, problems: [`another app already has a record for ${feature}`] });
      else {
        seen.add(feature);
        work.push(parsed.work);
      }
    }
  }
  return {
    work: work.sort((a, b) => instantOf(b.updated).localeCompare(instantOf(a.updated)) || a.feature.localeCompare(b.feature)),
    milestones: await loadMilestones(root),
    problems,
  };
}

export async function loadMilestones(root = "."): Promise<Milestones> {
  const file = Bun.file(join(root, QUEUE_DIR, MILESTONES_FILE));
  if (!(await file.exists())) return {};
  return (await file.json()) as Milestones;
}

export async function loadUnsorted(root = "."): Promise<UnsortedItem[]> {
  const file = Bun.file(join(root, QUEUE_DIR, UNSORTED_FILE));
  return (await file.exists()) ? ((await file.json()) as UnsortedItem[]) : [];
}

/** the directories inside a feature that are its own, never another feature */
const OWN = new Set(["docs", "journal"]);

/**
 * Every feature of every app: a directory under `features/` holding `docs/`, `journal/`
 * or a `work.json`. Features nest (`admin` has docs, and so does `admin/usage`), so the
 * walk goes on below one; it never goes into a feature's own `docs/` or `journal/`.
 * Pensieve has a feature named `journal`, which sits at the top of its tree and is found.
 */
export async function loadFeatures(root = "."): Promise<FeatureRef[]> {
  const out: FeatureRef[] = [];
  const taken = new Set<string>();
  for (const { app, dir } of await appRoots(root)) {
    const aliases = await manifestAliases(join(root, app));
    const walk = async (rel: string, depth: number) => {
      const here = join(dir, rel);
      const entries = await readdir(here, { withFileTypes: true }).catch(() => []);
      const names = new Set(entries.map((e) => e.name));
      const isFeature = rel !== "" && (names.has("docs") || names.has("journal") || names.has(WORK_FILE));
      if (isFeature && !taken.has(rel)) {
        taken.add(rel);
        const m = aliases.get(rel);
        out.push({ feature: rel, app, ...(m?.id ? { id: m.id } : {}), ...(m?.name ? { name: m.name } : {}), aliases: m?.aliases ?? [] });
      }
      if (depth >= 3) return;
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        if (isFeature && OWN.has(e.name)) continue;
        await walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
      }
    };
    await walk("", 0);
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature));
}

/** the app's manifest, by feature directory: its id, its name and the words people use for it */
async function manifestAliases(appDir: string): Promise<Map<string, { id: string; name?: string; aliases: string[] }>> {
  const file = Bun.file(join(appDir, ".doc-workspace/feature-manifest.json"));
  const out = new Map<string, { id: string; name?: string; aliases: string[] }>();
  if (!(await file.exists())) return out;
  const m = (await file.json()) as { features?: Feature[] };
  for (const f of m.features ?? []) out.set(featureDir(f), { id: f.id, name: f.name, aliases: f.aliases ?? [] });
  return out;
}

/** manifest id → feature directory, across every app, for the journal's and pr-facts' `features:` */
export const dirsById = (features: FeatureRef[]): Record<string, string> =>
  Object.fromEntries(features.filter((f) => f.id).map((f) => [f.id!, f.feature]));

/** the whole state a verb works on: records, queue, milestones and the features they may name */
export async function loadState(root = "."): Promise<State & { problems: LoadResult["problems"] }> {
  const { work, milestones, problems } = await loadWork(root);
  return { work, unsorted: await loadUnsorted(root), milestones, features: await loadFeatures(root), problems };
}

/**
 * Write back what changed between two states and nothing else, so a run that decided
 * nothing writes no byte. A record goes to its feature's directory in the app that has
 * it; a feature no app has is refused rather than invented.
 */
export async function saveState(root: string, before: State, after: State): Promise<string[]> {
  const written: string[] = [];
  const had = new Map(before.work.map((w) => [w.feature, serializeWork(w)]));
  const apps = new Map([...before.features, ...after.features].map((f) => [f.feature, f.app]));
  for (const w of after.work) {
    const text = serializeWork(w);
    if (had.get(w.feature) === text) continue;
    const app = apps.get(w.feature);
    if (!app) throw new Error(`no app has a feature directory ${w.feature}, so its record has nowhere to go`);
    const rel = workPath(app, w.feature);
    await Bun.write(join(root, rel), text);
    written.push(rel);
  }
  for (const [file, value, was] of [
    [UNSORTED_FILE, after.unsorted, before.unsorted],
    [MILESTONES_FILE, after.milestones, before.milestones],
  ] as const) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (text === `${JSON.stringify(was, null, 2)}\n`) continue;
    await Bun.write(join(root, QUEUE_DIR, file), text);
    written.push(`${QUEUE_DIR}/${file}`);
  }
  return written;
}

/** a day-grain `at` is ordered at the end of its day, so a landing follows the chat about it */
export const instantOf = (at: string) => (at.length === 10 ? `${at}T23:59:59Z` : at);

export const byAt = (a: { at: string }, b: { at: string }) => instantOf(a.at).localeCompare(instantOf(b.at));

/** the latest event, by `at`; a record with no event has none */
export const latestEvent = (w: Work): WorkEvent | undefined => [...w.events].sort(byAt).at(-1);

/** how an event is named on the command line: its source, else the instant it happened */
export const eventId = (e: WorkEvent) => e.source?.ref ?? e.at;

/**
 * One name per event, unique inside its record — two rulings out of the same huddle share
 * a source, so the second one gets a counter.
 */
export function eventKeys(w: Work): string[] {
  const counts = new Map<string, number>();
  return w.events.map((e) => {
    const base = eventId(e);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

/** add an event to a record, keeping the events in time order and `updated` at the newest */
export function addEvent(w: Work, e: WorkEvent) {
  w.events = [...w.events, e].sort(byAt);
  if (instantOf(e.at) > instantOf(w.updated)) w.updated = e.at;
}

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const { work, problems } = await loadWork(root);
  for (const p of problems) console.error(`${p.file}: ${p.problems.join("; ")}`);
  console.log(`${work.length} feature${work.length === 1 ? "" : "s"} with something going on${problems.length ? ` · ${problems.length} unreadable` : ""}`);
  process.exit(problems.length ? 1 : 0);
}
