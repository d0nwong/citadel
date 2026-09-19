/**
 * What the reader returns: a patch, not the whole ledger. Code applies it to the ledger on
 * disk and the result goes through `writeLedger`, so the validator still sees the whole.
 * A patch only adds entries, appends history and evidence, moves a status, clears a
 * blocker, or rewrites a story text; it cannot delete, renumber or touch code pointers.
 * Anything outside the shape is refused by path before it reaches the ledger.
 */

import type { Ask, AskStatus, Blocker, Cleared, Evidence, Landing, Ledger, Proposal, Requirement, RequirementStatus, StoryKey, StoryText } from "./schema.ts";
import { BLOCKER_KINDS, parseEvidence, SchemaError, STORY_KEYS } from "./schema.ts";

export type Patch = {
  summary?: string;
  story?: Partial<Record<StoryKey, StoryText>>;
  requirements?: {
    add?: Omit<Requirement, "id">[];
    update?: { id: string; status?: RequirementStatus; by?: string; at?: string; evidence: Evidence[]; text?: string }[];
  };
  asks?: {
    /** `status` and `history` are optional: an ask that arrived and closed inside one batch comes whole */
    add?: (Omit<Ask, "id" | "history" | "status" | "ready"> & { status?: AskStatus; history?: Ask["history"] })[];
    /** a wait on something: a landing, an answer, another ticket */
    block?: { id: string; blocker: Blocker }[];
    /** `status` omitted = more evidence on the current status */
    update?: { id: string; status?: AskStatus; at: string; evidence: Evidence[]; to?: string | null; ticket?: string | null; requirements?: string[] }[];
  };
  tickets?: {
    clear?: { key: string; blocker: number; at: string; evidence: Evidence[]; deployed?: boolean }[];
    block?: { key: string; blocker: Blocker }[];
  };
  landings?: { add?: Landing[]; link?: { ref: string; asks: string[] }[] };
  proposals?: { add?: Omit<Proposal, "id">[]; update?: { id: string; body: string }[] };
  /** what the reader could not settle; goes to the terminal, never to the ledger */
  notes?: string[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const err = (path: string, msg: string) => new SchemaError(path, msg);

function evidenceList(v: unknown, path: string): Evidence[] {
  if (!Array.isArray(v)) throw err(path, "expected an array of evidence");
  return v.map((e, i) => parseEvidence(e, `${path}[${i}]`));
}

const KNOWN = new Set(["summary", "story", "requirements", "asks", "tickets", "landings", "proposals", "notes"]);

/** check the patch's shape; the ledger-level rules are the validator's after apply */
export function parsePatch(v: unknown): Patch {
  if (!isObj(v)) throw err("patch", "expected an object");
  for (const k of Object.keys(v)) if (!KNOWN.has(k)) throw err(`patch.${k}`, "not a patch field; a patch adds, updates, clears or rewrites a story text");
  const p: Patch = {};
  if (v.summary !== undefined) {
    if (typeof v.summary !== "string") throw err("patch.summary", "expected a string");
    p.summary = v.summary;
  }
  if (v.story !== undefined) {
    if (!isObj(v.story)) throw err("patch.story", "expected an object");
    p.story = {};
    for (const [k, t] of Object.entries(v.story)) {
      if (!(STORY_KEYS as readonly string[]).includes(k)) throw err(`patch.story.${k}`, `expected one of ${STORY_KEYS.join(", ")}`);
      if (!isObj(t) || typeof t.text !== "string") throw err(`patch.story.${k}`, "expected { text, evidence }");
      p.story[k as StoryKey] = { text: t.text, evidence: evidenceList(t.evidence, `patch.story.${k}.evidence`) };
    }
  }
  const section = (name: string, allowed: string[]): Obj | undefined => {
    const s = v[name];
    if (s === undefined) return undefined;
    if (!isObj(s)) throw err(`patch.${name}`, "expected an object");
    for (const k of Object.keys(s)) if (!allowed.includes(k)) throw err(`patch.${name}.${k}`, `expected one of ${allowed.join(", ")}`);
    return s;
  };
  const list = (s: Obj | undefined, name: string, key: string): unknown[] => {
    if (!s || s[key] === undefined) return [];
    if (!Array.isArray(s[key])) throw err(`patch.${name}.${key}`, "expected an array");
    return s[key] as unknown[];
  };
  const req = section("requirements", ["add", "update"]);
  if (req) {
    p.requirements = { add: [], update: [] };
    list(req, "requirements", "add").forEach((r, i) => {
      const path = `patch.requirements.add[${i}]`;
      if (!isObj(r) || typeof r.text !== "string" || typeof r.status !== "string") throw err(path, "expected { text, status, evidence }");
      p.requirements!.add!.push({ text: r.text, status: r.status as RequirementStatus, evidence: evidenceList(r.evidence, `${path}.evidence`), ...(typeof r.by === "string" ? { by: r.by } : {}), ...(typeof r.at === "string" ? { at: r.at } : {}) });
    });
    list(req, "requirements", "update").forEach((r, i) => {
      const path = `patch.requirements.update[${i}]`;
      if (!isObj(r) || typeof r.id !== "string") throw err(path, "expected { id, status?, evidence }");
      p.requirements!.update!.push({ id: r.id, evidence: evidenceList(r.evidence, `${path}.evidence`), ...(typeof r.status === "string" ? { status: r.status as RequirementStatus } : {}), ...(typeof r.by === "string" ? { by: r.by } : {}), ...(typeof r.at === "string" ? { at: r.at } : {}), ...(typeof r.text === "string" ? { text: r.text } : {}) });
    });
  }
  const asks = section("asks", ["add", "update", "block"]);
  if (asks) {
    p.asks = { add: [], block: [], update: [] };
    list(asks, "asks", "block").forEach((b, i) => {
      const path = `patch.asks.block[${i}]`;
      if (!isObj(b) || typeof b.id !== "string") throw err(path, "expected { id, blocker }");
      p.asks!.block!.push({ id: b.id, blocker: parseBlocker(b.blocker, `${path}.blocker`) });
    });
    list(asks, "asks", "add").forEach((a, i) => {
      const path = `patch.asks.add[${i}]`;
      if (!isObj(a) || typeof a.text !== "string" || typeof a.at !== "string" || !isObj(a.origin)) throw err(path, "expected { text, by, to, at, origin }");
      p.asks!.add!.push({
        text: a.text,
        by: typeof a.by === "string" && a.by ? a.by : "someone",
        to: typeof a.to === "string" ? a.to : null,
        at: a.at,
        origin: a.origin as Ask["origin"],
        ...(Array.isArray(a.requirements) ? { requirements: a.requirements as string[] } : {}),
        ...(typeof a.ticket === "string" ? { ticket: a.ticket } : {}),
        ...(Array.isArray(a.blockers) ? { blockers: a.blockers.map((b, j) => parseBlocker(b, `${path}.blockers[${j}]`)) } : {}),
        ...(typeof a.status === "string" ? { status: a.status as AskStatus } : {}),
        ...(Array.isArray(a.history)
          ? {
              history: a.history.map((h, j) => {
                const hp = `${path}.history[${j}]`;
                if (!isObj(h) || typeof h.at !== "string" || typeof h.status !== "string") throw err(hp, "expected { at, status, evidence }");
                return { at: h.at, status: h.status as AskStatus, evidence: evidenceList(h.evidence, `${hp}.evidence`) };
              }),
            }
          : {}),
      });
    });
    list(asks, "asks", "update").forEach((a, i) => {
      const path = `patch.asks.update[${i}]`;
      if (!isObj(a) || typeof a.id !== "string" || typeof a.at !== "string") throw err(path, "expected { id, status?, at, evidence }");
      p.asks!.update!.push({ id: a.id, at: a.at, evidence: evidenceList(a.evidence, `${path}.evidence`), ...(typeof a.status === "string" ? { status: a.status as AskStatus } : {}), ...(a.to !== undefined ? { to: a.to as string | null } : {}), ...(a.ticket !== undefined ? { ticket: a.ticket as string | null } : {}), ...(Array.isArray(a.requirements) ? { requirements: a.requirements as string[] } : {}) });
    });
  }
  const tickets = section("tickets", ["clear", "block"]);
  if (tickets) {
    p.tickets = { block: [], clear: [] };
    list(tickets, "tickets", "block").forEach((b, i) => {
      const path = `patch.tickets.block[${i}]`;
      if (!isObj(b) || typeof b.key !== "string") throw err(path, "expected { key, blocker }");
      p.tickets!.block!.push({ key: b.key, blocker: parseBlocker(b.blocker, `${path}.blocker`) });
    });
    list(tickets, "tickets", "clear").forEach((c, i) => {
      const path = `patch.tickets.clear[${i}]`;
      if (!isObj(c) || typeof c.key !== "string" || typeof c.blocker !== "number" || typeof c.at !== "string") throw err(path, "expected { key, blocker (index), at, evidence }");
      p.tickets!.clear!.push({ key: c.key, blocker: c.blocker, at: c.at, evidence: evidenceList(c.evidence, `${path}.evidence`), ...(typeof c.deployed === "boolean" ? { deployed: c.deployed } : {}) });
    });
  }
  const landings = section("landings", ["add", "link"]);
  if (landings) {
    p.landings = { add: list(landings, "landings", "add") as Landing[], link: [] };
    list(landings, "landings", "link").forEach((l, i) => {
      if (!isObj(l) || typeof l.ref !== "string" || !Array.isArray(l.asks)) throw err(`patch.landings.link[${i}]`, "expected { ref, asks }");
      p.landings!.link!.push({ ref: l.ref, asks: l.asks as string[] });
    });
  }
  const proposals = section("proposals", ["add", "update"]);
  if (proposals) {
    p.proposals = { add: (list(proposals, "proposals", "add") as Omit<Proposal, "id">[]).map((pr) => ({ ...pr, asks: Array.isArray(pr.asks) ? pr.asks : [] })), update: [] };
    list(proposals, "proposals", "update").forEach((u, i) => {
      if (!isObj(u) || typeof u.id !== "string" || typeof u.body !== "string") throw err(`patch.proposals.update[${i}]`, "expected { id, body }");
      p.proposals!.update!.push({ id: u.id, body: u.body });
    });
  }
  if (v.notes !== undefined) {
    if (!Array.isArray(v.notes) || v.notes.some((n) => typeof n !== "string")) throw err("patch.notes", "expected an array of strings");
    p.notes = v.notes as string[];
  }
  return p;
}

/** a blocker as the model writes it: never cleared, a landing's ref may still be unknown */
function parseBlocker(v: unknown, path: string): Blocker {
  if (!isObj(v) || typeof v.kind !== "string" || !(BLOCKER_KINDS as readonly string[]).includes(v.kind)) throw err(path, `expected { kind: ${BLOCKER_KINDS.join(" | ")}, … }`);
  switch (v.kind) {
    case "landing":
      if (typeof v.repo !== "string" || !v.repo) throw err(`${path}.repo`, "expected a non-empty string");
      return { kind: "landing", repo: v.repo, ref: typeof v.ref === "string" ? v.ref : "", branch: typeof v.branch === "string" ? v.branch : v.repo === "be" ? "origin/dev" : "origin/staging", deployed: false, cleared: null };
    case "answer":
      if (typeof v.from !== "string" || typeof v.question !== "string") throw err(path, "expected { kind: answer, from, question }");
      return { kind: "answer", from: v.from, question: v.question, cleared: null };
    default:
      if (typeof v.key !== "string") throw err(path, "expected { kind: ticket, key }");
      return { kind: "ticket", key: v.key, cleared: null };
  }
}

/** the ledger with the patch applied; ids allocated later by write; validation later by write */
export function applyPatch(l: Ledger, p: Patch): Ledger {
  const next: Ledger = structuredClone(l);
  if (p.summary !== undefined) next.summary = p.summary;
  for (const [k, t] of Object.entries(p.story ?? {})) next.story[k as StoryKey] = t!;
  for (const r of p.requirements?.add ?? []) next.requirements.push({ id: "", ...r });
  for (const u of p.requirements?.update ?? []) {
    const r = next.requirements.find((x) => x.id === u.id);
    if (!r) throw err("patch.requirements.update", `${u.id} is not a requirement`);
    if (u.status !== undefined && u.status !== r.status) r.evidence = r.evidence.filter((e) => e.kind !== "assumption");
    if (u.status !== undefined) r.status = u.status;
    if (u.by !== undefined) r.by = u.by;
    if (u.at !== undefined) r.at = u.at;
    if (u.text !== undefined) r.text = u.text;
    r.evidence = [...r.evidence, ...u.evidence];
  }
  for (const a of p.asks?.add ?? []) next.asks.push({ id: "", status: a.status ?? "asked", history: a.history ?? [], ...a, ...(a.status ? { status: a.status } : {}) });
  for (const u of p.asks?.update ?? []) {
    const a = next.asks.find((x) => x.id === u.id);
    if (!a) throw err("patch.asks.update", `${u.id} is not an ask`);
    const status = u.status ?? a.status;
    a.status = status;
    a.history.push({ at: u.at, status, evidence: u.evidence });
    if (u.to !== undefined) a.to = u.to;
    if (u.ticket !== undefined) a.ticket = u.ticket;
    if (u.requirements !== undefined) a.requirements = u.requirements;
  }
  for (const b of p.asks?.block ?? []) {
    const a = next.asks.find((x) => x.id === b.id);
    if (!a) throw err("patch.asks.block", `${b.id} is not an ask`);
    a.blockers = [...(a.blockers ?? []), b.blocker];
  }
  for (const b of p.tickets?.block ?? []) {
    const t = next.tickets.find((x) => x.key === b.key);
    if (!t) throw err("patch.tickets.block", `${b.key} is not a ticket`);
    t.blockers.push(b.blocker);
  }
  for (const c of p.tickets?.clear ?? []) {
    const t = next.tickets.find((x) => x.key === c.key);
    const b = t?.blockers[c.blocker];
    if (!t || !b) throw err("patch.tickets.clear", `${c.key} has no blocker ${c.blocker}`);
    if (b.kind === "landing" && c.deployed !== undefined) b.deployed = c.deployed;
    const cleared: Cleared = { at: c.at, evidence: c.evidence };
    b.cleared = cleared;
  }
  for (const ld of p.landings?.add ?? []) if (!next.landings.some((x) => x.ref === ld.ref)) next.landings.push(ld);
  for (const lk of p.landings?.link ?? []) {
    const ld = next.landings.find((x) => x.ref === lk.ref);
    if (!ld) throw err("patch.landings.link", `${lk.ref} is not a landing in this ledger`);
    ld.asks = [...new Set([...ld.asks, ...lk.asks])];
  }
  for (const pr of p.proposals?.add ?? []) next.proposals.push({ id: "", ...pr });
  for (const u of p.proposals?.update ?? []) {
    const pr = next.proposals.find((x) => x.id === u.id);
    if (!pr) throw err("patch.proposals.update", `${u.id} is not a proposal in this ledger`);
    pr.body = u.body;
  }
  return next;
}
