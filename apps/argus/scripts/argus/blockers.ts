/**
 * The blockers code can clear. A `landing` blocker clears when the landing it names is on
 * the ledger and its deploy succeeded; a `ticket` blocker clears when every ask the named
 * ticket serves is closed. An `answer` blocker is a person's to clear, through the reader
 * or a click. `argus reconcile` runs this over every ledger after a batch is placed.
 */

import type { Deploy } from "./deploy.ts";
import { deployedAt } from "./deploy.ts";
import { listFeatures } from "./paths.ts";
import type { Blocker, Evidence, Ledger } from "./schema.ts";
import { readLedger, writeLedger, type WriteResult } from "./write.ts";

export type DeployedOf = (repo: "fe" | "be", sha: string) => Promise<Deploy | null>;

const day = (iso: string) => iso.slice(0, 10);

export type Reconciled = { ledger: Ledger; cleared: string[] };

/** pure: the ledger with every clearable blocker cleared, and one line per clearance */
export async function reconcileLedger(l: Ledger, deployed: DeployedOf, now = new Date()): Promise<Reconciled> {
  const next: Ledger = structuredClone(l);
  const cleared: string[] = [];
  const closedAsks = new Set(next.asks.filter((a) => a.status === "closed" || a.status === "dropped").map((a) => a.id));
  const ticketDone = (key: string) => {
    const t = next.tickets.find((x) => x.key === key);
    return !!t && t.asks.length > 0 && t.asks.every((id) => closedAsks.has(id));
  };
  const clear = async (b: Blocker, owner: string): Promise<void> => {
    if (b.cleared) return;
    if (b.kind === "landing") {
      const ld = next.landings.find((x) => x.ref === b.ref);
      if (!ld) return;
      const d = await deployed(ld.repo, ld.sha);
      if (!d || d.result !== "SUCCESSFUL") return;
      const evidence: Evidence[] =
        ld.url && ld.number ? [{ kind: "pr", repo: ld.repo, number: ld.number, url: ld.url }] : [{ kind: "commit", repo: ld.repo, sha: ld.sha }];
      b.deployed = true;
      b.cleared = { at: day(d.at), evidence };
      cleared.push(`${owner}: ${b.ref} is on ${b.branch} and deployed (${day(d.at)})`);
      return;
    }
    if (b.kind === "ticket" && ticketDone(b.key)) {
      b.cleared = { at: day(now.toISOString()), evidence: [{ kind: "ticket", key: b.key }] };
      cleared.push(`${owner}: ${b.key} is done`);
    }
  };
  for (const t of next.tickets) for (const b of t.blockers) await clear(b, t.key);
  for (const a of next.asks) for (const b of a.blockers ?? []) await clear(b, a.id);
  return { ledger: next, cleared };
}

export type ReconcileResult = { feature: string; cleared: string[]; write: WriteResult | null };

/** every ledger, blockers cleared where the facts allow, written when something changed */
export async function reconcileAll(opts: { deployed?: DeployedOf; dryRun?: boolean; now?: Date; features?: string[] } = {}): Promise<ReconcileResult[]> {
  const deployed = opts.deployed ?? ((repo, sha) => deployedAt(repo, sha));
  const out: ReconcileResult[] = [];
  for (const feature of opts.features ?? (await listFeatures())) {
    const l = await readLedger(feature);
    if (!l) continue;
    const open = (bs: Blocker[]) => bs.some((b) => !b.cleared);
    if (!l.tickets.some((t) => open(t.blockers)) && !l.asks.some((a) => open(a.blockers ?? []))) continue;
    const r = await reconcileLedger(l, deployed, opts.now);
    if (!r.cleared.length) continue;
    const write = await writeLedger(feature, r.ledger, { actor: "model", now: opts.now, dryRun: opts.dryRun });
    out.push({ feature, cleared: r.cleared, write });
  }
  return out;
}
