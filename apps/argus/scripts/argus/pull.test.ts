/**
 * `pullBatch` with injected sources against a temp workspace: the landing window comes
 * from the ledgers, already-recorded landings drop out, nothing new writes nothing, the
 * cursor goes to cursor.next.json and never to cursor.json, `--since` leaves the cursor
 * alone, and a fixture pull writes elsewhere.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorNextPath, cursorPath } from "./paths.ts";
import type { Landing } from "./pr-facts.ts";
import { pullBatch, type PullSources } from "./pull.ts";
import type { Pull } from "./slack-pull.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const NOW = new Date("2026-09-11T10:00:00Z");
let ws: string;

const landing = (kind: "fe" | "be", n: number, at: string, features: string[] = ["tasks"]): Landing => ({
  repo: kind, ref: `${kind}#${n}`, number: n, sha: `${kind}${n}`.padEnd(40, "0"), short: `${kind}${n}`.padEnd(9, "0"), at, date: at.slice(0, 10),
  by: "Sam O", url: `https://bitbucket.org/x/pull-requests/${n}`, branch: null, title: `pr ${n}`, ticketKeys: [], files: ["src/a.ts"], features, routes: [],
});
const emptyPull = (since: string): Pull => ({ since, now: NOW.toISOString(), newTopLevel: [], threads: [], noiseDropped: 0, expiredThreads: [], next: { last_ts: since, watched_threads: {} } });
const onePull = (since: string): Pull => ({
  ...emptyPull(since),
  newTopLevel: [{ ts: "1789100000.000001", thread: "1789100000.000001", date: "2026-09-11", time: "10:00", author: "Sam O", isMe: false, mentionsMe: false, bot: false, text: "hello", reactions: "", files: [], canvas: null, permalink: "u" }],
  next: { last_ts: "1789100000.000001", watched_threads: { "1789100000.000001": "1789100000.000001" } },
});

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-pull-"));
  process.env.ARGUS_ROOT = ws;
  for (const f of ["tasks", "admin/invoicing"]) mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
  cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

describe("pullBatch", () => {
  test("windows come from the ledgers, recorded landings drop, the batch and the next cursor are written", async () => {
    const asked: string[] = [];
    const sources: PullSources = {
      slack: async (since) => onePull(since ?? "1789000000.000000"),
      landings: async (kind, since) => {
        asked.push(`${kind}:${since}`);
        return kind === "be" ? [landing("be", 771, "2026-09-10T12:00:00Z"), landing("be", 772, "2026-09-11T09:00:00Z")] : [landing("fe", 430, "2026-09-11T08:00:00Z")];
      },
    };
    // the valid ledger holds be#771 with sha "0fa428a1"; a same-number landing with a different sha is new, so give it the recorded sha
    const r = await pullBatch({ now: NOW, sources: { ...sources, landings: async (k, s) => (await sources.landings(k, s)).map((l) => (l.number === 771 ? { ...l, sha: "0fa428a1" } : l)) } });
    expect(asked).toEqual(["fe:2026-09-04", "be:2026-09-10"]);
    expect(r.batch?.landings.map((l) => l.ref)).toEqual(["fe#430", "be#772"]);
    expect(r.batch?.since).toEqual({ slack: "1789000000.000000", fe: "2026-09-04", be: "2026-09-10" });
    expect(existsSync(r.path!)).toBe(true);
    expect(JSON.parse(await Bun.file(cursorNextPath()).text()).last_ts).toBe("1789100000.000001");
    expect(existsSync(cursorPath())).toBe(false);
  });

  test("nothing new writes nothing", async () => {
    const r = await pullBatch({ now: NOW, sources: { slack: async () => emptyPull("1789000000.000000"), landings: async () => [] } });
    expect(r).toEqual({ batch: null, path: null, reason: "nothing new" });
    expect(existsSync(join(ws, "state"))).toBe(false);
  });

  test("--since overrides both windows and leaves the cursor alone; an outDir is a fixture run", async () => {
    const asked: string[] = [];
    const out = join(ws, "fixtures");
    const r = await pullBatch({
      now: NOW,
      since: "2026-08-27",
      outDir: out,
      sources: { slack: async (since) => onePull(since!), landings: async (k, s) => (asked.push(`${k}:${s}`), [landing(k, 1, "2026-08-28T00:00:00Z")]) },
    });
    expect(asked).toEqual(["fe:2026-08-27", "be:2026-08-27"]);
    expect(r.path?.startsWith(out)).toBe(true);
    expect(r.batch?.slack?.since).toBe("2026-08-27");
    expect(existsSync(cursorNextPath())).toBe(false);
  });

  test("dry run and the no-slack, no-landings switches", async () => {
    let slackCalls = 0;
    const r = await pullBatch({ now: NOW, dryRun: true, noSlack: true, sources: { slack: async () => (slackCalls++, emptyPull("x")), landings: async (k) => (k === "fe" ? [landing("fe", 9, "2026-09-11T00:00:00Z")] : []) } });
    expect(slackCalls).toBe(0);
    expect(r.batch?.slack).toBeNull();
    expect(r.batch?.landings).toHaveLength(1);
    expect(existsSync(r.path!)).toBe(false);
  });
});
