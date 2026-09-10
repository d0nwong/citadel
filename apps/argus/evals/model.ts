/**
 * The model replay (task 15): the sweep's two model steps, run day by day over the fixture
 * against a temp workspace, so a change to a prompt is measured the way a change to
 * `place.ts` is. Attribution runs `skills/sweep/attribute.md` on Sonnet over the unplaced
 * list; the reader runs `skills/sweep/reader.md` on Opus per feature slice and writes
 * through `writeLedger` (actor model), retrying once with the validator's problems. Every
 * call's tokens and cost are recorded.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch, Slice } from "../scripts/argus/batch.ts";
import { placeBatch } from "../scripts/argus/place.ts";
import { listFeatures, ledgerPath, root } from "../scripts/argus/paths.ts";
import type { Ledger } from "../scripts/argus/schema.ts";
import { flatten, type Msg } from "../scripts/argus/slack-pull.ts";
import type { ThreadMap, Unplaced } from "../scripts/argus/state.ts";
import { ValidationError } from "../scripts/argus/validate.ts";
import { readLedger, writeLedger } from "../scripts/argus/write.ts";

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
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

export function renderMessages(messages: Msg[]): string {
  return messages
    .map((m) => {
      const flags = [m.mentionsMe ? "→you" : "", m.bot ? "[bot]" : ""].filter(Boolean).join(" ");
      const where = m.thread === m.ts ? "root" : `reply in ${m.thread}`;
      const tail = [m.reactions && `reactions: ${m.reactions}`, ...m.files.map((f) => `file: ${f}`)].filter(Boolean).join("; ");
      return `[${m.ts}] ${m.date} ${m.time} ${m.author}${flags ? ` ${flags}` : ""} (${where}) ${m.permalink}\n${m.text}${m.canvas ? `\n--- huddle notes ---\n${m.canvas}\n--- end ---` : ""}${tail ? `\n(${tail})` : ""}`;
    })
    .join("\n\n");
}

export function renderSlice(s: Slice): string {
  const landings = s.landings
    .map((l) => `[${l.ref}] ${l.date} ${l.by} ${l.url ?? ""}\n${l.title}${l.ticketKeys.length ? `\ntickets: ${l.ticketKeys.join(", ")}` : ""}\nsha ${l.sha}\nfiles: ${l.files.slice(0, 40).join(", ")}${l.files.length > 40 ? ` (+${l.files.length - 40})` : ""}${l.routes.length ? `\nroutes: ${l.routes.join(", ")}` : ""}`)
    .join("\n\n");
  return `## Messages (${s.messages.length})\n\n${renderMessages(s.messages) || "none"}\n\n## Landings (${s.landings.length})\n\n${landings || "none"}`;
}

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

async function summaries(features: string[]): Promise<string> {
  const out: string[] = [];
  for (const f of features) {
    const l = await readLedger(f);
    const asks = (l?.asks ?? []).filter((a) => a.status !== "closed" && a.status !== "dropped").map((a) => `    - ${a.text}`);
    out.push(`- ${f}${l?.summary ? ` — ${l.summary}` : ""}${asks.length ? `\n${asks.join("\n")}` : ""}`);
  }
  return out.join("\n");
}

export async function attribute(unplaced: Unplaced[], features: string[], day: string, calls: Call[], allMessages: Msg[]): Promise<Record<string, string | null>> {
  if (!unplaced.length) return {};
  const skill = await Bun.file(join(REPO, "skills/sweep/attribute.md")).text();
  const byId = new Map(allMessages.map((m) => [m.ts, m]));
  const items = unplaced.map((u) => {
    const m = byId.get(u.id);
    return m ? renderMessages([m]) : `[${u.id}] ${u.at} ${u.by} (landing)\n${u.text}`;
  });
  const prompt = `${skill}\n\n# Features\n\n${await summaries(features)}\n\n# Unplaced (${unplaced.length})\n\n${items.join("\n\n")}\n\nAnswer with the JSON object only.`;
  try {
    const r = await ask(ATTRIBUTE_MODEL, prompt, { label: `attribute ${day}` });
    const j = extractJson(r.text) as Record<string, { feature: string | null }>;
    calls.push({ step: "attribute", day, model: ATTRIBUTE_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: true });
    const out: Record<string, string | null> = {};
    for (const [id, v] of Object.entries(j)) out[id] = v && typeof v === "object" && v.feature && features.includes(v.feature) ? v.feature : null;
    return out;
  } catch (e) {
    calls.push({ step: "attribute", day, model: ATTRIBUTE_MODEL, input: 0, output: 0, cost: 0, seconds: 0, ok: false, note: String((e as Error).message).slice(0, 200) });
    return {};
  }
}

export async function read(feature: string, slice: Slice, day: string, calls: Call[]): Promise<{ ok: boolean; diff: string[]; note?: string }> {
  const skill = await Bun.file(join(REPO, "skills/sweep/reader.md")).text();
  const style = await Bun.file(join(REPO, "skills/sweep/style.md")).text();
  const ledger = await readLedger(feature);
  if (!ledger) return { ok: false, diff: [], note: "no ledger" };
  const archFile = Bun.file(join(root(), "alden/alden-portal/features", feature, "docs/arch.md"));
  const arch = (await archFile.exists()) ? (await archFile.text()).split("\n").slice(0, 400).join("\n") : "(no arch doc)";
  const base = `${skill}\n\n# style.md\n\n${style}\n\n# The feature: ${feature}\n\n# ledger.json (as it stands)\n\n\`\`\`json\n${JSON.stringify(ledger, null, 1)}\n\`\`\`\n\n# What is new (${day})\n\n${renderSlice(slice)}\n\n# docs/arch.md (first 400 lines)\n\n${arch}\n\nReturn the next ledger.json as one JSON object in a \`\`\`json fence, nothing else. Today is ${day}.`;
  let prompt = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await ask(READER_MODEL, prompt, { label: `read ${feature} ${day}` });
    } catch (e) {
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: 0, output: 0, cost: 0, seconds: 0, ok: false, note: String((e as Error).message).slice(0, 200) });
      return { ok: false, diff: [], note: (e as Error).message };
    }
    try {
      const next = extractJson(r.text) as Ledger;
      const w = await writeLedger(feature, next, { actor: "model", now: new Date(`${day}T23:00:00Z`) });
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: true, note: attempt ? "after one retry" : undefined });
      return { ok: true, diff: w.diff };
    } catch (e) {
      const problems = e instanceof ValidationError ? e.problems.map((p) => `${p.path}: ${p.rule}`).join("\n") : String((e as Error).message);
      calls.push({ step: "read", feature, day, model: READER_MODEL, input: r.input, output: r.output, cost: r.cost, seconds: r.seconds, ok: false, note: problems.slice(0, 300) });
      if (attempt) return { ok: false, diff: [], note: problems };
      prompt = `${base}\n\n# Your previous answer was refused\n\n${problems}\n\nFix exactly those paths and return the whole ledger again.`;
    }
  }
  return { ok: false, diff: [] };
}

// ---------------------------------------------------------------- the run

export type ModelRun = {
  got: Map<string, string[]>;
  calls: Call[];
  ledgers: Record<string, Ledger>;
  workspace: string;
};

export async function runModel(batches: Batch[], opts: { features: string[]; days?: number; keep?: boolean; log?: (s: string) => void }): Promise<ModelRun> {
  const log = opts.log ?? (() => {});
  const ws = mkdtempSync(join(tmpdir(), "argus-replay-"));
  for (const f of await listFeatures()) {
    const src = ledgerPath(f);
    mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
    if (await Bun.file(src).exists()) cpSync(src, join(ws, "alden/alden-portal/features", f, "ledger.json"));
    const arch = join(REPO, "alden/alden-portal/features", f, "docs/arch.md");
    if (await Bun.file(arch).exists()) cpSync(arch, join(ws, "alden/alden-portal/features", f, "docs/arch.md"));
  }
  cpSync(join(REPO, "alden/alden-portal/.doc-workspace"), join(ws, "alden/alden-portal/.doc-workspace"), { recursive: true });
  const prevRoot = process.env.ARGUS_ROOT;
  process.env.ARGUS_ROOT = ws;
  try {
    const features = await listFeatures();
    const calls: Call[] = [];
    const got = new Map<string, string[]>();
    const add = (id: string, f: string) => got.set(id, [...new Set([...(got.get(id) ?? []), f])]);
    let threads: ThreadMap = {};
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
      const chosen = await attribute(p.unplaced, features, day, calls, all);
      // apply the model's placements: message → slice, thread → learned
      for (const u of p.unplaced) {
        const f = chosen[u.id];
        if (!f) continue;
        if (u.kind === "message") {
          const m = all.find((x) => x.ts === u.id)!;
          if (!p.slices.has(f)) p.slices.set(f, { feature: f, messages: [], landings: [] });
          p.slices.get(f)!.messages.push(m);
          if (!threads[m.thread]) threads[m.thread] = { feature: f, by: "sweep", at: b.pulled_at };
        }
      }
      // a reply whose root the model just placed follows it
      for (const u of p.unplaced) {
        if (chosen[u.id] || u.kind !== "message" || !u.thread) continue;
        const f = threads[u.thread]?.feature;
        if (!f) continue;
        const m = all.find((x) => x.ts === u.id)!;
        if (!p.slices.has(f)) p.slices.set(f, { feature: f, messages: [], landings: [] });
        p.slices.get(f)!.messages.push(m);
      }
      for (const s of p.slices.values()) {
        s.messages.sort((a, c) => Number(a.ts) - Number(c.ts));
        for (const m of s.messages) add(m.ts, s.feature);
        for (const l of s.landings) add(l.ref, s.feature);
      }
      log(`${day}: ${all.length} msgs, ${b.landings.length} landings; ${p.unplaced.length} unplaced → ${Object.values(chosen).filter(Boolean).length} placed by the model`);
      for (const f of opts.features) {
        const s = p.slices.get(f);
        if (!s || (!s.messages.length && !s.landings.length)) continue;
        const r = await read(f, s, day, calls);
        log(`  read ${f}: ${r.ok ? r.diff.join(" · ") || "unchanged" : `FAILED ${r.note?.split("\n")[0]}`}`);
      }
    }
    const ledgers: Record<string, Ledger> = {};
    for (const f of opts.features) {
      const l = await readLedger(f);
      if (l) ledgers[f] = l;
    }
    return { got, calls, ledgers, workspace: ws };
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
    const ask = l?.asks.find((a) => a.origin.kind !== "ticket" && a.origin.thread === c.root);
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
