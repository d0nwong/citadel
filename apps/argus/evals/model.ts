/**
 * The model replay (task 15): the sweep's two model steps, run day by day over the fixture
 * against a temp workspace, so a change to a prompt is measured the way a change to
 * `place.ts` is. Attribution runs `skills/sweep/attribute.md` on Sonnet over the unplaced
 * list; the reader runs `skills/sweep/reader.md` on Opus per feature slice and writes
 * through `writeLedger` (actor model), retrying once with the validator's problems. Every
 * call's tokens and cost are recorded.
 *
 * Task 289 adds `opts.readers = false` (AC1, S-22): the reader loop is skipped, so ledgers
 * stay at the state they were seeded with and never feed a later day's attribution prompt —
 * attribution itself (`attribute`) is unchanged. `opts.suggest` (AC2, S-23) asks Jev's Choice
 * once per thread that still has an unplaced message after attribution, the thread being the
 * one `place.ts` decided so huddle notes stand on their own; a thread's latest answer
 * overwrites its earlier one, so a thread that gains a message on a later day is asked again
 * and rescored with the new answer for every message it ever held.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch, Slice } from "../scripts/argus/batch.ts";
import { applyPatch, parsePatch } from "../scripts/argus/patch.ts";
import { featureDirOf, loadManifest } from "../scripts/argus/manifest.ts";
import { placeBatch } from "../scripts/argus/place.ts";
import { archExcerpt, attributePrompt, featureOptions, ledgerForReader, readerPrompt, renderMessages, renderSlice } from "../scripts/argus/reader.ts";
export { archExcerpt, ledgerForReader, renderMessages, renderSlice };
import { DEFAULT_APP, listFeatures, ledgerPath, root } from "../scripts/argus/paths.ts";
import type { Ledger } from "../scripts/argus/schema.ts";
import { flatten, type Msg } from "../scripts/argus/slack-pull.ts";
import type { ThreadMap, Unplaced } from "../scripts/argus/state.ts";
import { SchemaError } from "../scripts/argus/schema.ts";
import { type ChoiceOption, earlierMessages, suggestFeature, type SuggestResult, type SuggestState } from "../scripts/argus/suggest.ts";
export type { SuggestResult } from "../scripts/argus/suggest.ts";
import { ValidationError } from "../scripts/argus/validate.ts";
import { readLedger, writeLedger } from "../scripts/argus/write.ts";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
/** the features and manifest the run copies: ARGUS_ROOT, else this checkout */
const DATA = process.env.ARGUS_ROOT ?? REPO;
export const ATTRIBUTE_MODEL = "claude-sonnet-5";
export const READER_MODEL = "claude-opus-5";

export type Call = { step: "attribute" | "read"; feature?: string; day: string; model: string; input: number; output: number; cost: number; seconds: number; ok: boolean; note?: string };

// ---------------------------------------------------------------- claude -p

export async function ask(model: string, prompt: string, opts: { cwd?: string; label?: string } = {}): Promise<{ text: string; input: number; output: number; cost: number; seconds: number }> {
  const t0 = Date.now();
  const p = Bun.spawn(["claude", "-p", "--model", model, "--output-format", "json", "--permission-mode", "default", "--max-turns", "1", "--disallowedTools", "*"], {
    cwd: opts.cwd ?? tmpdir(),
    stdin: new Response(prompt),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`claude -p (${opts.label ?? model}) exited ${code}: ${err.slice(0, 400)}`);
  const j = JSON.parse(out) as { result?: string; total_cost_usd?: number; usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number } };
  const u = j.usage ?? { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  return { text: j.result ?? "", input: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, output: u.output_tokens, cost: j.total_cost_usd ?? 0, seconds: (Date.now() - t0) / 1000 };
}

/** the first JSON object or array in a reply, fenced or bare */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text)!.trim();
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(body.slice(start, body.lastIndexOf(body[start] === "{" ? "}" : "]") + 1));
}

// ---------------------------------------------------------------- rendering



// ---------------------------------------------------------------- days

export function splitByDay(b: Batch): Batch[] {
  const days = new Map<string, Batch>();
  const day = (d: string) => {
    if (!days.has(d)) days.set(d, { id: `${b.id}-${d}`, pulled_at: `${d}T23:59:59Z`, since: b.since, slack: b.slack ? { ...b.slack, newTopLevel: [], threads: [] } : null, landings: [] });
    return days.get(d)!;
  };
  for (const m of b.slack ? flatten(b.slack) : []) day(m.date).slack!.newTopLevel.push(m);
  for (const l of b.landings) day(l.date).landings.push(l);
  return [...days.entries()].sort(([a], [c]) => a.localeCompare(c)).map(([, v]) => v);
}

// ---------------------------------------------------------------- the two steps


export async function attribute(unplaced: Unplaced[], features: string[], day: string, calls: Call[], allMessages: Msg[], askFn: typeof ask = ask): Promise<Record<string, string[]>> {
  if (!unplaced.length) return {};
  const batch: Batch = { id: day, pulled_at: `${day}T00:00:00Z`, since: { slack: null, fe: null, be: null }, slack: { since: "0", now: "", newTopLevel: allMessages, threads: [], noiseDropped: 0, expiredThreads: [], next: { last_ts: "0", watched_threads: {} } }, landings: [] };
  const prompt = await attributePrompt(unplaced, features.map((feature) => ({ app: DEFAULT_APP, feature })), batch);
  try {
    const r = await askFn(ATTRIBUTE_MODEL, prompt, { label: `attribute ${day}` });
    const j = extractJson(r.text) as Record<string, { feature: string | string[] | null }>;
    calls.push({ step: "attribute", day, model: ATTRIBUTE_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: true });
    const out: Record<string, string[]> = {};
    for (const [id, v] of Object.entries(j)) {
      const raw = v && typeof v === "object" ? v.feature : null;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f) => typeof f === "string" && features.includes(f)).slice(0, 2);
      out[id] = list;
    }
    return out;
  } catch (e) {
    calls.push({ step: "attribute", day, model: ATTRIBUTE_MODEL, input: 0, output: 0, cost: 0, seconds: 0, ok: false, note: String((e as Error).message).slice(0, 200) });
    return {};
  }
}



export const RAW_DIR = join(REPO, "evals/last-run");

export async function read(feature: string, slice: Slice, day: string, calls: Call[], askFn: typeof ask = ask): Promise<{ ok: boolean; diff: string[]; note?: string; notes?: string[] }> {
  const before = await readLedger(feature);
  if (!before) return { ok: false, diff: [], note: "no ledger" };
  // code knows the landings; put them on the ledger first, the model only links them
  const fresh = slice.landings.filter((l) => !before.landings.some((x) => x.ref === l.ref)).map((l) => ({ at: l.at, repo: l.repo, ref: l.ref, number: l.number, sha: l.sha, title: l.title, by: l.by, url: l.url, asks: [], files: l.files }));
  if (fresh.length) await writeLedger(feature, applyPatch(before, { landings: { add: fresh } }), { actor: "model", now: new Date(`${day}T22:00:00Z`) });
  const ledger = (await readLedger(feature))!;
  const base = await readerPrompt(feature, slice, day);
  let prompt = base;
  const stamp = `${day}-${feature.replace("/", "_")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await askFn(READER_MODEL, prompt, { label: `read ${feature} ${day}` });
    } catch (e) {
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: 0, output: 0, cost: 0, seconds: 0, ok: false, note: String((e as Error).message).slice(0, 200) });
      return { ok: false, diff: [], note: (e as Error).message };
    }
    mkdirSync(RAW_DIR, { recursive: true });
    await Bun.write(join(RAW_DIR, `${stamp}-${attempt}.md`), `${prompt}\n\n# ===== reply =====\n\n${r.text}`);
    try {
      const patch = parsePatch(extractJson(r.text));
      const next = applyPatch(ledger, patch);
      const w = await writeLedger(feature, next, { actor: "model", now: new Date(`${day}T23:00:00Z`) });
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: true, note: attempt ? "after one retry" : undefined });
      return { ok: true, diff: w.diff, notes: patch.notes };
    } catch (e) {
      const problems = e instanceof ValidationError ? e.problems.map((p) => `${p.path}: ${p.rule}`).join("\n") : e instanceof SchemaError ? e.message : String((e as Error).message);
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: false, note: problems.slice(0, 300) });
      if (attempt) return { ok: false, diff: [], note: problems };
      prompt = `${base}\n\n# Your previous answer was refused\n\n\`\`\`\n${r.text.slice(0, 6000)}\n\`\`\`\n\nProblems:\n${problems}\n\nFix exactly those and return the whole patch again.`;
    }
  }
  return { ok: false, diff: [] };
}

export type SuggestCall = { thread: string; day: string; model: string; ok: boolean; note?: string };

/**
 * One Choice question per thread that still has an unplaced message today (AC2, S-23), the
 * thread being the one `place.ts` decided: an unplaced entry's own `thread`, else its id.
 * That is what makes huddle notes their own thread rather than a reply under Slackbot's
 * "huddle started" message, and it is the key the scorer joins on, so both sides agree.
 * A thread whose call fails is logged and left out of the answers — the caller keeps
 * whatever it already had for that thread, as a later day's success would replace it.
 */
export async function suggestDay(
  stillUnplaced: Unplaced[],
  allMessages: Msg[],
  featureList: { app: string; feature: string }[],
  day: string,
  calls: SuggestCall[],
  suggestFn: typeof suggestFeature = suggestFeature,
  opts: { fetch?: typeof fetch; apiKey?: string | null } = {},
  /** every message seen so far, earlier days included: the channel context before each thread */
  history: Msg[] = allMessages,
): Promise<Map<string, SuggestResult>> {
  const out = new Map<string, SuggestResult>();
  const messages = stillUnplaced.filter((u) => u.kind === "message");
  if (!messages.length) return out;
  const options: ChoiceOption[] = await featureOptions(featureList);
  const byId = new Map(allMessages.map((m) => [m.ts, m]));
  const groups = new Map<string, Msg[]>();
  for (const u of messages) {
    const m = byId.get(u.id);
    if (!m) continue;
    const thread = u.thread ?? u.id;
    groups.set(thread, [...(groups.get(thread) ?? []), m]);
  }
  for (const [thread, msgs] of groups) {
    try {
      const earlier = earlierMessages(msgs[0]!, history);
      const state: SuggestState = earlier.length ? { earlier_messages: renderMessages(earlier), thread: renderMessages(msgs) } : renderMessages(msgs);
      const r = await suggestFn(state, options, opts);
      out.set(thread, r);
      calls.push({ thread, day, model: r.model, ok: true });
    } catch (e) {
      calls.push({ thread, day, model: "", ok: false, note: String((e as Error).message).slice(0, 200) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the run

export type ModelRun = {
  got: Map<string, string[]>;
  /** the days that ran, YYYY-MM-DD */
  days: string[];
  calls: Call[];
  ledgers: Record<string, Ledger>;
  workspace: string;
  /** every message id attribution still leaves unplaced → its thread root; filled only when `opts.suggest` runs */
  declinedThread: Map<string, string>;
  /** thread root → Jev's latest answer for it; filled only when `opts.suggest` runs */
  suggestions: Map<string, SuggestResult>;
  suggestCalls: SuggestCall[];
};

export async function runModel(
  batches: Batch[],
  opts: {
    features: string[];
    days?: number;
    keep?: boolean;
    log?: (s: string) => void;
    /** claude -p, injectable so a test never shells out for real */
    ask?: typeof ask;
    /** run the reader after attribution; false leaves ledgers at their seeded state (AC1, S-22) */
    readers?: boolean;
    /** score Jev's Choice against the messages attribution leaves unplaced */
    suggest?: { fetch?: typeof fetch; apiKey?: string | null; suggestFn?: typeof suggestFeature };
  },
): Promise<ModelRun> {
  const log = opts.log ?? (() => {});
  const ws = mkdtempSync(join(tmpdir(), "argus-replay-"));
  for (const f of await listFeatures()) {
    const src = ledgerPath(f);
    mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
    if (await Bun.file(src).exists()) {
      const l = (await Bun.file(src).json()) as Ledger;
      await Bun.write(join(ws, "alden/alden-portal/features", f, "ledger.json"), JSON.stringify({ ...l, as_of: "2026-01-01T00:00:00.000Z" }, null, 2));
    }
    const arch = join(DATA, "alden/alden-portal/features", f, "docs/arch.md");
    if (await Bun.file(arch).exists()) cpSync(arch, join(ws, "alden/alden-portal/features", f, "docs/arch.md"));
  }
  cpSync(join(DATA, "alden/alden-portal/.doc-workspace"), join(ws, "alden/alden-portal/.doc-workspace"), { recursive: true });
  const prevRoot = process.env.ARGUS_ROOT;
  process.env.ARGUS_ROOT = ws;
  try {
    const askFn = opts.ask ?? ask;
    const readers = opts.readers ?? true;
    const features = await listFeatures();
    const calls: Call[] = [];
    const got = new Map<string, string[]>();
    const add = (id: string, f: string) => got.set(id, [...new Set([...(got.get(id) ?? []), f])]);
    let threads: ThreadMap = {};
    const declinedThread = new Map<string, string>();
    const suggestions = new Map<string, SuggestResult>();
    const suggestCalls: SuggestCall[] = [];
    const history: Msg[] = [];
    const days = batches.flatMap(splitByDay).slice(0, opts.days ?? Infinity);
    for (const b of days) {
      const day = b.id.slice(-10);
      const ledgers = new Map<string, Ledger>();
      for (const f of features) {
        const l = await readLedger(f);
        if (l) ledgers.set(f, l);
      }
      const p = placeBatch(b, ledgers, threads, features, new Date(b.pulled_at));
      threads = { ...threads, ...p.threads };
      const all = b.slack ? flatten(b.slack) : [];
      const chosen = await attribute(p.unplaced, features, day, calls, all, askFn);
      // apply the model's placements: message → slice(s), thread → learned (first feature); a second feature also sees it
      const also: Record<string, string> = {};
      const put = (f: string, m: Msg) => {
        if (!p.slices.has(f)) p.slices.set(f, { feature: f, messages: [], landings: [] });
        if (!p.slices.get(f)!.messages.some((x) => x.ts === m.ts)) p.slices.get(f)!.messages.push(m);
      };
      for (const u of p.unplaced) {
        const fs = chosen[u.id] ?? [];
        if (!fs.length || u.kind !== "message") continue;
        const m = all.find((x) => x.ts === u.id)!;
        for (const f of fs) put(f, m);
        if (!threads[m.thread]) threads[m.thread] = { feature: fs[0]!, by: "sweep", at: b.pulled_at };
        if (fs[1]) also[m.thread] = fs[1];
      }
      // a reply whose root the model just placed follows it
      for (const u of p.unplaced) {
        if (chosen[u.id]?.length || u.kind !== "message" || !u.thread) continue;
        const f = threads[u.thread]?.feature;
        if (!f) continue;
        const m = all.find((x) => x.ts === u.id)!;
        put(f, m);
        if (also[u.thread]) put(also[u.thread]!, m);
      }
      for (const s of p.slices.values()) {
        s.messages.sort((a, c) => Number(a.ts) - Number(c.ts));
        for (const m of s.messages) add(m.ts, s.feature);
        for (const l of s.landings) add(l.ref, s.feature);
      }
      log(`${day}: ${all.length} msgs, ${b.landings.length} landings; ${p.unplaced.length} unplaced → ${Object.values(chosen).filter((f) => f.length).length} placed by the model`);
      // AC2 (S-23): suggest runs after attribute, over whatever it still leaves unplaced today
      if (opts.suggest) {
        const stillUnplaced = p.unplaced.filter((u) => u.kind === "message" && !got.has(u.id));
        for (const u of stillUnplaced) declinedThread.set(u.id, u.thread ?? u.id);
        history.push(...all);
        const answers = await suggestDay(stillUnplaced, all, features.map((feature) => ({ app: DEFAULT_APP, feature })), day, suggestCalls, opts.suggest.suggestFn, opts.suggest, history);
        for (const [thread, r] of answers) suggestions.set(thread, r); // a later day's answer overwrites an earlier one
      }
      // AC1 (S-22): with readers off, ledgers stay at their seeded state for every day's attribution prompt
      if (readers) {
        for (const f of opts.features) {
          const s = p.slices.get(f);
          if (!s || (!s.messages.length && !s.landings.length)) continue;
          const r = await read(f, s, day, calls, askFn);
          log(`  read ${f}: ${r.ok ? r.diff.join(" · ") || "unchanged" : `FAILED ${r.note?.split("\n")[0]}`}${r.notes?.length ? `\n    notes: ${r.notes.join(" | ")}` : ""}`);
        }
      }
    }
    const ledgers: Record<string, Ledger> = {};
    for (const f of opts.features) {
      const l = await readLedger(f);
      if (l) ledgers[f] = l;
    }
    return { got, calls, ledgers, workspace: ws, days: days.map((b) => b.id.slice(-10)), declinedThread, suggestions, suggestCalls };
  } finally {
    if (prevRoot === undefined) delete process.env.ARGUS_ROOT;
    else process.env.ARGUS_ROOT = prevRoot;
    if (!opts.keep) rmSync(ws, { recursive: true, force: true });
  }
}

/** the closure cases against the final ledgers */
export function scoreClosures(cases: { feature: string; root: string; closes_on: string | null; why?: string }[], ledgers: Record<string, Ledger>): { pass: boolean; line: string }[] {
  return cases.map((c) => {
    const l = ledgers[c.feature];
    const inThread = (url: string) => url.includes(`p${c.root.replace(".", "")}`) || url.includes(`thread_ts=${c.root}`);
    const ask =
      l?.asks.find((a) => a.origin.kind !== "ticket" && a.origin.thread === c.root) ??
      l?.asks.find((a) => (a.origin.kind !== "ticket" && inThread(a.origin.url)) || a.history.some((h) => h.evidence.some((e) => e.kind === "slack" && inThread(e.url))));
    if (!ask) return { pass: false, line: `${c.feature} ${c.root}: no ask recorded for this thread (${c.why ?? ""})` };
    const closed = ask.status === "closed";
    if (c.closes_on === null) return { pass: !closed, line: `${c.feature} ${ask.id} "${ask.text}": ${closed ? "CLOSED, should stay open" : `open (${ask.status}), as expected`}` };
    const entry = ask.history.find((h) => h.status === "closed");
    const cites = entry?.evidence.some((e) => e.kind === "slack" && e.url.includes(`p${c.closes_on!.replace(".", "")}`)) ?? false;
    const dayOf = (ts: string) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    const onDay = entry ? entry.at >= dayOf(c.closes_on) : false;
    return { pass: closed && onDay, line: `${c.feature} ${ask.id} "${ask.text}": ${closed ? `closed ${entry?.at}${cites ? ", citing the message" : ", citing something else"}${onDay ? "" : " (TOO EARLY)"}` : `NOT CLOSED (${ask.status})`}` };
  });
}
