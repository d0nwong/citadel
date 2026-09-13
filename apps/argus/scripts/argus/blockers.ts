/**
 * The blockers code can clear. A `landing` blocker clears when the landing it names is on
 * the ledger and its deploy succeeded; a `ticket` blocker clears when every ask the named
 * ticket serves is closed. An `answer` blocker is a person's to clear, through the reader
 * or a click. `argus reconcile` runs this over every ledger after a batch is placed.
 *
 * It also finishes what a ticket opened, from two facts:
 *
 * - Linear. A ticket Linear says is Done is settled `done`, and every open ask it serves
 *   closes with the ticket as evidence; Canceled settles it `dropped` and drops them. Linear
 *   is read once per run for every ticket still open (`linear.ts`) and never written.
 * - A landing. An open ask whose ticket's key is on a landing (every Foundry branch carries
 *   it) moves to `built` with the PR as evidence, and to `closed` once that landing is live:
 *   on the frontend, the base branch is staging, so a merge is live; on the backend, once
 *   the dev pipeline succeeded. A ticket that serves no ask (filed from a gap, not a
 *   message) has nothing to close, so the same live landing settles the ticket itself.
 */

import type { Deploy } from "./deploy.ts";
import { deployedAt } from "./deploy.ts";
import { ticketStates, type TicketStates } from "./linear.ts";
import { listFeatures } from "./paths.ts";
import { ticketKeysIn } from "./pr-facts.ts";
import type { Blocker, Evidence, Landing, Ledger, Ticket } from "./schema.ts";
import { cancelRevision, foldRevision, listRevisions, type Settled } from "./revision.ts";
import { readLedger, writeLedger, type WriteResult } from "./write.ts";

export type DeployedOf = (repo: "fe" | "be", sha: string) => Promise<Deploy | null>;

const day = (iso: string) => iso.slice(0, 10);
const unknown: TicketStates = () => ({ state: "unknown" });

export type Reconciled = { ledger: Ledger; cleared: string[] };

/** pure: the ledger with every clearable blocker cleared, and one line per clearance */
export async function reconcileLedger(l: Ledger, deployed: DeployedOf, now = new Date(), states: TicketStates = unknown): Promise<Reconciled> {
  const next: Ledger = structuredClone(l);
  const cleared: string[] = [];
  const settledAsk = (id: string) => {
    const a = next.asks.find((x) => x.id === id);
    return !!a && (a.status === "closed" || a.status === "dropped");
  };
  const ticketDone = (key: string) => {
    const t = next.tickets.find((x) => x.key === key);
    return !!t && (t.settled?.outcome === "done" || (t.asks.length > 0 && t.asks.every(settledAsk)));
  };
  /** the asks a ticket serves: named on it, or pointing at it */
  const asksOf = (t: Ticket) => next.asks.filter((a) => t.asks.includes(a.id) || a.ticket === t.key);
  const keysOf = (ld: Landing) => ld.tickets ?? ticketKeysIn(ld.title);
  const evidenceOf = (ld: Landing): Evidence[] =>
    ld.url && ld.number ? [{ kind: "pr", repo: ld.repo, number: ld.number, url: ld.url }] : [{ kind: "commit", repo: ld.repo, sha: ld.sha }];
  const liveAt = async (ld: Landing): Promise<string | null> => {
    if (ld.repo === "fe") return ld.at;
    const d = await deployed(ld.repo, ld.sha);
    return d?.result === "SUCCESSFUL" ? d.at : null;
  };
  const day0 = day(now.toISOString());
  /** a date that cannot precede the thing it follows is today */
  const notBefore = (at: string, floor: string) => (day(at) < day(floor) ? day0 : day(at));

  // Linear: Done settles the ticket and closes its asks; Canceled drops both
  for (const t of next.tickets) {
    if (t.settled) continue;
    const s = states(t.key);
    if (s.state !== "done" && s.state !== "canceled") continue;
    const outcome = s.state === "done" ? "done" : "dropped";
    const status = s.state === "done" ? "closed" : "dropped";
    const evidence: Evidence[] = [{ kind: "ticket", key: t.key, url: s.url }];
    t.settled = { outcome, at: day(s.at), evidence };
    cleared.push(`${t.key}: ${s.name} in Linear, ${outcome}`);
    for (const a of asksOf(t)) {
      if (a.status === "closed" || a.status === "dropped") continue;
      a.status = status;
      a.history.push({ at: notBefore(s.at, a.at), status, evidence });
      cleared.push(`${a.id}: ${t.key} is ${s.name}, ${status}`);
    }
  }

  // a landing: an ask-less ticket is done once the landing carrying its key is live
  for (const t of next.tickets) {
    if (t.settled || asksOf(t).length > 0) continue;
    const ld = next.landings.find((x) => keysOf(x).includes(t.key));
    if (!ld) continue;
    const at = await liveAt(ld);
    if (!at) continue;
    t.settled = { outcome: "done", at: notBefore(at, ld.at), evidence: evidenceOf(ld) };
    cleared.push(`${t.key}: landed as ${ld.ref} and is live, done`);
  }

  const clear = async (b: Blocker, owner: string): Promise<void> => {
    if (b.cleared) return;
    if (b.kind === "landing") {
      const ld = next.landings.find((x) => x.ref === b.ref);
      if (!ld) return;
      const d = await deployed(ld.repo, ld.sha);
      if (!d || d.result !== "SUCCESSFUL") return;
      b.deployed = true;
      b.cleared = { at: day(d.at), evidence: evidenceOf(ld) };
      cleared.push(`${owner}: ${b.ref} is on ${b.branch} and deployed (${day(d.at)})`);
      return;
    }
    if (b.kind === "ticket" && ticketDone(b.key)) {
      b.cleared = { at: day0, evidence: [{ kind: "ticket", key: b.key }] };
      cleared.push(`${owner}: ${b.key} is done`);
    }
  };
  for (const t of next.tickets) for (const b of t.blockers) await clear(b, t.key);
  for (const a of next.asks) for (const b of a.blockers ?? []) await clear(b, a.id);

  // a landing: an ask whose ticket landed is built, and closed once the landing is live
  for (const a of next.asks) {
    if (!a.ticket || a.status === "closed" || a.status === "dropped") continue;
    const ld = next.landings.find((x) => keysOf(x).includes(a.ticket!));
    if (!ld) continue;
    const evidence = evidenceOf(ld);
    if (!ld.asks.includes(a.id)) ld.asks.push(a.id);
    if (a.status !== "built" && a.status !== "acknowledged") {
      a.status = "built";
      a.history.push({ at: day(ld.at), status: "built", evidence });
      cleared.push(`${a.id}: ${a.ticket} landed as ${ld.ref}`);
    }
    const live = await liveAt(ld);
    if (live) {
      a.status = "closed";
      a.history.push({ at: notBefore(live, ld.at), status: "closed", evidence });
      cleared.push(`${a.id}: ${a.ticket} is live, closed`);
    }
  }
  return { ledger: next, cleared };
}

/** one ledger reconciled, or one revision settled (`feature` is then `revisions/<KEY>`) */
export type ReconcileResult = { feature: string; cleared: string[]; write: WriteResult | null; revision?: Settled; error?: string };

export type ReconcileOptions = {
  deployed?: DeployedOf;
  /** the Linear reader; default asks Linear once for every open ticket across the run */
  states?: (keys: string[]) => Promise<TicketStates>;
  dryRun?: boolean;
  now?: Date;
  features?: string[];
};

/** true when the ledger holds anything reconcile could move */
export function needsReconcile(l: Ledger): boolean {
  const open = (bs: Blocker[]) => bs.some((b) => !b.cleared);
  return (
    l.tickets.some((t) => !t.settled) ||
    l.asks.some((a) => a.ticket && a.status !== "closed" && a.status !== "dropped") ||
    l.tickets.some((t) => open(t.blockers)) ||
    l.asks.some((a) => open(a.blockers ?? []))
  );
}

/** every ledger, blockers cleared and tickets settled where the facts allow, written when something changed */
export async function reconcileAll(opts: ReconcileOptions = {}): Promise<ReconcileResult[]> {
  const deployed = opts.deployed ?? ((repo, sha) => deployedAt(repo, sha));
  const ledgers: [string, Ledger][] = [];
  for (const feature of opts.features ?? (await listFeatures())) {
    const l = await readLedger(feature);
    if (l && needsReconcile(l)) ledgers.push([feature, l]);
  }
  // the filed revisions, whose parents settle them — only on a whole run, never one scoped to named features
  const filed = opts.features ? [] : (await listRevisions()).filter((r) => !r.archived && r.rev.status === "filed" && r.rev.key);
  const openKeys = [
    ...new Set([...ledgers.flatMap(([, l]) => l.tickets.filter((t) => !t.settled).map((t) => t.key)), ...filed.map((r) => r.rev.key!)]),
  ];
  const states = await (opts.states ?? ((keys) => ticketStates(keys, { now: opts.now })))(openKeys);
  const out: ReconcileResult[] = [];
  for (const [feature, l] of ledgers) {
    const r = await reconcileLedger(l, deployed, opts.now, states);
    if (!r.cleared.length) continue;
    const write = await writeLedger(feature, r.ledger, { actor: "model", now: opts.now, dryRun: opts.dryRun });
    out.push({ feature, cleared: r.cleared, write });
  }
  // a revision follows its parent: Done folds its specs into the features and archives it; Canceled archives it
  for (const r of filed) {
    const key = r.rev.key!;
    const s = states(key);
    if (s.state !== "done" && s.state !== "canceled") continue;
    const feature = `revisions/${key}`;
    try {
      const o = { now: opts.now, dryRun: opts.dryRun, url: s.url };
      const settled = s.state === "done" ? await foldRevision(r, o) : await cancelRevision(r, o);
      const retired = settled.retired.length ? `; ${settled.retired.length} product doc(s) retired` : "";
      const line =
        settled.to === "done"
          ? `${key}: ${s.name} in Linear — folded into ${settled.features.join(", ") || "no spec"}${retired}; archived as done`
          : `${key}: ${s.name} in Linear — archived as dropped`;
      out.push({ feature, cleared: [line], write: null, revision: settled });
    } catch (e) {
      out.push({ feature, cleared: [], write: null, error: `${key}: not settled — ${(e as Error).message}` });
    }
  }
  return out;
}
