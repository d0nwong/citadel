#!/usr/bin/env bun
/**
 * The expectations file for the replay: every message and landing in the fixture batches,
 * with the feature the user says it belongs to (`null` for none). `--init` writes it,
 * pre-filled from the deterministic joins where they fire and from the old `work.json`
 * thread keys where they do not, so the user corrects rather than fills. Without a flag
 * it checks that every id in the fixtures appears exactly once.
 *
 *   bun evals/expectations.ts --init     write evals/expectations.json (refuses to overwrite)
 *   bun evals/expectations.ts            check coverage
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { placeBatch } from "../scripts/argus/place.ts";
import { listFeatures } from "../scripts/argus/paths.ts";
import { flatten } from "../scripts/argus/slack-pull.ts";
import type { Batch } from "../scripts/argus/batch.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = join(ROOT, "evals/fixtures/batches");
const OUT = join(ROOT, "evals/expectations.json");

export type Expectation = {
  id: string;
  kind: "message" | "landing";
  /** the thread root for a reply */
  thread?: string;
  by: string;
  at: string;
  text: string;
  /** the feature this belongs to; null = none (chat, logistics); "?" = the user has not said */
  feature: string | null | "?";
  /** how the prefill decided, for the user's eye */
  prefilled_by?: "thread" | "key" | "work.json" | "landing" | "reply";
};

export type Expectations = {
  batches: string[];
  items: Expectation[];
  /** asks that must close, or must stay open, on a named message; filled by hand in task 16 */
  closures: { feature: string; ask: string; closes_on: string | null }[];
};

export async function loadBatches(): Promise<Batch[]> {
  return Promise.all(
    readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".placed.json")).sort().map((f) => Bun.file(join(DIR, f)).json() as Promise<Batch>),
  );
}

/** thread root → feature dir, from every old work.json's keys.threads */
async function workJsonThreads(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const base = join(ROOT, "alden/alden-portal/features");
  for await (const p of new Bun.Glob("**/work.json").scan({ cwd: base, absolute: true })) {
    const w = await Bun.file(p).json();
    const feature = p.slice(base.length + 1).replace(/\/work\.json$/, "");
    for (const t of w.keys?.threads ?? []) out[t] = feature;
  }
  return out;
}

async function init() {
  if (await Bun.file(OUT).exists()) throw new Error(`${OUT} exists; delete it to start over`);
  const batches = await loadBatches();
  const features = await listFeatures();
  const wj = await workJsonThreads();
  const items: Expectation[] = [];
  for (const b of batches) {
    const p = placeBatch(b, new Map(), {}, features, new Date(b.pulled_at));
    const placedMsg = new Map<string, string>();
    const placedLanding = new Map<string, string>();
    for (const s of p.slices.values()) {
      for (const m of s.messages) placedMsg.set(m.ts, s.feature);
      for (const l of s.landings) if (!placedLanding.has(l.ref)) placedLanding.set(l.ref, s.feature);
    }
    const byThread = new Map<string, string>();
    for (const m of b.slack ? flatten(b.slack) : []) {
      const reply = m.thread !== m.ts;
      let feature: Expectation["feature"] = "?";
      let by: Expectation["prefilled_by"] | undefined;
      if (placedMsg.has(m.ts)) { feature = placedMsg.get(m.ts)!; by = "key"; }
      else if (wj[m.thread]) { feature = wj[m.thread]!; by = "work.json"; }
      else if (reply && byThread.has(m.thread)) { feature = byThread.get(m.thread)!; by = "reply"; }
      if (feature !== "?") byThread.set(m.thread, feature);
      items.push({ id: m.ts, kind: "message", ...(reply ? { thread: m.thread } : {}), by: m.author, at: `${m.date} ${m.time}`, text: m.text.slice(0, 200), feature, ...(by ? { prefilled_by: by } : {}) });
    }
    for (const l of b.landings)
      items.push({ id: l.ref, kind: "landing", by: l.by, at: l.date, text: `${l.title} [${l.features.join(", ") || "unmapped"}]`, feature: l.features[0] ?? "?", ...(l.features[0] ? { prefilled_by: "landing" as const } : {}) });
  }
  const e: Expectations = { batches: batches.map((b) => b.id), items, closures: [] };
  await Bun.write(OUT, JSON.stringify(e, null, 2) + "\n");
  const n = (k: string) => items.filter((i) => i.kind === k).length;
  const pre = items.filter((i) => i.feature !== "?").length;
  console.log(`${OUT}: ${n("message")} messages, ${n("landing")} landings; ${pre} pre-filled, ${items.length - pre} for you to place`);
}

/** a reply with no answer of its own takes its root's; the user places roots only */
export function resolved(e: Expectations): Map<string, string | null> {
  const byId = new Map(e.items.map((i) => [i.id, i]));
  const out = new Map<string, string | null>();
  for (const i of e.items) {
    let f = i.feature;
    if (f === "?" && i.thread) f = byId.get(i.thread)?.feature ?? "?";
    if (f !== "?") out.set(i.id, f);
  }
  return out;
}

export const loadExpectations = async () => (await Bun.file(OUT).json()) as Expectations;

async function check() {
  const e = await loadExpectations();
  const ids = new Set<string>();
  for (const b of await loadBatches()) {
    for (const m of b.slack ? flatten(b.slack) : []) ids.add(m.ts);
    for (const l of b.landings) ids.add(l.ref);
  }
  const seen = new Map<string, number>();
  for (const i of e.items) seen.set(i.id, (seen.get(i.id) ?? 0) + 1);
  const missing = [...ids].filter((id) => !seen.has(id));
  const extra = [...seen.keys()].filter((id) => !ids.has(id));
  const dup = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  const answered = resolved(e);
  const open = e.items.filter((i) => !answered.has(i.id)).length;
  const openRoots = e.items.filter((i) => i.feature === "?" && !i.thread).length;
  const features = new Set(await listFeatures());
  const unknown = e.items.filter((i) => typeof i.feature === "string" && i.feature !== "?" && !features.has(i.feature)).map((i) => `${i.id} → ${i.feature}`);
  const problems = [
    ...missing.map((m) => `missing: ${m}`),
    ...extra.map((m) => `not in any batch: ${m}`),
    ...dup.map((m) => `listed twice: ${m}`),
    ...unknown.map((u) => `not a feature: ${u}`),
  ];
  for (const p of problems) console.error(p);
  console.log(`${e.items.length} items, ${open} unanswered (${openRoots} roots to place), ${e.closures.length} closure cases`);
  return problems.length ? 1 : 0;
}

if (import.meta.main) {
  const code = process.argv.includes("--init") ? await init().then(() => 0) : await check();
  process.exit(code);
}
