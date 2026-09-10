/**
 * The one way a ledger reaches disk. `readLedger` parses the file or answers null;
 * `writeLedger` takes the next version, allocates ids for new entries, derives `ready`,
 * validates against the version on disk, and writes only when something other than the
 * timestamp changed. It answers what it did, as lines a commit message or a page can show.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ledgerPath } from "./paths.ts";
import { type Ask, type IdCounters, type Ledger, parseLedger, type Proposal, type Requirement, serializeLedger } from "./schema.ts";
import { assertLedger, deriveReady } from "./validate.ts";

export type WriteOptions = {
  actor?: "model" | "user";
  now?: Date;
  app?: string;
  /** validate and report, write nothing */
  dryRun?: boolean;
};

export type WriteResult = { wrote: boolean; ledger: Ledger; diff: string[]; path: string };

export async function readLedger(feature: string, app?: string): Promise<Ledger | null> {
  const f = Bun.file(ledgerPath(feature, app));
  if (!(await f.exists())) return null;
  return parseLedger(await f.json());
}

/** ids from the previous ledger, its counters, and the next; the highest ever used per namespace */
function counters(prev: Ledger | null, next: Ledger): IdCounters {
  const n = (ids: string[]) => Math.max(0, ...ids.map((id) => Number(id.slice(2)) || 0));
  const ns = (prevIds: string[], nextIds: string[], c: number) => Math.max(c, n(prevIds), n(nextIds));
  return {
    R: ns(prev?.requirements.map((r) => r.id) ?? [], next.requirements.map((r) => r.id), prev?.ids?.R ?? 0),
    A: ns(prev?.asks.map((a) => a.id) ?? [], next.asks.map((a) => a.id), prev?.ids?.A ?? 0),
    P: ns(prev?.proposals.map((p) => p.id) ?? [], next.proposals.map((p) => p.id), prev?.ids?.P ?? 0),
  };
}

/** an entry with no id, or a placeholder, gets the next number in its namespace */
const needsId = (id: string) => !/^[RAP]-[1-9]\d*$/.test(id);

export function allocateIds(prev: Ledger | null, next: Ledger): Ledger {
  const c = counters(prev, next);
  const give = <T extends { id: string }>(list: T[], ns: keyof IdCounters): T[] =>
    list.map((e) => (needsId(e.id) ? { ...e, id: `${ns}-${++c[ns]}` } : e));
  const requirements = give<Requirement>(next.requirements, "R");
  const asks = give<Ask>(next.asks, "A");
  const proposals = give<Proposal>(next.proposals, "P");
  return { ...next, requirements, asks, proposals, ids: c };
}

const strip = (l: Ledger) => serializeLedger({ ...l, as_of: "" });

/** one line per entry that appeared or changed status, plus tickets whose readiness moved */
export function describeDiff(prev: Ledger | null, next: Ledger): string[] {
  const out: string[] = [];
  const by = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const pr = by(prev?.requirements ?? []);
  for (const r of next.requirements) {
    const was = pr.get(r.id);
    if (!was) out.push(`+ ${r.id} ${r.status}: ${r.text}`);
    else if (was.status !== r.status) out.push(`${r.id} ${was.status} → ${r.status}`);
  }
  const pa = by(prev?.asks ?? []);
  for (const a of next.asks) {
    const was = pa.get(a.id);
    if (!was) out.push(`+ ${a.id} ${a.status}: ${a.text}`);
    else if (was.status !== a.status) out.push(`${a.id} ${was.status} → ${a.status}`);
  }
  const pt = new Map((prev?.tickets ?? []).map((t) => [t.key, t]));
  for (const t of next.tickets) {
    const was = pt.get(t.key);
    if (!was) out.push(`+ ${t.key} ${t.ready ? "ready" : "blocked"}`);
    else if (was.ready !== t.ready) out.push(`${t.key} ${t.ready ? "ready" : "blocked again"}`);
  }
  const pl = new Set((prev?.landings ?? []).map((l) => `${l.repo}#${l.number}`));
  for (const l of next.landings) if (!pl.has(`${l.repo}#${l.number}`)) out.push(`+ ${l.repo}#${l.number} landed: ${l.title}`);
  const pp = by(prev?.proposals ?? []);
  for (const p of next.proposals) if (!pp.has(p.id)) out.push(`+ ${p.id} proposed: ${p.title}`);
  for (const p of prev?.proposals ?? []) if (!next.proposals.some((n) => n.id === p.id)) out.push(`- ${p.id} gone`);
  if (!prev) out.unshift("new ledger");
  else {
    if (prev.summary !== next.summary) out.push("summary changed");
    for (const k of ["health", "gaps", "requirements", "architecture"] as const)
      if (prev.story[k].text !== next.story[k].text) out.push(`story.${k} changed`);
  }
  return out;
}

export async function writeLedger(feature: string, input: unknown, opts: WriteOptions = {}): Promise<WriteResult> {
  const { actor = "model", now = new Date(), app, dryRun = false } = opts;
  const path = ledgerPath(feature, app);
  const prev = await readLedger(feature, app);
  const parsed = parseLedger(input);
  if (parsed.feature !== feature) throw new Error(`${path}: the ledger says feature "${parsed.feature}", expected "${feature}"`);
  let next = deriveReady(allocateIds(prev, parsed));

  if (prev && strip(prev) === strip(next)) return { wrote: false, ledger: prev, diff: [], path };

  next = { ...next, as_of: now.toISOString() };
  const ledger = assertLedger(next, { prev, actor });
  const diff = describeDiff(prev, ledger);
  if (!dryRun) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, serializeLedger(ledger));
  }
  return { wrote: !dryRun, ledger, diff, path };
}
