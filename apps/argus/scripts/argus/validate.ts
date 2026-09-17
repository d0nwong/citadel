/**
 * The policy, as code. Everything a ledger must satisfy beyond its shape: evidence on every
 * claim, `assumption` only where an assumption is allowed, ids unique and never reused,
 * references that resolve, `ready` derived honestly, statuses that agree with their
 * history, the three mechanical style rules from `skills/sweep/style.md` on every sentence
 * a reader sees, and `as_of` that never goes backwards. Because these are checked here, no
 * skill has to say them.
 *
 * `validateLedger` returns every problem; `assertLedger` throws the lot. `validateDoc` is
 * the one rule on the arch tier, its length.
 */

import { ungroundedNotes } from "./grounding.ts";
import { ASK_DONE, type Ask, type Evidence, type Ledger, parseLedger, SchemaError } from "./schema.ts";

export type Problem = { path: string; rule: string };

export class ValidationError extends Error {
  constructor(public readonly problems: Problem[]) {
    super(problems.map((p) => `${p.path}: ${p.rule}`).join("\n"));
    this.name = "ValidationError";
  }
}

export type ValidateOptions = {
  /** the ledger as it was before this write; enables the id, `as_of` and `user`-evidence rules */
  prev?: Ledger | null;
  /** who produced `next`; the model may not write `user` evidence */
  actor?: "model" | "user";
};

// ---------------------------------------------------------------- style (skills/sweep/style.md, the three mechanical rules)

export const BANNED_WORDS = ["tick", "ticks", "tier", "tiers", "arc", "arcs", "supersedes", "corroborated"];
export const BANNED_PREFIXES = ["BR-", "MM-"];
export const SENTENCE_WORDS = 25;
const ID_AT_START = /^((?:ARG|ALD|LIA)-\d+|fe#\d+|be#\d+|BR-[A-Za-z0-9-]+|MM-\d+|[RAP]-\d+)\b/;

/** the problems in one piece of reader-facing text */
export function checkStyle(text: string, path: string): Problem[] {
  const out: Problem[] = [];
  const t = text.trim();
  if (!t) return out;
  if (ID_AT_START.test(t)) out.push({ path, rule: "reader text starts with an id; ids belong on the evidence line" });
  const lower = t.toLowerCase();
  for (const w of BANNED_WORDS)
    if (new RegExp(`\\b${w}\\b`).test(lower)) out.push({ path, rule: `"${w}" is the system's own dialect` });
  for (const p of BANNED_PREFIXES)
    if (t.includes(p)) out.push({ path, rule: `"${p}" is a rule id, and belongs on the evidence line` });
  for (const s of t.split(/(?<=[.!?])\s+/)) {
    const words = s.split(/\s+/).filter(Boolean).length;
    if (words > SENTENCE_WORDS) out.push({ path, rule: `${words} words, over the ${SENTENCE_WORDS}-word ceiling` });
  }
  return out;
}

// ---------------------------------------------------------------- ids

const NAMESPACES = { R: "requirements", A: "asks", P: "proposals" } as const;
type Namespace = keyof typeof NAMESPACES;

const idNumber = (id: string) => Number(id.slice(2));
const wellFormed = (id: string, ns: Namespace) => new RegExp(`^${ns}-[1-9]\\d*$`).test(id);
const maxId = (ids: Iterable<string>) => Math.max(0, ...[...ids].map(idNumber));

function idsOf(l: Ledger, ns: Namespace): string[] {
  return l[NAMESPACES[ns]].map((e) => e.id);
}

// ---------------------------------------------------------------- the rules

function hasEvidence(ev: Evidence[], path: string, out: Problem[]) {
  if (ev.length === 0) out.push({ path, rule: "no evidence; every claim carries at least one pointer" });
}

function noAssumption(ev: Evidence[], path: string, out: Problem[]) {
  ev.forEach((e, i) => {
    if (e.kind === "assumption") out.push({ path: `${path}[${i}]`, rule: "assumption is not evidence here" });
  });
}

/** the `user` evidence items in a ledger, keyed by where they sit */
function userEvidence(l: Ledger): Map<string, Evidence> {
  const m = new Map<string, Evidence>();
  const walk = (ev: Evidence[], path: string) =>
    ev.forEach((e, i) => {
      if (e.kind === "user") m.set(`${path}[${i}]`, e);
    });
  l.requirements.forEach((r, i) => walk(r.evidence, `ledger.requirements[${i}].evidence`));
  l.asks.forEach((a, i) => {
    a.history.forEach((h, j) => walk(h.evidence, `ledger.asks[${i}].history[${j}].evidence`));
    (a.blockers ?? []).forEach((b, j) => b.cleared && walk(b.cleared.evidence, `ledger.asks[${i}].blockers[${j}].cleared.evidence`));
  });
  l.tickets.forEach((t, i) => {
    t.blockers.forEach((b, j) => b.cleared && walk(b.cleared.evidence, `ledger.tickets[${i}].blockers[${j}].cleared.evidence`));
    if (t.settled) walk(t.settled.evidence, `ledger.tickets[${i}].settled.evidence`);
  });
  for (const k of Object.keys(l.story) as (keyof Ledger["story"])[]) walk(l.story[k].evidence, `ledger.story.${k}.evidence`);
  return m;
}

export function validateLedger(input: unknown, opts: ValidateOptions = {}): Problem[] {
  let l: Ledger;
  try {
    l = parseLedger(input);
  } catch (e) {
    if (e instanceof SchemaError) return [{ path: e.path, rule: e.message.slice(e.path.length + 2) }];
    throw e;
  }
  const out: Problem[] = [];
  const { prev = null, actor = "model" } = opts;

  // story: text needs evidence; assumption allowed; style
  for (const k of Object.keys(l.story) as (keyof Ledger["story"])[]) {
    const s = l.story[k];
    const path = `ledger.story.${k}`;
    if (s.text.trim()) hasEvidence(s.evidence, `${path}.evidence`, out);
    out.push(...checkStyle(s.text, `${path}.text`));
  }
  out.push(...checkStyle(l.summary, "ledger.summary"));

  // requirements
  const reqIds = new Set<string>();
  l.requirements.forEach((r, i) => {
    const path = `ledger.requirements[${i}]`;
    if (!wellFormed(r.id, "R")) out.push({ path: `${path}.id`, rule: "expected R-<n>" });
    if (reqIds.has(r.id)) out.push({ path: `${path}.id`, rule: `${r.id} appears twice` });
    reqIds.add(r.id);
    hasEvidence(r.evidence, `${path}.evidence`, out);
    if (r.status !== "assumed") noAssumption(r.evidence, `${path}.evidence`, out);
    out.push(...checkStyle(r.text, `${path}.text`));
  });

  // asks
  const askIds = new Set<string>();
  const ticketKeys = new Set(l.tickets.map((t) => t.key));
  l.asks.forEach((a, i) => {
    const path = `ledger.asks[${i}]`;
    if (!wellFormed(a.id, "A")) out.push({ path: `${path}.id`, rule: "expected A-<n>" });
    if (askIds.has(a.id)) out.push({ path: `${path}.id`, rule: `${a.id} appears twice` });
    askIds.add(a.id);
    out.push(...checkStyle(a.text, `${path}.text`));
    a.history.forEach((h, j) => {
      hasEvidence(h.evidence, `${path}.history[${j}].evidence`, out);
      noAssumption(h.evidence, `${path}.history[${j}].evidence`, out);
    });
    const last = a.history.at(-1);
    if (last && last.status !== a.status)
      out.push({ path: `${path}.status`, rule: `status is ${a.status} but the last history entry says ${last.status}` });
    if (!last && a.status !== "asked")
      out.push({ path: `${path}.status`, rule: `status is ${a.status} with no history to show how` });
    for (const r of a.requirements ?? [])
      if (!reqIds.has(r)) out.push({ path: `${path}.requirements`, rule: `${r} is not a requirement in this ledger` });
    (a.blockers ?? []).forEach((b, j) => {
      if (b.cleared) {
        hasEvidence(b.cleared.evidence, `${path}.blockers[${j}].cleared.evidence`, out);
        noAssumption(b.cleared.evidence, `${path}.blockers[${j}].cleared.evidence`, out);
      }
    });
    if (a.blockers?.length) {
      const derived = a.blockers.every((b) => b.cleared !== null);
      if (a.ready !== derived)
        out.push({ path: `${path}.ready`, rule: derived ? "every blocker is cleared, so ready must be true" : "a blocker is not cleared, so ready must be false" });
    } else if (a.ready !== undefined) out.push({ path: `${path}.ready`, rule: "ready is only set on an ask with blockers" });
    if (a.ticket && !ticketKeys.has(a.ticket))
      out.push({ path: `${path}.ticket`, rule: `${a.ticket} is not a ticket in this ledger` });
  });

  // tickets
  const seenKeys = new Set<string>();
  l.tickets.forEach((t, i) => {
    const path = `ledger.tickets[${i}]`;
    if (seenKeys.has(t.key)) out.push({ path: `${path}.key`, rule: `${t.key} appears twice` });
    seenKeys.add(t.key);
    for (const a of t.asks) if (!askIds.has(a)) out.push({ path: `${path}.asks`, rule: `${a} is not an ask in this ledger` });
    t.blockers.forEach((b, j) => {
      if (b.cleared) {
        hasEvidence(b.cleared.evidence, `${path}.blockers[${j}].cleared.evidence`, out);
        noAssumption(b.cleared.evidence, `${path}.blockers[${j}].cleared.evidence`, out);
      }
    });
    if (t.settled) {
      hasEvidence(t.settled.evidence, `${path}.settled.evidence`, out);
      noAssumption(t.settled.evidence, `${path}.settled.evidence`, out);
      for (const a of l.asks)
        if ((t.asks.includes(a.id) || a.ticket === t.key) && a.status !== "closed" && a.status !== "dropped")
          out.push({ path: `${path}.settled`, rule: `${t.key} is settled but ${a.id} is still ${a.status}` });
    }
    const derived = t.blockers.every((b) => b.cleared !== null);
    if (t.ready !== derived)
      out.push({ path: `${path}.ready`, rule: derived ? "every blocker is cleared, so ready must be true" : "a blocker is not cleared, so ready must be false" });
  });

  // landings and proposals reference asks
  l.landings.forEach((ld, i) => {
    for (const a of ld.asks) if (!askIds.has(a)) out.push({ path: `ledger.landings[${i}].asks`, rule: `${a} is not an ask in this ledger` });
  });
  const propIds = new Set<string>();
  l.proposals.forEach((p, i) => {
    const path = `ledger.proposals[${i}]`;
    if (!wellFormed(p.id, "P")) out.push({ path: `${path}.id`, rule: "expected P-<n>" });
    if (propIds.has(p.id)) out.push({ path: `${path}.id`, rule: `${p.id} appears twice` });
    propIds.add(p.id);
    for (const a of p.asks) if (!askIds.has(a)) out.push({ path: `${path}.asks`, rule: `${a} is not an ask in this ledger` });
  });

  // a proposal a write adds or rewrites names a file on every Technical Notes bullet; what
  // is already on disk is judged when it was written
  const prevBodies = new Map((prev?.proposals ?? []).map((p) => [p.id, p.body]));
  l.proposals.forEach((p, i) => {
    if (!prev || prevBodies.get(p.id) === p.body) return;
    for (const n of ungroundedNotes(p.body))
      out.push({ path: `ledger.proposals[${i}].body`, rule: `${p.id || "a new proposal"}: a Technical Notes bullet names no file: "${n.slice(0, 60)}"` });
  });

  // against the previous ledger
  if (prev) {
    if (l.feature !== prev.feature) out.push({ path: "ledger.feature", rule: `was ${prev.feature}` });
    if (l.as_of < prev.as_of) out.push({ path: "ledger.as_of", rule: `${l.as_of} is older than the previous ${prev.as_of}` });

    for (const ns of ["R", "A"] as Namespace[]) {
      const before = new Set(idsOf(prev, ns));
      const after = new Set(idsOf(l, ns));
      const max = Math.max(maxId(before), prev.ids?.[ns] ?? 0);
      for (const id of before)
        if (!after.has(id))
          out.push({ path: `ledger.${NAMESPACES[ns]}`, rule: `${id} was in the previous ledger and is gone; ${ns === "R" ? "retire" : "drop"} it instead` });
      for (const id of after)
        if (!before.has(id) && idNumber(id) <= max)
          out.push({ path: `ledger.${NAMESPACES[ns]}`, rule: `${id} is new but not above the previous highest ${ns}-${max}; ids are never reused` });
    }
    const prevP = Math.max(maxId(idsOf(prev, "P")), prev.ids?.P ?? 0);
    const beforeP = new Set(idsOf(prev, "P"));
    for (const id of idsOf(l, "P"))
      if (!beforeP.has(id) && idNumber(id) <= prevP)
        out.push({ path: "ledger.proposals", rule: `${id} is new but not above the previous highest P-${prevP}; ids are never reused` });

    const prevAsks = new Map(prev.asks.map((a) => [a.id, a]));
    l.asks.forEach((a, i) => {
      const was = prevAsks.get(a.id);
      if (was && JSON.stringify(was.origin) !== JSON.stringify(a.origin))
        out.push({ path: `ledger.asks[${i}].origin`, rule: `${a.id} changed origin; that is a different ask and needs a new id` });
      if (was && ASK_DONE.includes(was.status) && !ASK_DONE.includes(a.status) && actor === "model")
        out.push({ path: `ledger.asks[${i}].status`, rule: `${a.id} was ${was.status}; only the user reopens an ask` });
    });
  }

  // the model never writes `user` evidence
  if (actor === "model") {
    const before = prev ? new Set([...userEvidence(prev).values()].map((e) => JSON.stringify(e))) : new Set<string>();
    for (const [path, e] of userEvidence(l))
      if (!before.has(JSON.stringify(e))) out.push({ path, rule: "user evidence is written by a click or a CLI verb, never by the model" });
  }

  return out;
}

export function assertLedger(input: unknown, opts: ValidateOptions = {}): Ledger {
  const problems = validateLedger(input, opts);
  if (problems.length) throw new ValidationError(problems);
  return parseLedger(input);
}

/** derive `ready` for every ticket; what `write` runs before validating */
export function deriveReady(l: Ledger): Ledger {
  return {
    ...l,
    tickets: l.tickets.map((t) => ({ ...t, ready: t.blockers.every((b) => b.cleared !== null) })),
    asks: l.asks.map((a) => {
      if (!a.blockers?.length) {
        const { ready: _r, ...rest } = a;
        return rest;
      }
      return { ...a, ready: a.blockers.every((b) => b.cleared !== null) };
    }),
  };
}

/** whether an ask still needs somebody */
export const isOpen = (a: Ask) => !ASK_DONE.includes(a.status);

// ---------------------------------------------------------------- the arch tier

export const ARCH_MAX_LINES = 250;

/** the doc's curated lines: everything outside the regions `accio sync` generates and the front matter */
export function curatedLines(text: string): number {
  let n = 0, generated = false, front = 0;
  for (const l of text.split("\n")) {
    if (l === "---" && front < 2) { front++; continue; }
    if (front === 1) continue;
    if (/<!--\s*accio:begin/.test(l)) { generated = true; continue; }
    if (/<!--\s*accio:end/.test(l)) { generated = false; continue; }
    if (!generated && l.trim()) n++;
  }
  return n;
}

export async function validateDoc(path: string, max = ARCH_MAX_LINES): Promise<Problem[]> {
  const lines = curatedLines(await Bun.file(path).text());
  return lines > max ? [{ path, rule: `${lines} curated lines, over the ${max}-line cap` }] : [];
}

// ---------------------------------------------------------------- the feature spec and the revision (CTD-192)

/** a criterion line under `## Criteria` or `## Retired`: `- S-12 — …` */
const CRITERION = /^- S-(\d+) —/;

/**
 * The rules on a feature spec, wherever it sits: front matter naming its feature and a
 * numeric `next_id`; criterion ids unique across Criteria and Retired and all below
 * `next_id`, so an id is never reused; and the same line cap as the arch doc. `feature`,
 * when given, is what the front matter must name.
 */
export function validateSpecText(text: string, path: string, feature?: string, max = ARCH_MAX_LINES): Problem[] {
  const out: Problem[] = [];
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return [{ path, rule: "no front matter" }];
  const field = (k: string) => fm[1]!.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, "m"))?.[1];
  const named = field("feature");
  if (!named) out.push({ path, rule: "front matter names no feature" });
  else if (feature && named !== feature) out.push({ path, rule: `front matter names ${named}, expected ${feature}` });
  const nextRaw = field("next_id");
  const next = nextRaw === undefined ? NaN : Number(nextRaw);
  if (!Number.isInteger(next) || next < 1) out.push({ path, rule: "next_id must be a positive integer" });
  const lines = curatedLines(text);
  if (lines > max) out.push({ path, rule: `${lines} curated lines, over the ${max}-line cap` });
  const seen = new Set<number>();
  let section = "";
  for (const l of text.split("\n")) {
    const h = l.match(/^## (.+?)\s*$/);
    if (h) { section = h[1]!; continue; }
    if (section !== "Criteria" && section !== "Retired") continue;
    const m = l.match(CRITERION);
    if (!m) continue;
    const id = Number(m[1]);
    if (seen.has(id)) out.push({ path, rule: `S-${id} appears twice` });
    seen.add(id);
    if (Number.isInteger(next) && id >= next) out.push({ path, rule: `S-${id} is at or past next_id ${next}` });
  }
  return out;
}

export async function validateSpec(path: string, feature?: string, max = ARCH_MAX_LINES): Promise<Problem[]> {
  return validateSpecText(await Bun.file(path).text(), path, feature, max);
}

export const REVISION_STATUSES = ["draft", "filed", "done", "dropped"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** the fields a revision record carries; the parser in `revision.ts` builds one, these rules judge it */
export type RevisionRecord = {
  slug: string;
  key?: string;
  title: string;
  status: RevisionStatus;
  features: string[];
  tickets: string[];
  at: { drafted: string; filed: string | null; settled: string | null };
  evidence: Evidence[];
};

/**
 * The rules on a parsed revision beyond its shape: every feature it names is a feature
 * directory under an app, and a revision past `draft` carries its key and, once filed, its
 * tickets. `knownFeature` answers whether `<app>/<dir>` exists.
 */
export async function validateRevisionRecord(r: RevisionRecord, path: string, knownFeature: (key: string) => Promise<boolean>): Promise<Problem[]> {
  const out: Problem[] = [];
  if (!r.features.length) out.push({ path: `${path}.features`, rule: "names no feature" });
  for (const [i, k] of r.features.entries()) if (!(await knownFeature(k))) out.push({ path: `${path}.features[${i}]`, rule: `${k} is not a feature directory under an app` });
  // a dropped draft never had a key; filed and done revisions always do
  if (r.status === "filed" || r.status === "done") {
    if (!r.key) out.push({ path: `${path}.key`, rule: `a ${r.status} revision has a key` });
    if (!r.tickets.length) out.push({ path: `${path}.tickets`, rule: `a ${r.status} revision names its tickets` });
  }
  return out;
}
