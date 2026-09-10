/**
 * `argus place <batch>`: the deterministic joins, and nothing the model would do better.
 *
 * A landing goes to every feature its files map to (pr-facts did the mapping). A message
 * goes where its thread root went (`state/threads.json`), else to the ledger that lists a
 * ticket key or PR it names, else to the feature a landing in this batch with the same
 * ticket key went. A reply follows its root within the batch. Everything else goes to
 * `state/unplaced.json` with the features that were active in the batch as candidates.
 * The same batch placed twice gives the same placed file, byte for byte.
 */

import { type Batch, type Placed, placedPath, readBatch, type Slice } from "./batch.ts";
import { listFeatures } from "./paths.ts";
import type { Landing } from "./pr-facts.ts";
import type { Ledger } from "./schema.ts";
import { flatten, type Msg } from "./slack-pull.ts";
import { readThreads, readUnplaced, type ThreadMap, type Unplaced, writeThreads, writeUnplaced } from "./state.ts";
import { readLedger } from "./write.ts";

export type PlaceOptions = { now?: Date; dryRun?: boolean; outDir?: string; ledgers?: Map<string, Ledger>; threads?: ThreadMap };

const PR_RE = /\b(fe|be)#(\d+)\b|pull-requests\/(\d+)\b|\bPR\s*#?(\d+)\b/gi;
const TICKET_RE = /\b(ALD|ARG|LIA)-\d+\b/g;

export type Keys = { tickets: Map<string, string>; prs: Map<string, string> };

/** ticket keys and PR refs → the feature whose ledger lists them */
export function keysOf(ledgers: Map<string, Ledger>): Keys {
  const tickets = new Map<string, string>();
  const prs = new Map<string, string>();
  for (const [feature, l] of ledgers) {
    for (const t of l.tickets) tickets.set(t.key, feature);
    for (const a of l.asks) {
      if (a.ticket) tickets.set(a.ticket, feature);
      for (const h of a.history) for (const e of h.evidence) if (e.kind === "pr") prs.set(`${e.repo}#${e.number}`, feature);
    }
    for (const t of l.tickets) for (const b of t.blockers) if (b.kind === "landing") prs.set(b.ref, feature);
    for (const ld of l.landings) prs.set(`${ld.repo}#${ld.number}`, feature);
  }
  return { tickets, prs };
}

/** the feature a message's own words point at through a key, or null */
export function featureByKey(text: string, keys: Keys, landingsByKey: Map<string, string[]>): string | null {
  for (const m of text.toUpperCase().matchAll(TICKET_RE)) {
    const hit = keys.tickets.get(m[0]) ?? landingsByKey.get(m[0])?.[0];
    if (hit) return hit;
  }
  for (const m of text.matchAll(PR_RE)) {
    const n = m[2] ?? m[3] ?? m[4];
    const kind = m[1]?.toLowerCase();
    for (const k of kind ? [`${kind}#${n}`] : [`fe#${n}`, `be#${n}`]) {
      const hit = keys.prs.get(k) ?? landingsByKey.get(k)?.[0];
      if (hit) return hit;
    }
  }
  return null;
}

export type Placement = { slices: Map<string, Slice>; unplaced: Unplaced[]; threads: ThreadMap };

/** pure: a batch, the ledgers and the thread map → slices, unplaced entries and new thread learnings */
export function placeBatch(batch: Batch, ledgers: Map<string, Ledger>, threads: ThreadMap, features: string[], now: Date): Placement {
  const slices = new Map<string, Slice>();
  const slice = (f: string) => {
    if (!slices.has(f)) slices.set(f, { feature: f, messages: [], landings: [] });
    return slices.get(f)!;
  };
  const keys = keysOf(ledgers);
  const learned: ThreadMap = {};
  const at = now.toISOString();

  // landings first: they seed the keys a message may name
  const landingsByKey = new Map<string, string[]>();
  for (const l of batch.landings) {
    for (const f of l.features) slice(f).landings.push(l);
    if (l.features.length) {
      landingsByKey.set(l.ref, l.features);
      for (const k of l.ticketKeys) if (!landingsByKey.has(k)) landingsByKey.set(k, l.features);
    }
  }

  const unplaced: Unplaced[] = [];
  const messages = batch.slack ? flatten(batch.slack) : [];
  const placedThread = new Map<string, string>();
  const resolveThread = (m: Msg) => threads[m.thread]?.feature ?? learned[m.thread]?.feature ?? placedThread.get(m.thread) ?? null;

  for (const m of messages) {
    const byThread = resolveThread(m);
    const feature = byThread ?? featureByKey(m.text, keys, landingsByKey);
    if (feature) {
      slice(feature).messages.push(m);
      if (!byThread) {
        placedThread.set(m.thread, feature);
        if (!threads[m.thread]) learned[m.thread] = { feature, by: "sweep", at };
      }
    } else {
      unplaced.push({
        id: m.ts,
        kind: "message",
        ...(m.thread !== m.ts ? { thread: m.thread } : {}),
        by: m.author,
        at: m.date,
        text: m.canvas ? `${m.text}\n\n${m.canvas}` : m.text,
        url: m.permalink,
        candidates: [],
        batch: batch.id,
      });
    }
  }
  // a reply placed by key after its root was unplaced: pull the root along
  for (const u of [...unplaced]) {
    const f = u.kind === "message" ? placedThread.get(u.thread ?? u.id) : undefined;
    if (f) {
      const m = messages.find((x) => x.ts === u.id)!;
      slice(f).messages.push(m);
      unplaced.splice(unplaced.indexOf(u), 1);
      if (u.id === (u.thread ?? u.id) && !threads[u.id]) learned[u.id] = { feature: f, by: "sweep", at };
    }
  }
  for (const l of batch.landings)
    if (!l.features.length)
      unplaced.push({ id: l.ref, kind: "landing", by: l.by, at: l.date, text: `${l.title}\n${l.files.join("\n")}`, url: l.url ?? "", candidates: [], batch: batch.id });

  const active = [...slices.keys()].sort();
  for (const u of unplaced) u.candidates = active.length ? active : features;
  for (const s of slices.values()) {
    s.messages.sort((a, b) => Number(a.ts) - Number(b.ts));
    s.landings.sort((a, b) => a.at.localeCompare(b.at));
  }
  return { slices: new Map([...slices].sort(([a], [b]) => a.localeCompare(b))), unplaced, threads: learned };
}

async function loadLedgers(): Promise<Map<string, Ledger>> {
  const out = new Map<string, Ledger>();
  for (const f of await listFeatures()) {
    const l = await readLedger(f);
    if (l) out.set(f, l);
  }
  return out;
}

export async function place(idOrPath: string, opts: PlaceOptions = {}): Promise<Placed> {
  const now = opts.now ?? new Date();
  const batch = await readBatch(idOrPath);
  const ledgers = opts.ledgers ?? (await loadLedgers());
  const threads = opts.threads ?? (await readThreads());
  const features = await listFeatures();
  const p = placeBatch(batch, ledgers, threads, features, now);
  const placed: Placed = { batch: batch.id, placed_at: now.toISOString(), slices: [...p.slices.values()], unplaced: p.unplaced.map((u) => u.id) };
  if (!opts.dryRun) {
    await Bun.write(placedPath(batch.id, opts.outDir ?? (idOrPath.endsWith(".json") ? idOrPath.replace(/[^/]+$/, "").replace(/\/$/, "") : undefined)), JSON.stringify(placed, null, 2) + "\n");
    if (Object.keys(p.threads).length) await writeThreads({ ...threads, ...p.threads });
    const existing = await readUnplaced();
    const ids = new Set(existing.map((u) => u.id));
    const merged = [...existing.filter((u) => !p.slices.size || !isPlacedNow(u, p)), ...p.unplaced.filter((u) => !ids.has(u.id))];
    await writeUnplaced(merged);
  }
  return placed;
}

/** an older unplaced message whose thread this batch taught is placed too */
const isPlacedNow = (u: Unplaced, p: Placement) => u.kind === "message" && (u.thread ?? u.id) in p.threads;
