/**
 * Task 289: the two things the replay adds around the model steps — a run with no reader
 * (AC1, S-22) and Jev's per-thread suggestion, asked again when a declined thread gains a
 * message (AC2, S-23). `ask` and Jev's own client are both injected, so nothing here shells
 * out to `claude -p` or calls `api.typesafe.ai` for real.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch } from "../scripts/argus/batch.ts";
import type { ChoiceOption, SuggestResult } from "../scripts/argus/suggest.ts";
import type { Msg } from "../scripts/argus/slack-pull.ts";

const evidence = [{ kind: "assumption", note: "seed" }];
const emptyLedger = (feature: string, summary: string) => ({
  feature,
  as_of: "2026-09-11T10:00:00Z",
  summary,
  story: {
    health: { text: "ok", evidence },
    gaps: { text: "ok", evidence },
    requirements: { text: "ok", evidence },
    architecture: { text: "ok", evidence },
  },
  requirements: [],
  asks: [],
  tickets: [],
  landings: [],
  proposals: [],
});

const msg = (ts: string, thread: string, date: string, text: string): Msg => ({
  ts,
  channel: "C1",
  thread,
  date,
  time: "10:00",
  author: "Sam O",
  isMe: false,
  mentionsMe: false,
  bot: false,
  text,
  reactions: "",
  files: [],
  canvas: null,
  permalink: `https://x.slack.com/archives/C1/p${ts.replace(".", "")}`,
});

const batchOf = (id: string, messages: Msg[]): Batch => ({
  id,
  pulled_at: `${id}T23:59:59Z`,
  since: { slack: null, fe: null, be: null },
  slack: { since: "0", now: "", newTopLevel: messages, threads: [], noiseDropped: 0, expiredThreads: [], next: { last_ts: "0", watched_threads: {} } },
  landings: [],
});

let ws: string;
let prevRoot: string | undefined;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-model-test-"));
  prevRoot = process.env.ARGUS_ROOT;
  // model.ts binds its seed source (`DATA`) at import time; runModel's own `listFeatures()`
  // calls read `ARGUS_ROOT` fresh, so it has to stay pointed at the seed for the whole test,
  // not just for the dynamic import below.
  process.env.ARGUS_ROOT = ws;
});

afterEach(() => {
  if (prevRoot === undefined) delete process.env.ARGUS_ROOT;
  else process.env.ARGUS_ROOT = prevRoot;
  rmSync(ws, { recursive: true, force: true });
});

/** seed the temp ARGUS_ROOT (already current) with one feature, then dynamically load model.ts against it */
async function seeded(feature = "widgets") {
  mkdirSync(join(ws, "alden/alden-portal/.doc-workspace"), { recursive: true });
  writeFileSync(
    join(ws, "alden/alden-portal/.doc-workspace/feature-manifest.json"),
    JSON.stringify({ app: "alden-portal", fe_repo: "~/x", features: [{ id: feature, name: feature, type: "feature", entry_routes: [], core_files: [], aliases: [] }] }),
  );
  mkdirSync(join(ws, "alden/alden-portal/features", feature), { recursive: true });
  writeFileSync(join(ws, "alden/alden-portal/features", feature, "ledger.json"), JSON.stringify(emptyLedger(feature, "seed summary")));
  const mod = await import(`./model.ts?seed=${Math.random()}`);
  return mod as typeof import("./model.ts");
}

const fakeAskAttributeOnly = (choices: Record<string, string[]>) =>
  (async (model: string) => {
    if (model.includes("opus")) throw new Error("the reader should not be asked in this test");
    return { text: JSON.stringify(Object.fromEntries(Object.entries(choices).map(([id, fs]) => [id, { feature: fs }]))), input: 10, output: 5, cost: 0.01, seconds: 0.1 };
  }) as any;

describe("runModel: readers off (AC1, S-22)", () => {
  test("C1: with readers:false, the reader is never asked and the ledger stays at its seeded state", async () => {
    const { runModel } = await seeded("widgets");
    const batch = batchOf("2026-09-11", [msg("1700000000.000001", "1700000000.000001", "2026-09-11", "about widgets")]);
    const run = await runModel([batch], {
      features: ["widgets"],
      readers: false,
      ask: fakeAskAttributeOnly({ "1700000000.000001": ["widgets"] }),
      keep: true,
    });
    expect(run.calls.filter((c) => c.step === "read")).toEqual([]);
    expect(run.got.get("1700000000.000001")).toEqual(["widgets"]);
    const seededLedger = JSON.parse(require("node:fs").readFileSync(join(ws, "alden/alden-portal/features/widgets/ledger.json"), "utf8"));
    const afterLedger = JSON.parse(require("node:fs").readFileSync(join(run.workspace, "alden/alden-portal/features/widgets/ledger.json"), "utf8"));
    // the seeding step stamps as_of; everything else — the summary in particular — is untouched
    expect(afterLedger.summary).toBe(seededLedger.summary);
    expect(afterLedger.landings).toEqual([]);
    rmSync(run.workspace, { recursive: true, force: true });
  });

  test("C1: with readers on (default), a placed slice still gets exactly one reader call", async () => {
    const { runModel } = await seeded("widgets");
    const batch = batchOf("2026-09-11", [msg("1700000000.000002", "1700000000.000002", "2026-09-11", "about widgets")]);
    const askFn = (async (model: string, _prompt: string) => {
      if (model.includes("opus")) return { text: '```json\n{"summary": "read the widgets slice"}\n```', input: 1, output: 1, cost: 0.02, seconds: 0.1 };
      return { text: JSON.stringify({ "1700000000.000002": { feature: "widgets" } }), input: 10, output: 5, cost: 0.01, seconds: 0.1 };
    }) as any;
    const run = await runModel([batch], { features: ["widgets"], ask: askFn, keep: true });
    expect(run.calls.filter((c) => c.step === "read").length).toBe(1);
    rmSync(run.workspace, { recursive: true, force: true });
  });
});

describe("runModel: suggest (AC2, S-23)", () => {
  test("C2: a message attribution declines is grouped by thread and asked once", async () => {
    const { runModel } = await seeded("widgets");
    const batch = batchOf("2026-09-11", [
      msg("1700000000.000010", "1700000000.000010", "2026-09-11", "root: thinking out loud"),
      msg("1700000000.000011", "1700000000.000010", "2026-09-11", "reply: still thinking"),
    ]);
    const seen: { state: string; options: ChoiceOption[] }[] = [];
    const suggestFn = (async (state: string, options: ChoiceOption[]) => {
      seen.push({ state, options });
      return { choice: "nothing", probabilities: { nothing: 0.9 }, confidence: 0.9, model: "jev-1.13.1" } satisfies SuggestResult;
    }) as any;
    const run = await runModel([batch], {
      features: ["widgets"],
      readers: false,
      ask: fakeAskAttributeOnly({}),
      suggest: { suggestFn },
      keep: true,
    });
    expect(seen.length).toBe(1); // one call for the whole thread, not one per message
    expect(seen[0]!.state).toContain("root: thinking out loud");
    expect(seen[0]!.state).toContain("reply: still thinking");
    expect(seen[0]!.options.some((o) => o.feature === "widgets")).toBe(true);
    expect(run.declinedThread.get("1700000000.000010")).toBe("1700000000.000010");
    expect(run.declinedThread.get("1700000000.000011")).toBe("1700000000.000010");
    expect(run.suggestions.get("1700000000.000010")).toEqual({ choice: "nothing", probabilities: { nothing: 0.9 }, confidence: 0.9, model: "jev-1.13.1" });
    rmSync(run.workspace, { recursive: true, force: true });
  });

  test("C2: a thread declined again on a later day is re-asked, and the latest answer wins", async () => {
    const { runModel } = await seeded("widgets");
    const day1 = batchOf("2026-09-11", [msg("1700000000.000020", "1700000000.000020", "2026-09-11", "root: first day")]);
    const day2 = batchOf("2026-09-12", [msg("1700000000.000021", "1700000000.000020", "2026-09-12", "reply: second day")]);
    let calls = 0;
    const suggestFn = (async () => {
      calls++;
      return calls === 1
        ? ({ choice: "widgets", probabilities: { widgets: 0.6 }, confidence: 0.6, model: "jev-1.13.1" } satisfies SuggestResult)
        : ({ choice: "nothing", probabilities: { nothing: 0.95 }, confidence: 0.95, model: "jev-1.13.1" } satisfies SuggestResult);
    }) as any;
    const run = await runModel([day1, day2], {
      features: ["widgets"],
      readers: false,
      ask: fakeAskAttributeOnly({}),
      suggest: { suggestFn },
      keep: true,
    });
    expect(calls).toBe(2);
    // both messages of the thread take the latest (second) answer
    expect(run.suggestions.get("1700000000.000020")).toEqual({ choice: "nothing", probabilities: { nothing: 0.95 }, confidence: 0.95, model: "jev-1.13.1" });
    expect(run.declinedThread.get("1700000000.000020")).toBe("1700000000.000020");
    expect(run.declinedThread.get("1700000000.000021")).toBe("1700000000.000020");
    rmSync(run.workspace, { recursive: true, force: true });
  });

  test("C2: huddle notes are their own thread, keyed as place.ts keys them, so the scorer finds their answer", async () => {
    const { runModel } = await seeded("widgets");
    // Slackbot posts huddle notes as a reply under its "huddle started" message; place.ts
    // gives them their own thread, and the suggestion has to be keyed the same way
    const notes: Msg = { ...msg("1700000000.000041", "1700000000.000040", "2026-09-11", "huddle"), canvas: "we agreed to ship the widget picker" };
    const batch = batchOf("2026-09-11", [msg("1700000000.000040", "1700000000.000040", "2026-09-11", "huddle started"), notes]);
    const suggestFn = (async () => ({ choice: "widgets", probabilities: { widgets: 0.7 }, confidence: 0.7, model: "jev-1.13.1" }) satisfies SuggestResult) as any;
    const run = await runModel([batch], { features: ["widgets"], readers: false, ask: fakeAskAttributeOnly({}), suggest: { suggestFn }, keep: true });
    // the notes' declined key and the answer's key are the same one, so the join holds
    const key = run.declinedThread.get("1700000000.000041")!;
    expect(key).toBe("1700000000.000041");
    expect(run.suggestions.get(key)).toBeDefined();
    rmSync(run.workspace, { recursive: true, force: true });
  });

  test("C2: a failed suggestion call is logged and the thread is left without an answer", async () => {
    const { runModel } = await seeded("widgets");
    const batch = batchOf("2026-09-11", [msg("1700000000.000030", "1700000000.000030", "2026-09-11", "root: will fail")]);
    const suggestFn = (async () => {
      throw new Error("jev: 500");
    }) as any;
    const run = await runModel([batch], { features: ["widgets"], readers: false, ask: fakeAskAttributeOnly({}), suggest: { suggestFn }, keep: true });
    expect(run.suggestions.has("1700000000.000030")).toBe(false);
    expect(run.suggestCalls).toEqual([{ thread: "1700000000.000030", day: "2026-09-11", model: "", ok: false, note: "jev: 500" }]);
    rmSync(run.workspace, { recursive: true, force: true });
  });
});
