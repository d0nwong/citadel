/**
 * The click verbs: what a person does to the record, from Pensieve or the terminal. Each
 * writes evidence of kind `user` with the reason given, goes through `writeLedger`, and is
 * idempotent, so a double click or a retried request changes nothing the second time.
 *
 *   close    an ask is done by the user's say-so
 *   drop     an ask was never one, or is not wanted; the reason stays on it
 *   confirm  a requirement is confirmed or contradicted by the user, one or all
 *   place    an unplaced message belongs to a feature; the thread remembers it
 *   ticket   a proposal was filed; the key goes on the ask and the ticket list
 *   sent     a ticket went to Foundry; the job is recorded on it
 */

import { isFeature } from "./paths.ts";
import { type Ask, type Evidence, type Ledger, type Requirement, type RequirementStatus, emptyLedger } from "./schema.ts";
import { readThreads, readUnplaced, writeThreads, writeUnplaced } from "./state.ts";
import { readLedger, writeLedger, type WriteResult } from "./write.ts";

export type VerbOptions = { now?: Date; dryRun?: boolean; app?: string };

const userEvidence = (reason: string, now: Date): Evidence => ({ kind: "user", reason, at: now.toISOString() });
const day = (d: Date) => d.toISOString().slice(0, 10);

async function mustRead(feature: string, app?: string): Promise<Ledger> {
  const l = await readLedger(feature, app);
  if (!l) throw new Error(`${feature}: no ledger`);
  return l;
}

async function commit(feature: string, next: Ledger, o: VerbOptions): Promise<WriteResult> {
  return writeLedger(feature, next, { actor: "user", now: o.now, dryRun: o.dryRun, app: o.app });
}

export async function closeAsk(feature: string, askId: string, reason: string, o: VerbOptions = {}): Promise<WriteResult> {
  return settleAsk(feature, askId, "closed", reason, o);
}

export async function dropAsk(feature: string, askId: string, reason: string, o: VerbOptions = {}): Promise<WriteResult> {
  return settleAsk(feature, askId, "dropped", reason, o);
}

async function settleAsk(feature: string, askId: string, status: "closed" | "dropped", reason: string, o: VerbOptions): Promise<WriteResult> {
  const now = o.now ?? new Date();
  const l = await mustRead(feature, o.app);
  const ask = l.asks.find((a) => a.id === askId);
  if (!ask) throw new Error(`${feature}: no ask ${askId}`);
  if (ask.status === status) return commit(feature, l, o);
  const settled: Ask = { ...ask, status, history: [...ask.history, { at: day(now), status, evidence: [userEvidence(reason, now)] }] };
  return commit(feature, { ...l, asks: l.asks.map((a) => (a.id === askId ? settled : a)) }, { ...o, now });
}

export type ConfirmOptions = VerbOptions & { contradict?: boolean; all?: boolean; by?: string };

export async function confirmRequirement(feature: string, reqId: string | null, reason: string, o: ConfirmOptions = {}): Promise<WriteResult> {
  const now = o.now ?? new Date();
  const l = await mustRead(feature, o.app);
  const target: RequirementStatus = o.contradict ? "contradicted" : "confirmed";
  const pick = (r: Requirement) => (o.all ? r.status === "assumed" : r.id === reqId);
  if (!o.all && !l.requirements.some((r) => r.id === reqId)) throw new Error(`${feature}: no requirement ${reqId}`);
  const requirements = l.requirements.map((r) => {
    if (!pick(r) || r.status === target) return r;
    const ev = r.evidence.filter((e) => e.kind !== "assumption");
    return { ...r, status: target, by: o.by ?? "you", at: day(now), evidence: [...ev, userEvidence(reason, now)] };
  });
  return commit(feature, { ...l, requirements }, { ...o, now });
}

export type PlaceResult = { placed: boolean; feature: string; thread: string | null; ledger: WriteResult | null };

/**
 * An unplaced message goes to a feature. The thread root is remembered so the rest of the
 * thread never asks again, the entry and its replies leave the unplaced list, and the
 * feature gets a ledger if it had none. What the message *means* for the ledger is the
 * reader's job on the next run; this verb only says where it belongs.
 */
export async function placeMessage(id: string, feature: string, o: VerbOptions = {}): Promise<PlaceResult> {
  const now = o.now ?? new Date();
  if (!(await isFeature(feature, o.app))) throw new Error(`${feature}: not a feature`);
  const unplaced = await readUnplaced();
  const entry = unplaced.find((u) => u.id === id);
  if (!entry) throw new Error(`${id}: not in the unplaced list`);
  const thread = entry.thread ?? (entry.kind === "message" ? entry.id : null);
  if (o.dryRun) return { placed: false, feature, thread, ledger: null };

  if (thread) {
    const threads = await readThreads();
    threads[thread] = { feature, by: "user", at: now.toISOString() };
    await writeThreads(threads);
  }
  const keep = unplaced.filter((u) => u.id !== id && !(thread && (u.thread === thread || u.id === thread)));
  await writeUnplaced(keep);
  const existing = await readLedger(feature, o.app);
  const ledger = existing ? null : await writeLedger(feature, emptyLedger(feature, "", now.toISOString()), { actor: "user", now, app: o.app });
  return { placed: true, feature, thread, ledger };
}

export async function recordTicket(feature: string, proposalId: string, key: string, o: VerbOptions = {}): Promise<WriteResult> {
  const now = o.now ?? new Date();
  const l = await mustRead(feature, o.app);
  if (l.tickets.some((t) => t.key === key)) return commit(feature, { ...l, proposals: l.proposals.filter((p) => p.id !== proposalId) }, { ...o, now });
  const p = l.proposals.find((x) => x.id === proposalId);
  if (!p) throw new Error(`${feature}: no proposal ${proposalId}`);
  const tickets = [...l.tickets, { key, title: p.title, asks: p.asks, blockers: [], ready: true }];
  const asks = l.asks.map((a) => (p.asks.includes(a.id) ? { ...a, ticket: key } : a));
  return commit(feature, { ...l, tickets, asks, proposals: l.proposals.filter((x) => x.id !== proposalId) }, { ...o, now });
}

/** a ticket was sent to Foundry; the job is recorded once, however many times the click replays */
export async function recordSent(feature: string, key: string, repo: string, job: string | undefined, o: VerbOptions = {}): Promise<WriteResult> {
  const now = o.now ?? new Date();
  const l = await mustRead(feature, o.app);
  const t = l.tickets.find((x) => x.key === key);
  if (!t) throw new Error(`${feature}: no ticket ${key}`);
  if (job && (t.sent ?? []).some((s) => s.job === job)) return commit(feature, l, o);
  const entry = { at: now.toISOString(), repo, ...(job ? { job } : {}) };
  const tickets = l.tickets.map((x) => (x.key === key ? { ...x, sent: [...(x.sent ?? []), entry] } : x));
  return commit(feature, { ...l, tickets }, { ...o, now });
}

/** a ticket filed straight from an ask: the ask's open blockers become the ticket's, the key goes on the ask */
export async function recordTicketForAsk(feature: string, askId: string, key: string, title: string, o: VerbOptions = {}): Promise<WriteResult> {
  const now = o.now ?? new Date();
  const l = await mustRead(feature, o.app);
  const a = l.asks.find((x) => x.id === askId);
  if (!a) throw new Error(`${feature}: no ask ${askId}`);
  if (l.tickets.some((t) => t.key === key)) return commit(feature, { ...l, asks: l.asks.map((x) => (x.id === askId ? { ...x, ticket: key } : x)) }, { ...o, now });
  const blockers = (a.blockers ?? []).filter((b) => !b.cleared).map((b) => structuredClone(b));
  const tickets = [...l.tickets, { key, title, asks: [askId], blockers, ready: blockers.length === 0 }];
  return commit(feature, { ...l, tickets, asks: l.asks.map((x) => (x.id === askId ? { ...x, ticket: key } : x)) }, { ...o, now });
}
