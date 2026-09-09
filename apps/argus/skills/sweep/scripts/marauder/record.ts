#!/usr/bin/env bun
/**
 * The workstream record (LIA-154).
 *
 * A workstream is something a person asks "is that done yet?" about — "History tab:
 * editing asset quantities per billing cycle", "Rollover credits instead of a retainer
 * top-up". Not a PR, not a ticket, not a feature folder. Everything that arrives from
 * Slack or from a base branch is an event on one, and every page a reader sees is
 * rendered from these files alone.
 *
 * One JSON file per workstream under `workstreams/`, plus `workstreams/_milestones.json`
 * for the dates workstreams point at and `workstreams/_unsorted.json` for what attached
 * to nothing. Files starting with `_` are never a workstream.
 *
 * This module owns the shape and nothing else: the type, the readers, the validator, and
 * the one serializer every writer goes through so a `git diff workstreams/` stays the
 * review surface. Ingest, corrections and rendering are their own files.
 */

import { join } from "node:path";

// ---------------------------------------------------------------- the vocabulary

/** the two sides of a piece of work; a workstream records only the sides it has */
export const SIDES = ["fe", "be"] as const;
export type Side = (typeof SIDES)[number];

/**
 * How far one side has got. `landed` is verified by git — FE on `origin/staging`, BE on
 * `origin/dev`. `verified` needs the docs refresh and the user; `shipped` needs the
 * product owner. "Waiting on" and "parked" are overlays, not stages: work waits while it
 * is at some stage, and the board says both.
 */
export const STAGES = ["asked", "decided", "building", "landed", "verified", "shipped"] as const;
export type Stage = (typeof STAGES)[number];
export const stageRank = (s: Stage) => STAGES.indexOf(s);

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
export const ATTACH_HOWS = ["thread", "ref", "vocab", "author", "read", "human"] as const;
export type AttachHow = (typeof ATTACH_HOWS)[number];

export const CONFIDENCES = ["certain", "likely", "guess"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SOURCE_TYPES = ["pr", "slack", "huddle", "ticket", "journal"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

// ---------------------------------------------------------------- the record

export type EventSource = {
  type: SourceType;
  /** `fe#417`, a Slack `ts`, `LIA-116`, a journal path — whatever identifies the thing */
  ref: string;
  url?: string;
  sha?: string;
};

/** `human` is what a correction writes, and it carries who made it */
export type Attachment = { how: AttachHow; confidence: Confidence; by?: string };

export type WorkstreamEvent = {
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
  /** whose move it is; `you` is the user, and the board's Needs you reads this */
  owner?: string;
  ticket?: string;
};

export type Fact = {
  fact: string;
  evidence?: string;
  /** `dev@bbc394b7`, `staging@ac1caffd6` — the ref and sha the fact was read at */
  verified?: string;
};

/** the keys an event attaches by, deterministically, before anyone reads anything */
export type WorkstreamKeys = {
  tickets: string[];
  prs: string[];
  threads: string[];
  vocab: string[];
  people: string[];
};

export type Overlay = { waiting_on: string; for: string; since: string };

export type Workstream = {
  slug: string;
  name: string;
  features: string[];
  driver?: string;
  wants: string[];
  done: string;
  stage: Partial<Record<Side, Stage>>;
  overlay?: Overlay | null;
  parked: boolean;
  milestone?: string | null;
  keys: WorkstreamKeys;
  open_questions: OpenQuestion[];
  facts: Fact[];
  events: WorkstreamEvent[];
  opened: string;
  updated: string;
};

export type Milestone = { name: string; date: string; owner: string };
export type Milestones = Record<string, Milestone>;

/** an event that attached to nothing, or to more than one thing — the corrections queue */
export type UnsortedItem = {
  id: string;
  kind: "landing" | "slack";
  summary: string;
  /** who an ask is aimed at; `you` is the user, and the board's Needs you reads this */
  to?: string[];
  source?: EventSource;
  candidates: { slug: string; how: AttachHow; why: string }[];
  suggest: string | null;
  /** what the script wants done: read it against the open list, or ask a person */
  needs?: "read" | "ask";
  at: string;
};

// ---------------------------------------------------------------- reading and writing

export const WORKSTREAMS_DIR = "workstreams";
export const MILESTONES_FILE = "_milestones.json";
export const UNSORTED_FILE = "_unsorted.json";

/** the file's key order, so two writers produce the same bytes and a diff reads top down */
const KEY_ORDER = [
  "slug", "name", "features", "driver", "wants", "done", "stage", "overlay", "parked",
  "milestone", "keys", "open_questions", "facts", "events", "opened", "updated",
] as const;
const KEYS_ORDER = ["tickets", "prs", "threads", "vocab", "people"] as const;
const EVENT_ORDER = ["at", "kind", "side", "summary", "to", "source", "attached", "ticket", "evidence", "action"] as const;
const SOURCE_ORDER = ["type", "ref", "url", "sha"] as const;

const ordered = <T extends object>(value: T, order: readonly string[]): T => {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in value && (value as Record<string, unknown>)[k] !== undefined) out[k] = (value as Record<string, unknown>)[k];
  for (const k of Object.keys(value)) if (!(k in out) && (value as Record<string, unknown>)[k] !== undefined) out[k] = (value as Record<string, unknown>)[k];
  return out as T;
};

/** the one way a workstream is written: fixed key order, two spaces, trailing newline */
export function serializeWorkstream(w: Workstream): string {
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

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * Everything wrong with a record, as sentences a person can act on. An empty array means
 * the file is a workstream; anything else and no reader may use it.
 */
export function validate(value: unknown, slug?: string): string[] {
  const p: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the file is not a JSON object"];
  const w = value as Record<string, unknown>;

  for (const k of ["slug", "name", "done", "opened", "updated"]) if (!isStr(w[k])) p.push(`${k} is missing`);
  if (isStr(w.slug) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(w.slug)) p.push(`slug "${w.slug}" is not lower-case-and-hyphens`);
  if (slug && isStr(w.slug) && w.slug !== slug) p.push(`slug "${w.slug}" does not match the file name "${slug}"`);
  if (!isStrList(w.features)) p.push("features is missing");
  if (!isStrList(w.wants)) p.push("wants is missing");
  if (has(w, "driver") && w.driver !== undefined && !isStr(w.driver)) p.push("driver is not a name");
  if (typeof w.parked !== "boolean") p.push("parked is missing");

  const stage = w.stage as Record<string, unknown> | undefined;
  if (typeof stage !== "object" || stage === null) p.push("stage is missing");
  else {
    const sides = Object.keys(stage);
    if (!sides.length) p.push("stage names no side");
    for (const s of sides) {
      if (!(SIDES as readonly string[]).includes(s)) p.push(`stage has an unknown side "${s}"`);
      else if (!(STAGES as readonly string[]).includes(String(stage[s]))) p.push(`stage.${s} is "${String(stage[s])}", which is not a stage`);
    }
  }

  if (w.overlay !== undefined && w.overlay !== null) {
    const o = w.overlay as Record<string, unknown>;
    for (const k of ["waiting_on", "for", "since"]) if (!isStr(o[k])) p.push(`overlay.${k} is missing`);
  }

  const keys = w.keys as Record<string, unknown> | undefined;
  if (typeof keys !== "object" || keys === null) p.push("keys is missing");
  else {
    for (const k of KEYS_ORDER) if (!isStrList(keys[k])) p.push(`keys.${k} is missing`);
    const attachable = KEYS_ORDER.filter((k) => k !== "vocab" && k !== "people")
      .reduce((n, k) => n + (isStrList(keys[k]) ? (keys[k] as string[]).length : 0), 0);
    if (!attachable) p.push("keys names no ticket, PR or thread, so nothing can attach to it");
  }

  for (const [i, q] of (Array.isArray(w.open_questions) ? w.open_questions : []).entries()) {
    const o = q as Record<string, unknown>;
    if (!isStr(o.q)) p.push(`open question ${i + 1} has no question`);
    if (!isStr(o.asked_by)) p.push(`open question ${i + 1} has no asked_by`);
    if (!isStr(o.at)) p.push(`open question ${i + 1} has no at`);
  }
  if (!Array.isArray(w.open_questions)) p.push("open_questions is missing");
  if (!Array.isArray(w.facts)) p.push("facts is missing");

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

export type ParseResult = { workstream: Workstream | null; problems: string[] };

/** one file's text back into the record, with everything wrong with it */
export function parseWorkstream(text: string, slug?: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { workstream: null, problems: [`the file is not JSON — ${(err as Error).message}`] };
  }
  const problems = validate(value, slug);
  return { workstream: problems.length ? null : (value as Workstream), problems };
}

export type LoadResult = {
  workstreams: Workstream[];
  milestones: Milestones;
  /** files that could not be read, by file name */
  problems: { file: string; problems: string[] }[];
};

const slugOf = (file: string) => file.replace(/\.json$/, "");

/** every workstream under `dir`, newest update first, with the milestones they point at */
export async function loadWorkstreams(root = ".", dir = WORKSTREAMS_DIR): Promise<LoadResult> {
  const base = join(root, dir);
  const workstreams: Workstream[] = [];
  const problems: LoadResult["problems"] = [];
  const files: string[] = [];
  for await (const f of new Bun.Glob("*.json").scan({ cwd: base, onlyFiles: true })) files.push(f);
  for (const file of files.sort()) {
    if (file.startsWith("_")) continue;
    const parsed = parseWorkstream(await Bun.file(join(base, file)).text(), slugOf(file));
    if (parsed.workstream) workstreams.push(parsed.workstream);
    else problems.push({ file, problems: parsed.problems });
  }
  return {
    workstreams: workstreams.sort((a, b) => b.updated.localeCompare(a.updated) || a.slug.localeCompare(b.slug)),
    milestones: await loadMilestones(root, dir),
    problems,
  };
}

export async function loadMilestones(root = ".", dir = WORKSTREAMS_DIR): Promise<Milestones> {
  const file = Bun.file(join(root, dir, MILESTONES_FILE));
  if (!(await file.exists())) return {};
  return (await file.json()) as Milestones;
}

/** a day-grain `at` is ordered at the end of its day, so a landing follows the chat about it */
export const instantOf = (at: string) => (at.length === 10 ? `${at}T23:59:59Z` : at);

/** the latest event, by `at`; a workstream with no event has none */
export const latestEvent = (w: Workstream): WorkstreamEvent | undefined =>
  [...w.events].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at))).at(-1);

/** the sides this workstream records, in FE-then-BE order */
export const sidesOf = (w: Workstream): Side[] => SIDES.filter((s) => w.stage[s] !== undefined);

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const { workstreams, problems } = await loadWorkstreams(root);
  for (const p of problems) console.error(`${p.file}: ${p.problems.join("; ")}`);
  console.log(`${workstreams.length} workstream${workstreams.length === 1 ? "" : "s"}${problems.length ? ` · ${problems.length} unreadable` : ""}`);
  process.exit(problems.length ? 1 : 0);
}
