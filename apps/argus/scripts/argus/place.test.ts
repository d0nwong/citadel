/**
 * The deterministic joins: landings by their mapped features, messages by thread, by
 * ticket key, by PR ref, replies following roots, the rest unplaced with candidates. The
 * same batch twice is byte-identical. `place` writes the placed file, learns threads, and
 * merges the unplaced list.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch } from "./batch.ts";
import { place, placeBatch } from "./place.ts";
import type { Landing } from "./pr-facts.ts";
import { type Ledger, parseLedger } from "./schema.ts";
import type { Msg } from "./slack-pull.ts";
import { readThreads, readUnplaced, writeUnplaced } from "./state.ts";
import { readLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const NOW = new Date("2026-09-11T10:00:00Z");

const msg = (ts: string, text: string, thread = ts, author = "Sam O"): Msg => ({
  ts, thread, date: "2026-09-11", time: "10:00", author, isMe: false, mentionsMe: false, bot: false, text, reactions: "", files: [], canvas: null, permalink: `https://slack/p${ts}`,
});
const landing = (kind: "fe" | "be", n: number, features: string[], ticketKeys: string[] = []): Landing => ({
  repo: kind, ref: `${kind}#${n}`, number: n, sha: `${n}`.padEnd(40, "a"), short: `${n}`.padEnd(9, "a"), at: "2026-09-11T09:00:00Z", date: "2026-09-11",
  by: "Sam O", url: `https://bitbucket.org/x/pull-requests/${n}`, branch: null, title: `pr ${n}`, ticketKeys, files: ["f"], features, routes: [],
});
const batchOf = (messages: Msg[], landings: Landing[] = []): Batch => ({
  id: "2026-09-11T10-00-00Z",
  pulled_at: NOW.toISOString(),
  since: { slack: "0", fe: null, be: null },
  slack: { since: "0", now: NOW.toISOString(), newTopLevel: messages.filter((m) => m.thread === m.ts), threads: [], noiseDropped: 0, expiredThreads: [], next: { last_ts: "0", watched_threads: {} } },
  landings,
});
// replies live in threads[] in a real pull; for these tests put every message in newTopLevel and let flatten order them
const flat = (messages: Msg[], landings: Landing[] = []): Batch => {
  const b = batchOf([], landings);
  b.slack!.newTopLevel = messages;
  return b;
};

let ledgers: Map<string, Ledger>;
beforeEach(async () => {
  ledgers = new Map([["admin/invoicing", parseLedger(await Bun.file(`${FIX}valid.json`).json())]]);
});

describe("placeBatch", () => {
  const features = ["admin/invoicing", "admin/usage", "tasks"];

  test("landings by mapped feature; an unmapped landing is unplaced", () => {
    const p = placeBatch(flat([], [landing("fe", 430, ["tasks", "admin/usage"]), landing("be", 780, [])]), ledgers, {}, features, NOW);
    expect([...p.slices.keys()]).toEqual(["admin/usage", "tasks"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["be#780"]);
    expect(p.unplaced[0]?.candidates).toEqual(["admin/usage", "tasks"]);
  });

  test("an unmapped landing the user placed is sliced to that feature; one they dismissed is dropped", () => {
    const threads = {
      "be#780": { feature: "tasks", by: "user" as const, at: NOW.toISOString() },
      "fe#431": { feature: null, by: "user" as const, at: NOW.toISOString() },
    };
    const p = placeBatch(flat([], [landing("be", 780, []), landing("fe", 431, []), landing("fe", 432, [])]), ledgers, threads, features, NOW);
    expect(p.slices.get("tasks")?.landings.map((l) => l.ref)).toEqual(["be#780"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["fe#432"]);
  });

  test("a known thread places its replies; a new root by ticket key or PR ref is learned", () => {
    const b = flat([
      msg("1", "anything", "1"),
      msg("2", "reply in a known thread", "0.5"),
      msg("3", "ALD-41 is merged", "3"),
      msg("4", "see fe#421 please", "4"),
      msg("5", "follow-up", "3"),
    ]);
    const p = placeBatch(b, ledgers, { "0.5": { feature: "tasks", by: "user", at: "x" } }, features, NOW);
    expect(p.slices.get("tasks")?.messages.map((m) => m.ts)).toEqual(["2"]);
    expect(p.slices.get("admin/invoicing")?.messages.map((m) => m.ts)).toEqual(["3", "4", "5"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["1"]);
    expect(Object.keys(p.threads).sort()).toEqual(["3", "4"]);
    expect(p.threads["3"]).toEqual({ feature: "admin/invoicing", by: "sweep", at: NOW.toISOString() });
  });

  test("a ticket key names a feature through a landing in the same batch, and a reply pulls an unplaced root along", () => {
    const b = flat([msg("1", "root says nothing", "1"), msg("2", "LIA-9 landed", "1")], [landing("fe", 500, ["admin/usage"], ["LIA-9"])]);
    const p = placeBatch(b, ledgers, {}, features, NOW);
    expect(p.slices.get("admin/usage")?.messages.map((m) => m.ts).sort()).toEqual(["1", "2"]);
    expect(p.unplaced).toEqual([]);
    expect(p.threads["1"]?.feature).toBe("admin/usage");
  });

  test("a thread the user marked as nobody's is neither sliced nor unplaced", () => {
    const b = flat([msg("1", "chat root", "1"), msg("2", "ALD-41 mentioned in a chat thread", "1"), msg("3", "elsewhere", "3")]);
    const p = placeBatch(b, ledgers, { "1": { feature: null, by: "user", at: "x" } }, features, NOW);
    expect([...p.slices.keys()]).toEqual([]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["3"]);
    expect(p.threads).toEqual({});
  });
  test("a huddle canvas travels in the unplaced text; a reply to an unplaced root is unplaced under it", () => {
    const b = flat([{ ...msg("1", "AI huddle notes are ready", "1", "Slackbot"), canvas: "## Summary\n- x" }, msg("2", "thanks", "1")]);
    const p = placeBatch(b, ledgers, {}, features, NOW);
    expect(p.unplaced.map((u) => [u.id, u.thread])).toEqual([["1", undefined], ["2", "1"]]);
    expect(p.unplaced[0]?.text).toBe("AI huddle notes are ready\n\n## Summary\n- x");
    expect(p.unplaced[0]?.candidates).toEqual(features);
  });

  test("the same batch twice is byte-identical", () => {
    const b = flat([msg("2", "b", "2"), msg("1", "ALD-41", "1"), msg("3", "c", "3")], [landing("be", 1, ["tasks"]), landing("fe", 2, ["tasks", "admin/usage"])]);
    const a = JSON.stringify([...placeBatch(b, ledgers, {}, features, NOW).slices.values()]);
    const c = JSON.stringify([...placeBatch(b, ledgers, {}, features, NOW).slices.values()]);
    expect(a).toBe(c);
  });
});

describe("place (on disk)", () => {
  let ws: string;
  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), "argus-place-"));
    process.env.ARGUS_ROOT = ws;
    for (const f of ["tasks", "admin/invoicing", "admin/usage"]) mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
    cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
    mkdirSync(join(ws, "state/batches"), { recursive: true });
    await writeUnplaced([{ id: "0.9", kind: "message", by: "x", at: "2026-09-10", text: "old root", url: "u", candidates: [], batch: "old" }]);
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });

  test("writes the placed file, learns threads, merges unplaced, and an older root a new reply places leaves the list", async () => {
    const b = flat([msg("1", "hello", "1"), msg("2", "ALD-41 reply", "0.9")]);
    const path = join(ws, "state/batches", `${b.id}.json`);
    await Bun.write(path, JSON.stringify(b));
    const placed = await place(b.id, { now: NOW });
    expect(placed.slices.map((s) => s.feature)).toEqual(["admin/invoicing"]);
    expect(placed.unplaced).toEqual(["1"]);
    expect(await Bun.file(join(ws, "state/batches", `${b.id}.placed.json`)).exists()).toBe(true);
    expect((await readThreads())["0.9"]?.feature).toBe("admin/invoicing");
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1"]);
    const again = await place(b.id, { now: NOW });
    expect(again).toEqual(placed);
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1"]);
  });
  test("a slice's landings go onto the ledger, once", async () => {
    const b = flat([], [landing("fe", 431, ["admin/invoicing"])]);
    const path = join(ws, "state/batches", `${b.id}.json`);
    await Bun.write(path, JSON.stringify(b));
    await place(b.id, { now: NOW });
    const l = (await readLedger("admin/invoicing"))!;
    expect(l.landings.map((x) => x.ref)).toEqual(["be#771", "fe#431"]);
    await place(b.id, { now: NOW });
    expect((await readLedger("admin/invoicing"))!.landings).toHaveLength(2);
  });
});
