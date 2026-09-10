#!/usr/bin/env bun
/**
 * Replay the fixture batches and score attribution against evals/expectations.json.
 *
 * Deterministic mode runs `placeBatch` alone, from empty ledgers and an empty thread map,
 * batch after batch, so threads learned in one batch count in the next. `--model` adds
 * the sweep's attribution step and the reader (task 15). Each run appends a dated line to
 * evals/scores.md.
 *
 *   bun run evals            deterministic
 *   bun run evals --model    with the model (not yet)
 */

import { join } from "node:path";
import { placeBatch } from "../scripts/argus/place.ts";
import { listFeatures } from "../scripts/argus/paths.ts";
import type { Ledger } from "../scripts/argus/schema.ts";
import type { ThreadMap } from "../scripts/argus/state.ts";
import { loadBatches, loadExpectations, resolved } from "./expectations.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SCORES = join(ROOT, "evals/scores.md");

export type Score = {
  /** items the user gave a feature */
  expected: number;
  hit: number;
  wrong: number;
  unplaced: number;
  /** items the user said belong nowhere */
  none: number;
  noneUnplaced: number;
  nonePlaced: number;
  unanswered: number;
  wrongOnes: { id: string; by: string; text: string; expected: string | null; got: string | null }[];
};

/** `got` maps an id to every feature it was placed on; a landing may be on several */
export function score(got: Map<string, string[]>, want: Map<string, string | null>, items: { id: string; by: string; text: string }[]): Score {
  const s: Score = { expected: 0, hit: 0, wrong: 0, unplaced: 0, none: 0, noneUnplaced: 0, nonePlaced: 0, unanswered: 0, wrongOnes: [] };
  for (const i of items) {
    if (!want.has(i.id)) { s.unanswered++; continue; }
    const w = want.get(i.id)!;
    const g = got.get(i.id) ?? [];
    if (w === null) {
      s.none++;
      if (!g.length) s.noneUnplaced++;
      else { s.nonePlaced++; s.wrongOnes.push({ ...i, expected: null, got: g.join("+") }); }
    } else {
      s.expected++;
      if (g.includes(w)) s.hit++;
      else if (!g.length) { s.unplaced++; s.wrongOnes.push({ ...i, expected: w, got: null }); }
      else { s.wrong++; s.wrongOnes.push({ ...i, expected: w, got: g.join("+") }); }
    }
  }
  return s;
}

export const fraction = (s: Score) => (s.expected ? s.hit / s.expected : 0);

export function format(s: Score, label: string): string {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
  return [
    `${label}: attribution ${pct(s.hit, s.expected)} (${s.hit}/${s.expected} on the expected feature; ${s.wrong} elsewhere, ${s.unplaced} unplaced)`,
    `  belongs nowhere: ${s.noneUnplaced}/${s.none} left unplaced, ${s.nonePlaced} wrongly placed; ${s.unanswered} unanswered`,
  ].join("\n");
}

async function deterministic() {
  const batches = await loadBatches();
  const e = await loadExpectations();
  const want = resolved(e);
  const features = await listFeatures();
  const ledgers = new Map<string, Ledger>();
  let threads: ThreadMap = {};
  const got = new Map<string, string[]>();
  const add = (id: string, f: string) => got.set(id, [...(got.get(id) ?? []), f]);
  for (const b of batches) {
    const p = placeBatch(b, ledgers, threads, features, new Date(b.pulled_at));
    for (const s of p.slices.values()) {
      for (const m of s.messages) add(m.ts, s.feature);
      for (const l of s.landings) add(l.ref, s.feature);
    }
    threads = { ...threads, ...p.threads };
  }
  return score(got, want, e.items);
}

if (import.meta.main) {
  if (process.argv.includes("--model")) {
    console.error("--model: not yet (task 15)");
    process.exit(2);
  }
  const s = await deterministic();
  const label = "deterministic";
  console.log(format(s, label));
  if (process.argv.includes("--wrong")) for (const w of s.wrongOnes) console.log(`  ${w.id}  ${w.by}: ${JSON.stringify(w.text.slice(0, 80))}  expected ${w.expected ?? "none"}, got ${w.got ?? "unplaced"}`);
  const line = `- ${new Date().toISOString().slice(0, 16).replace("T", " ")} ${label}: ${Math.round(100 * fraction(s))}% (${s.hit}/${s.expected}), ${s.nonePlaced} chat wrongly placed, ${s.unanswered} unanswered`;
  const f = Bun.file(SCORES);
  const prev = (await f.exists()) ? await f.text() : "# Replay scores\n\nOne line per run of `bun run evals`. The gate is attribution ≥ 80% with every closure case passing.\n\n";
  await Bun.write(SCORES, prev.trimEnd() + "\n" + line + "\n");
}
