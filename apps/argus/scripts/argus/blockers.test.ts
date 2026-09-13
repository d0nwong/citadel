import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileAll, reconcileLedger } from "./blockers.ts";
import type { Deploy } from "./deploy.ts";
import { pipelineFor } from "./deploy.ts";
import { type Ledger, parseLedger } from "./schema.ts";
import { validateLedger } from "./validate.ts";
import { readLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const valid = async (): Promise<Ledger> => parseLedger(await Bun.file(`${FIX}valid.json`).json());
const live: Deploy = { result: "SUCCESSFUL", at: "2026-09-10T07:34:37Z", build: 2084, url: "u" };

describe("reconcileLedger", () => {
  test("a landing blocker clears when its landing is on the ledger and deployed; ready follows", async () => {
    const l = await valid();
    l.asks[1]!.blockers = [{ kind: "landing", repo: "be", ref: "be#771", branch: "origin/dev", deployed: false, cleared: null }];
    const r = await reconcileLedger(l, async () => live);
    expect(r.cleared).toEqual(["A-2: be#771 is on origin/dev and deployed (2026-09-10)"]);
    const b = r.ledger.asks[1]!.blockers![0]!;
    expect(b.cleared).toEqual({ at: "2026-09-10", evidence: [{ kind: "pr", repo: "be", number: 771, url: expect.stringContaining("771") }] });
    expect(b.kind === "landing" && b.deployed).toBe(true);
  });
  test("not deployed, unknown ref, failed deploy and answer blockers stay", async () => {
    const l = await valid();
    l.asks[1]!.blockers = [
      { kind: "landing", repo: "be", ref: "be#771", branch: "origin/dev", deployed: false, cleared: null },
      { kind: "landing", repo: "be", ref: "be#999", branch: "origin/dev", deployed: false, cleared: null },
      { kind: "answer", from: "Foong Leung", question: "which fields?", cleared: null },
    ];
    expect((await reconcileLedger(l, async () => null)).cleared).toEqual([]);
    expect((await reconcileLedger(l, async () => ({ ...live, result: "FAILED" }))).cleared).toEqual([]);
  });
  test("a ticket blocker clears when the ticket's asks are all closed", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-40", title: "x", asks: ["A-1"], blockers: [], ready: true });
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-11T10:00:00Z"));
    expect(r.cleared).toEqual(["ALD-41: ALD-40 is done"]);
    expect(r.ledger.tickets[0]!.blockers[2]!.cleared).toEqual({ at: "2026-09-11", evidence: [{ kind: "ticket", key: "ALD-40" }] });
  });
});

describe("a ticket that landed closes its ask", () => {
  test("a frontend merge carrying the key moves the ask to built and closed; a backend one waits for the deploy", async () => {
    const l = await valid();
    l.asks[1]!.ticket = "ALD-52";
    l.tickets.push({ key: "ALD-52", title: "[FE] billing fields", asks: ["A-2"], blockers: [], ready: true });
    l.landings.push({ at: "2026-09-12T09:00:00Z", repo: "fe", ref: "fe#440", number: 440, sha: "f".repeat(40), title: "Foundry/ald-52 billing fields", by: "you", url: "https://bitbucket.org/x/pull-requests/440", asks: [], files: ["src/a.ts"], tickets: ["ALD-52"] });
    const r = await reconcileLedger(l, async () => null);
    expect(r.cleared).toEqual(["A-2: ALD-52 landed as fe#440", "A-2: ALD-52 is live, closed"]);
    const a = r.ledger.asks[1]!;
    expect(a.status).toBe("closed");
    expect(a.history.map((h) => h.status)).toEqual(["built", "closed"]);
    expect(a.history[0]!.evidence).toEqual([{ kind: "pr", repo: "fe", number: 440, url: expect.stringContaining("440") }]);
    expect(r.ledger.landings.at(-1)!.asks).toEqual(["A-2"]);
    expect(validateLedger(r.ledger, { prev: l, actor: "model" })).toEqual([]);
    // backend: built now, closed only once the pipeline says deployed
    const b = await valid();
    b.asks[1]!.ticket = "ALD-53";
    b.landings.push({ at: "2026-09-12T09:00:00Z", repo: "be", ref: "be#800", number: 800, sha: "e".repeat(40), title: "ALD-53 endpoint", by: "Sam O", url: "u", asks: [], files: ["src/x.ts"] });
    const r1 = await reconcileLedger(b, async () => null);
    expect(r1.ledger.asks[1]!.status).toBe("built");
    const r2 = await reconcileLedger(r1.ledger, async () => live);
    expect(r2.ledger.asks[1]!.status).toBe("closed");
    expect(r2.cleared).toEqual(["A-2: ALD-53 is live, closed"]);
  });
});

describe("a ticket with no asks is done once its landing is live", () => {
  const landing = (repo: "fe" | "be", ref: string, number: number, key: string) => ({
    at: "2026-09-12T14:20:29Z", repo, ref, number, sha: "e".repeat(40), title: `feat: ${key} rollover`, by: "you",
    url: `https://bitbucket.org/x/pull-requests/${number}`, asks: [], files: ["src/a.ts"], tickets: [key],
  });
  test("a frontend merge marks it done with the PR as evidence; a second run changes nothing", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-45", title: "[FE] rollover", asks: [], blockers: [], ready: true });
    l.landings.push(landing("fe", "fe#437", 437, "ALD-45"));
    const r = await reconcileLedger(l, async () => null);
    expect(r.cleared).toEqual(["ALD-45: landed as fe#437 and is live, done"]);
    expect(r.ledger.tickets[1]!.done).toEqual({ at: "2026-09-12", evidence: [{ kind: "pr", repo: "fe", number: 437, url: expect.stringContaining("437") }] });
    expect(validateLedger(r.ledger, { prev: l, actor: "model" })).toEqual([]);
    expect((await reconcileLedger(r.ledger, async () => null)).cleared).toEqual([]);
  });
  test("a backend merge waits for the deploy; a ticket with asks or without a landing is left alone", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-46", title: "[BE] rollover", asks: [], blockers: [], ready: true });
    l.tickets.push({ key: "ALD-48", title: "[BE] nothing landed", asks: [], blockers: [], ready: true });
    l.landings.push(landing("be", "be#780", 780, "ALD-46"));
    expect((await reconcileLedger(l, async () => null)).cleared).toEqual([]);
    // the fixture's deploy predates the merge, so the date falls back to today, as it does for an ask
    const r = await reconcileLedger(l, async () => live, new Date("2026-09-13T10:00:00Z"));
    expect(r.cleared).toEqual(["ALD-46: landed as be#780 and is live, done"]);
    expect(r.ledger.tickets[1]!.done?.at).toBe("2026-09-13");
    expect(r.ledger.tickets[2]!.done).toBeUndefined();
    expect(r.ledger.tickets[0]!.done).toBeUndefined();
  });
  test("a ticket blocker waiting on an ask-less ticket clears in the same run", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-40", title: "x", asks: [], blockers: [], ready: true });
    l.landings.push(landing("fe", "fe#437", 437, "ALD-40"));
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-13T10:00:00Z"));
    expect(r.cleared).toEqual(["ALD-40: landed as fe#437 and is live, done", "ALD-41: ALD-40 is done"]);
  });
});

describe("reconcileAll", () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "argus-rec-"));
    process.env.ARGUS_ROOT = ws;
    mkdirSync(join(ws, "alden/alden-portal/features/admin/invoicing/docs"), { recursive: true });
    cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });
  test("writes only ledgers where something cleared; the result validates with ready derived; a second run is a no-op", async () => {
    const before = (await readLedger("admin/invoicing"))!;
    before.asks[1]!.blockers = [{ kind: "landing", repo: "be", ref: "be#771", branch: "origin/dev", deployed: false, cleared: null }];
    await Bun.write(join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"), JSON.stringify(before));
    const r = await reconcileAll({ deployed: async () => live, now: new Date("2026-09-11T10:00:00Z") });
    expect(r.map((x) => [x.feature, x.cleared.length, x.write?.wrote])).toEqual([["admin/invoicing", 1, true]]);
    const after = (await readLedger("admin/invoicing"))!;
    expect(after.asks[1]!.ready).toBe(true);
    expect(validateLedger(after)).toEqual([]);
    expect(await reconcileAll({ deployed: async () => live })).toEqual([]);
  });
});

describe("pipelineFor", () => {
  const page = {
    values: [
      { build_number: 2084, state: { name: "COMPLETED", result: { name: "SUCCESSFUL" } }, target: { ref_name: "dev", commit: { hash: "06d27c814abcdef0123456789" } }, completed_on: "2026-09-10T07:34:37.1Z", created_on: "2026-09-10T07:26:50Z" },
      { build_number: 2090, state: { name: "IN_PROGRESS" }, target: { ref_name: "dev", commit: { hash: "aaaaaaaaa1234" } }, created_on: "2026-09-11T01:00:00Z" },
    ],
  };
  const fetchStub = (async () => new Response(JSON.stringify(page))) as unknown as typeof fetch;
  test("finds the pipeline by commit prefix, reports a running one as null, and answers undefined without credentials", async () => {
    expect(await pipelineFor("x/y", "dev", "06d27c81", { fetch: fetchStub, auth: "Basic x" })).toEqual({ result: "SUCCESSFUL", at: "2026-09-10T07:34:37.1Z", build: 2084, url: expect.stringContaining("2084") });
    expect(await pipelineFor("x/y", "dev", "aaaaaaaaa", { fetch: fetchStub, auth: "Basic x" })).toBeNull();
    expect(await pipelineFor("x/y", "dev", "ffffffff", { fetch: fetchStub, auth: "Basic x" })).toBeNull();
    expect(await pipelineFor("x/y", "dev", "06d27c81", { fetch: fetchStub, auth: null })).toBeUndefined();
  });
});
