#!/usr/bin/env bun
/**
 * Replay the fixture batches and score attribution against evals/expectations.json.
 *
 * Deterministic mode runs `placeBatch` alone, from empty ledgers and an empty thread map,
 * batch after batch, so threads learned in one batch count in the next. `--model` adds
 * the sweep's attribution step and the reader (task 15). `--no-reader` (AC1, S-22) runs
 * attribution alone, skipping the reader so ledgers stay seeded; `--suggest` (AC2, S-23)
 * implies `--no-reader` — the declined set it scores against Jev is exactly what a
 * no-reader run leaves unplaced — and adds a second line scoring Jev's Choice per declined
 * thread. Each run appends a dated line to evals/scores.md.
 *
 *   bun run evals                 deterministic
 *   bun run evals --model         with the model, reader included
 *   bun run evals --no-reader     attribution alone, no reader
 *   bun run evals --suggest       attribution alone, plus Jev's suggestions on what it declines
 */

import { join } from "node:path";
import { placeBatch } from "../scripts/argus/place.ts";
import { listFeatures } from "../scripts/argus/paths.ts";
import type { Ledger } from "../scripts/argus/schema.ts";
import type { SuggestResult } from "../scripts/argus/suggest.ts";
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
export function score(got: Map<string, string[]>, want: Map<string, string | null>, items: { id: string; by: string; text: string; thread?: string }[]): Score {
  const s: Score = { expected: 0, hit: 0, wrong: 0, unplaced: 0, none: 0, noneUnplaced: 0, nonePlaced: 0, unanswered: 0, wrongOnes: [] };
  for (const i of items) {
    if (!want.has(i.id)) { s.unanswered++; continue; }
    const w = want.get(i.id)!;
    // a chat reply inside a thread the user placed: the thread rule puts it with its root, and that is fine
    if (w === null && i.thread && typeof want.get(i.thread) === "string") continue;
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

// ---------------------------------------------------------------- AC2: scoring Jev (task 289)

export type Band = { hit: number; total: number };
export type SuggestScoreResult = {
  /** every declined message, whether or not it was scored (unanswered items and calls that failed are left out below) */
  declined: number;
  feature: Band;
  none: Band;
  high: { feature: Band; none: Band };
  low: { feature: Band; none: Band };
  /** the version that answered, from any one scored call; null when nothing was scored */
  model: string | null;
};

/**
 * Jev's Choice, scored the way attribution's own `score` is (S-23): the share of
 * on-a-feature items whose suggestion names that feature, the share of nowhere items whose
 * suggestion is nothing — leaving out a reply whose thread is expected on a feature, the
 * same exclusion `score` uses — each again split at the median confidence among what was
 * scored. A guess at the median counts as the high band (jev-suggest, spec assumption); a
 * band with nothing in it reports as empty, not a false 0%.
 */
export function scoreSuggestions(
  run: { declinedThread: Map<string, string>; suggestions: Map<string, SuggestResult> },
  want: Map<string, string | null>,
  items: { id: string; by: string; text: string; thread?: string }[],
): SuggestScoreResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  type Row = { expected: string | null; suggested: string | null; confidence: number; model: string };
  const rows: Row[] = [];
  for (const [id, thread] of run.declinedThread) {
    if (!want.has(id)) continue;
    const w = want.get(id)!;
    const item = byId.get(id);
    // a chat reply inside a thread the user placed: the same exclusion attribution's own score() uses
    if (w === null && item?.thread && typeof want.get(item.thread) === "string") continue;
    const answer = run.suggestions.get(thread);
    if (!answer) continue; // never asked, or the call failed — not scored
    rows.push({ expected: w, suggested: answer.choice === "nothing" ? null : answer.choice, confidence: answer.confidence, model: answer.model });
  }
  const empty = (): Band => ({ hit: 0, total: 0 });
  const build = (rs: Row[]) => {
    const feature = empty();
    const none = empty();
    for (const r of rs) {
      if (r.expected === null) {
        none.total++;
        if (r.suggested === null) none.hit++;
      } else {
        feature.total++;
        if (r.suggested === r.expected) feature.hit++;
      }
    }
    return { feature, none };
  };
  const sortedConfidence = rows.map((r) => r.confidence).sort((a, b) => a - b);
  const median = sortedConfidence.length ? sortedConfidence[Math.floor((sortedConfidence.length - 1) / 2)]! : null;
  const overall = build(rows);
  const high = median === null ? [] : rows.filter((r) => r.confidence >= median);
  const low = median === null ? [] : rows.filter((r) => r.confidence < median);
  // the version that answered: a scored row's, else any answer's — Jev answering but nothing scoring still names it
  const model = rows[0]?.model ?? run.suggestions.values().next().value?.model ?? null;
  return { declined: run.declinedThread.size, feature: overall.feature, none: overall.none, high: build(high), low: build(low), model };
}

export function formatSuggestions(s: SuggestScoreResult): string {
  const pct = (b: Band) => (b.total ? `${Math.round((100 * b.hit) / b.total)}% (${b.hit}/${b.total})` : "empty");
  return [
    `suggestions: on a feature ${pct(s.feature)}, nothing ${pct(s.none)}; ${s.declined} declined; jev ${s.model ?? "none answered"}`,
    `  high confidence: on a feature ${pct(s.high.feature)}, nothing ${pct(s.high.none)}`,
    `  low confidence: on a feature ${pct(s.low.feature)}, nothing ${pct(s.low.none)}`,
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

async function model(days?: number, keep = false, opts: { noReader?: boolean; suggest?: boolean } = {}) {
  const { runModel, scoreClosures } = await import("./model.ts");
  const batches = await loadBatches();
  const e = await loadExpectations();
  // a no-reader or suggest run scores every feature the fixtures cover, not just the closure ones the reader needs
  const features = opts.noReader || opts.suggest ? await listFeatures() : [...new Set(e.closures.map((c) => c.feature))].sort();
  const run = await runModel(batches, {
    features,
    days,
    keep,
    log: (l) => console.log(l),
    readers: !(opts.noReader || opts.suggest),
    suggest: opts.suggest ? { apiKey: process.env.TYPESAFE_API_KEY } : undefined,
  });
  const ran = new Set(run.days);
  const items = e.items.filter((i) => ran.has(i.at.slice(0, 10)));
  const s = score(run.got, resolved(e), items);
  if (process.argv.includes("--wrong")) for (const w of s.wrongOnes) console.log(`  wrong ${w.id}  ${w.by}: ${JSON.stringify(w.text.slice(0, 70))}  expected ${w.expected ?? "none"}, got ${w.got ?? "unplaced"}`);
  // attribution costs and fails whether or not the reader ran, so this line is always worth printing
  const cost = run.calls.reduce((n, c) => n + c.cost, 0);
  const biggest = run.calls.reduce((m, c) => (c.input > m ? c.input : m), 0);
  const failed = run.calls.filter((c) => !c.ok);
  console.log(`calls: ${run.calls.length} (${failed.length} failed), cost $${cost.toFixed(2)}, largest input ${biggest} tokens`);
  for (const c of failed) console.log(`  failed ${c.step} ${c.feature ?? ""} ${c.day}: ${c.note}`);
  // closures are the reader's work; with no reader there is nothing for them to read
  let closures: { pass: boolean; line: string }[] = [];
  if (!opts.noReader && !opts.suggest) {
    closures = scoreClosures(e.closures, run.ledgers);
    for (const c of closures) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.line}`);
  }
  let suggest: SuggestScoreResult | undefined;
  if (opts.suggest) {
    const failedSuggests = run.suggestCalls.filter((c) => !c.ok);
    console.log(`suggestion calls: ${run.suggestCalls.length} (${failedSuggests.length} failed)`);
    for (const c of failedSuggests) console.log(`  failed suggest ${c.thread} ${c.day}: ${c.note}`);
    suggest = scoreSuggestions(run, resolved(e), items);
    console.log(formatSuggestions(suggest));
  }
  if (keep) console.log(`workspace kept at ${run.workspace}`);
  return { s, closures, cost, biggest, calls: run.calls.length, suggest };
}

export type Mode = { isModel: boolean; noReader: boolean; suggest: boolean; days?: number; keep: boolean; label: string };

/** which run the flags ask for, and what the scores.md line calls it */
export function modeOf(argv: string[]): Mode {
  const opt = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const noReader = argv.includes("--no-reader");
  const suggest = argv.includes("--suggest");
  // both new modes are model runs: attribution still runs, it is the reader that does not
  const isModel = argv.includes("--model") || noReader || suggest;
  const days = opt("--days") ? Number(opt("--days")) : undefined;
  const label = isModel
    ? `model${days ? ` (${days} days)` : ""}${suggest ? ", suggest" : noReader ? ", no reader" : ""}`
    : "deterministic";
  return { isModel, noReader, suggest, days, keep: argv.includes("--keep"), label };
}

if (import.meta.main) {
  const { isModel, noReader, suggest, days, keep, label } = modeOf(process.argv.slice(2));
  let s: Score;
  let extra = "";
  let suggestResult: SuggestScoreResult | undefined;
  if (isModel) {
    const r = await model(days, keep, { noReader, suggest });
    s = r.s;
    suggestResult = r.suggest;
    extra = noReader || suggest ? "" : `, closures ${r.closures.filter((c) => c.pass).length}/${r.closures.length}, $${r.cost.toFixed(2)} over ${r.calls} calls, largest input ${r.biggest}`;
  } else s = await deterministic();
  console.log(format(s, label));
  if (process.argv.includes("--wrong")) for (const w of s.wrongOnes) console.log(`  ${w.id}  ${w.by}: ${JSON.stringify(w.text.slice(0, 80))}  expected ${w.expected ?? "none"}, got ${w.got ?? "unplaced"}`);
  const pct = (b: Band) => (b.total ? `${Math.round((100 * b.hit) / b.total)}% (${b.hit}/${b.total})` : "empty");
  const suggestExtra = suggestResult
    ? `; suggestions: on-feature ${pct(suggestResult.feature)}, nothing ${pct(suggestResult.none)}, ${suggestResult.declined} declined, high(on-feature ${pct(suggestResult.high.feature)}, nothing ${pct(suggestResult.high.none)}), low(on-feature ${pct(suggestResult.low.feature)}, nothing ${pct(suggestResult.low.none)}), jev ${suggestResult.model ?? "none answered"}`
    : "";
  const line = `- ${new Date().toISOString().slice(0, 16).replace("T", " ")} ${label}: ${Math.round(100 * fraction(s))}% (${s.hit}/${s.expected}), ${s.nonePlaced} chat wrongly placed, ${s.unanswered} unanswered${extra}${suggestExtra}`;
  const f = Bun.file(SCORES);
  const prev = (await f.exists()) ? await f.text() : "# Replay scores\n\nOne line per run of `bun run evals`. The gate is attribution ≥ 80% with every closure case passing.\n\n";
  await Bun.write(SCORES, prev.trimEnd() + "\n" + line + "\n");
}
