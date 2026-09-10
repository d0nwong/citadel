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
  l.asks.forEach((a, i) => a.history.forEach((h, j) => walk(h.evidence, `ledger.asks[${i}].history[${j}].evidence`)));
  l.tickets.forEach((t, i) =>
    t.blockers.forEach((b, j) => b.cleared && walk(b.cleared.evidence, `ledger.tickets[${i}].blockers[${j}].cleared.evidence`)),
  );
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
  return { ...l, tickets: l.tickets.map((t) => ({ ...t, ready: t.blockers.every((b) => b.cleared !== null) })) };
}

/** whether an ask still needs somebody */
export const isOpen = (a: Ask) => !ASK_DONE.includes(a.status);

// ---------------------------------------------------------------- the arch tier

export const ARCH_MAX_LINES = 250;

export async function validateDoc(path: string, max = ARCH_MAX_LINES): Promise<Problem[]> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return lines > max ? [{ path, rule: `${lines} lines, over the ${max}-line cap` }] : [];
}
