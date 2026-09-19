import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { needsReconcile, reconcileAll, reconcileLedger, recordDeploys } from "./blockers.ts";
import type { Deploy, DeployCache } from "./deploy.ts";
import { deployCheck, pipelineFor } from "./deploy.ts";
import type { TicketState, TicketStates } from "./linear.ts";
import { fileRevision, newRevision, readRevision } from "./revision.ts";
import { emptyLedger, type Evidence, type Ledger, parseLedger, serializeLedger } from "./schema.ts";
import { validateLedger, validateSpec } from "./validate.ts";
import { readLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const valid = async (): Promise<Ledger> => parseLedger(await Bun.file(`${FIX}valid.json`).json());
const live: Deploy = { result: "SUCCESSFUL", at: "2026-09-10T07:34:37Z", build: 2084, url: "u" };
/** the lines about blockers and tickets, without the deploys recordDeploys reports */
const settled = (lines: string[]) => lines.filter((x) => !/^be#\d+: (deployed to dev|dev pipeline)/.test(x));

describe("reconcileLedger", () => {
  test("a landing blocker clears when its landing is on the ledger and deployed; ready follows", async () => {
    const l = await valid();
    l.asks[1]!.blockers = [{ kind: "landing", repo: "be", ref: "be#771", branch: "origin/dev", deployed: false, cleared: null }];
    const r = await reconcileLedger(l, async () => live);
    expect(r.cleared).toEqual(["be#771: deployed to dev (2026-09-10, build 2084)", "A-2: be#771 is on origin/dev and deployed (2026-09-10)"]);
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
    expect(settled((await reconcileLedger(l, async () => ({ ...live, result: "FAILED" }))).cleared)).toEqual([]);
  });
  test("a ticket blocker clears when the ticket's asks are all closed", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-40", title: "x", asks: ["A-1"], blockers: [], ready: true });
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-11T10:00:00Z"));
    expect(r.cleared).toEqual(["ALD-41: ALD-40 is done"]);
    expect(r.ledger.tickets[0]!.blockers[2]!.cleared).toEqual({ at: "2026-09-11", evidence: [{ kind: "ticket", key: "ALD-40" }] });
  });
});

describe("a landing blocker on the frontend (CTD-240)", () => {
  // AC3 (a backend landing blocker stays open until deployed) is already covered above,
  // by the fixture's be#771 cases — this only adds the frontend half.
  const fe = (ref: string, number: number, at: string): Ledger["landings"][number] => ({
    at, repo: "fe", ref, number, sha: "f".repeat(40), title: "billing fields for Sam", by: "you",
    url: `https://bitbucket.org/x/pull-requests/${number}`, asks: [], files: [],
  });

  test("clears on the merge day with the PR as evidence, no deploy read; a second run changes nothing (AC1, AC4, AC5)", async () => {
    const l = await valid();
    l.landings = [fe("fe#440", 440, "2026-09-12T09:00:00Z")];
    l.asks[1]!.blockers = [{ kind: "landing", repo: "fe", ref: "fe#440", branch: "origin/staging", deployed: false, cleared: null }];
    const asked: string[] = [];
    const deployed = async (repo: "fe" | "be", sha: string) => (asked.push(`${repo}@${sha}`), null);
    const r = await reconcileLedger(l, deployed);
    expect(r.cleared).toEqual(["A-2: fe#440 is on origin/staging and merged (2026-09-12)"]);
    const b = r.ledger.asks[1]!.blockers![0]!;
    expect(b.cleared).toEqual({ at: "2026-09-12", evidence: [{ kind: "pr", repo: "fe", number: 440, url: expect.stringContaining("440") }] });
    expect(b.kind === "landing" && b.deployed).toBe(false);
    expect(asked).toEqual([]);
    expect((await reconcileLedger(r.ledger, deployed)).cleared).toEqual([]);
  });

  test("without fe#N on the ledger's landings the blocker stays open (AC2)", async () => {
    const l = await valid();
    l.landings = [];
    l.asks[1]!.blockers = [{ kind: "landing", repo: "fe", ref: "fe#440", branch: "origin/staging", deployed: false, cleared: null }];
    const r = await reconcileLedger(l, async () => live);
    expect(r.cleared).toEqual([]);
    expect(r.ledger.asks[1]!.blockers![0]!.cleared).toBeNull();
  });
});

describe("recordDeploys", () => {
  const NOW = new Date("2026-09-17T12:00:00Z");
  const be = (ref: string, at: string, sha: string): Ledger["landings"][number] => ({ at, repo: "be", ref, number: Number(ref.slice(3)), sha, title: ref, by: "Sam O", url: "u", asks: [], files: [] });
  test("a backend landing read while its pipeline ran gets the deploy on a later run, untold while recent", async () => {
    const l = await valid();
    l.landings = [be("be#797", "2026-09-16T07:26:57Z", "f9c544f"), { ...be("be#1", "2026-09-16T07:00:00Z", "a"), repo: "fe", ref: "fe#1" }];
    let finished: Deploy | null = null;
    const asked: string[] = [];
    const deployed = async (_r: string, sha: string) => (asked.push(sha), finished);
    expect(await recordDeploys(l, deployed, NOW)).toEqual([]);
    expect(l.landings[0]!.deployed).toBeUndefined();
    finished = { result: "SUCCESSFUL", at: "2026-09-16T10:02:11Z", build: 2142, url: "u" };
    expect(await recordDeploys(l, deployed, NOW)).toEqual(["be#797: deployed to dev (2026-09-16, build 2142)"]);
    expect(l.landings[0]!.deployed).toEqual({ ...finished, told: false });
    expect(validateLedger(l, { actor: "model" })).toEqual([]);
    // a recorded deploy is never asked about again, and the frontend never is
    expect(await recordDeploys(l, deployed, NOW)).toEqual([]);
    expect(asked).toEqual(["f9c544f", "f9c544f"]);
  });
  test("a failed pipeline is recorded and stays; an old landing's deploy is history, told already", async () => {
    const l = await valid();
    l.landings = [be("be#700", "2026-08-01T00:00:00Z", "b"), be("be#798", "2026-09-17T04:10:44Z", "c")];
    const r = await recordDeploys(l, async (_r, sha) => ({ ...live, result: sha === "c" ? "FAILED" : "SUCCESSFUL" }), NOW);
    expect(r).toEqual(["be#700: deployed to dev (2026-09-10, build 2084)", "be#798: dev pipeline failed (build 2084)"]);
    expect(l.landings.map((x) => [x.deployed?.result, x.deployed?.told])).toEqual([["SUCCESSFUL", true], ["FAILED", false]]);
    expect(await recordDeploys(l, async () => live, NOW)).toEqual([]);
    expect(l.landings[1]!.deployed!.result).toBe("FAILED");
  });
  test("a ledger with a backend landing still waiting needs a reconcile", async () => {
    const l = emptyLedger("x");
    expect(needsReconcile(l)).toBe(false);
    l.landings.push(be("be#1", "2026-09-16T00:00:00Z", "d"));
    expect(needsReconcile(l)).toBe(true);
    l.landings[0]!.deployed = { ...live, told: true };
    expect(needsReconcile(l)).toBe(false);
  });
  test("an old ledger with no deploy on its landings still parses", async () => {
    expect(parseLedger(await Bun.file(`${FIX}valid.json`).json()).landings[0]!.deployed).toBeUndefined();
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
    expect(settled(r2.cleared)).toEqual(["A-2: ALD-53 is live, closed"]);
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
    expect(r.ledger.tickets[1]!.settled).toEqual({ outcome: "done", at: "2026-09-12", evidence: [{ kind: "pr", repo: "fe", number: 437, url: expect.stringContaining("437") }] });
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
    expect(settled(r.cleared)).toEqual(["ALD-46: landed as be#780 and is live, done"]);
    expect(r.ledger.tickets[1]!.settled?.at).toBe("2026-09-13");
    expect(r.ledger.tickets[2]!.settled).toBeUndefined();
    expect(r.ledger.tickets[0]!.settled).toBeUndefined();
  });
  test("a ticket blocker waiting on an ask-less ticket clears in the same run", async () => {
    const l = await valid();
    l.tickets.push({ key: "ALD-40", title: "x", asks: [], blockers: [], ready: true });
    l.landings.push(landing("fe", "fe#437", 437, "ALD-40"));
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-13T10:00:00Z"));
    expect(r.cleared).toEqual(["ALD-40: landed as fe#437 and is live, done", "ALD-41: ALD-40 is done"]);
  });
});

describe("Linear settles a ticket and the asks it serves", () => {
  const url = "https://linear.app/x/issue/ALD-52";
  const linear = (state: TicketState["state"]): TicketStates => (key) =>
    key === "ALD-52" ? ({ state, at: "2026-09-12T10:00:00Z", name: state === "done" ? "Done" : "Canceled", url, provider: "linear" } as TicketState) : { state: "unknown" };
  const withTicket = async () => {
    const l = await valid();
    l.asks[1]!.ticket = "ALD-52";
    l.tickets.push({ key: "ALD-52", title: "[FE] billing fields", asks: ["A-2"], blockers: [], ready: true });
    return l;
  };
  test("Done closes the ticket and its open ask with the ticket as evidence; the result validates and a second run is quiet", async () => {
    const l = await withTicket();
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-13T10:00:00Z"), linear("done"));
    expect(r.cleared).toEqual(["ALD-52: Done in Linear, done", "A-2: ALD-52 is Done, closed"]);
    const evidence: Evidence[] = [{ kind: "ticket", key: "ALD-52", url }];
    expect(r.ledger.tickets[1]!.settled).toEqual({ outcome: "done", at: "2026-09-12", evidence });
    expect(r.ledger.asks[1]!.status).toBe("closed");
    expect(r.ledger.asks[1]!.history.at(-1)).toEqual({ at: "2026-09-12", status: "closed", evidence });
    expect(validateLedger(r.ledger, { prev: l, actor: "model" })).toEqual([]);
    expect((await reconcileLedger(r.ledger, async () => null, undefined, linear("done"))).cleared).toEqual([]);
  });
  test("Canceled drops both; open and unknown move nothing", async () => {
    const l = await withTicket();
    const r = await reconcileLedger(l, async () => null, undefined, linear("canceled"));
    expect(r.cleared).toEqual(["ALD-52: Canceled in Linear, dropped", "A-2: ALD-52 is Canceled, dropped"]);
    expect(r.ledger.tickets[1]!.settled?.outcome).toBe("dropped");
    expect(r.ledger.asks[1]!.status).toBe("dropped");
    expect(validateLedger(r.ledger, { prev: l, actor: "model" })).toEqual([]);
    expect((await reconcileLedger(l, async () => null, undefined, linear("open"))).cleared).toEqual([]);
    expect((await reconcileLedger(l, async () => null)).cleared).toEqual([]);
  });
  test("a settled date before the ask was made falls back to today", async () => {
    const l = await withTicket();
    l.asks[1]!.at = "2026-09-13T12:00:00Z";
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-14T10:00:00Z"), linear("done"));
    expect(r.ledger.asks[1]!.history.at(-1)!.at).toBe("2026-09-14");
  });
});

describe("Trello settles an AP ticket, same as Linear settles a Linear one (CTD-199)", () => {
  const trello: TicketStates = (key) =>
    key === "AP-207" ? { state: "done", at: "2026-09-12T10:00:00Z", name: "Deployed", url: "https://trello.com/c/abc207", provider: "trello" } : { state: "unknown" };
  test("the report line names Trello, not Linear", async () => {
    const l = await valid();
    l.asks[1]!.ticket = "AP-207";
    l.tickets.push({ key: "AP-207", title: "[FE] tab projects", asks: ["A-2"], blockers: [], ready: true });
    const r = await reconcileLedger(l, async () => null, new Date("2026-09-13T10:00:00Z"), trello);
    expect(r.cleared).toEqual(["AP-207: Deployed in Trello, done", "A-2: AP-207 is Deployed, closed"]);
    expect(validateLedger(r.ledger, { prev: l, actor: "model" })).toEqual([]);
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
    expect(r.map((x) => [x.feature, x.cleared.length, x.write?.wrote])).toEqual([["admin/invoicing", 2, true]]);
    const after = (await readLedger("admin/invoicing"))!;
    expect(after.asks[1]!.ready).toBe(true);
    expect(validateLedger(after)).toEqual([]);
    expect(await reconcileAll({ deployed: async () => live })).toEqual([]);
  });
  test("an AP ticket, with no Trello credential set, is left exactly as it was (CTD-199 AC2)", async () => {
    delete process.env.TRELLO_API_KEY;
    delete process.env.TRELLO_TOKEN;
    const before = (await readLedger("admin/invoicing"))!;
    before.tickets.push({ key: "AP-1", title: "[FE] tab projects", asks: [], blockers: [], ready: true });
    await Bun.write(join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"), JSON.stringify(before));
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await reconcileAll({ deployed: async () => null, now: new Date("2026-09-11T10:00:00Z") });
      expect(r).toEqual([]);
      const after = (await readLedger("admin/invoicing"))!;
      expect(after.tickets.find((t) => t.key === "AP-1")?.settled).toBeUndefined();
      const lines = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("TRELLO"));
      expect(lines).toEqual([expect.stringContaining("TRELLO_API_KEY and TRELLO_TOKEN")]);
    } finally {
      errSpy.mockRestore();
    }
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
  test("finds the pipeline by commit prefix, tells running from not found, and answers undefined without credentials", async () => {
    expect(await pipelineFor("x/y", "dev", "06d27c81", { fetch: fetchStub, auth: "Basic x" })).toEqual({
      state: "done",
      deploy: { result: "SUCCESSFUL", at: "2026-09-10T07:34:37.1Z", build: 2084, url: expect.stringContaining("2084") },
    });
    expect(await pipelineFor("x/y", "dev", "aaaaaaaaa", { fetch: fetchStub, auth: "Basic x" })).toEqual({ state: "running" });
    expect(await pipelineFor("x/y", "dev", "ffffffff", { fetch: fetchStub, auth: "Basic x" })).toEqual({ state: "not-found" });
    expect(await pipelineFor("x/y", "dev", "06d27c81", { fetch: fetchStub, auth: null })).toBeUndefined();
  });
  test("reads Bitbucket's largest page, so an older merge is still found", async () => {
    const urls: string[] = [];
    const spy = (async (u: string) => (urls.push(u), new Response(JSON.stringify(page)))) as unknown as typeof fetch;
    await pipelineFor("x/y", "dev", "06d27c81", { fetch: spy, auth: "Basic x" });
    expect(urls[0]).toContain("pagelen=100");
  });
  test("deployCheck caches only a finished pipeline, and never asks about the frontend", async () => {
    const cache: DeployCache = {};
    expect(await deployCheck("be", "aaaaaaaaa", { fetch: fetchStub, auth: "Basic x", cache })).toEqual({ state: "running" });
    expect(cache).toEqual({});
    await deployCheck("be", "06d27c81", { fetch: fetchStub, auth: "Basic x", cache });
    expect(Object.keys(cache)).toEqual(["be@06d27c81"]);
    const none = (async () => {
      throw new Error("asked");
    }) as unknown as typeof fetch;
    expect((await deployCheck("be", "06d27c81", { fetch: none, auth: "Basic x", cache })).state).toBe("done");
    expect(await deployCheck("fe", "06d27c81", { fetch: none, auth: "Basic x", cache })).toEqual({ state: "unknown", why: expect.any(String) });
    expect(await deployCheck("be", "ffffffff", { fetch: fetchStub, auth: null, cache })).toEqual({ state: "unknown", why: "no Bitbucket credentials" });
  });
});

describe("reconcileAll settles revisions (CTD-196)", () => {
  let ws: string;
  const T = new Date("2026-09-14T10:00:00Z");
  const at = (...p: string[]) => join(ws, ...p);
  const spec = (feature: string) => `---\nfeature: ${feature}\nrevised_by: draft\nnext_id: 2\n---\n# Spec\n\n## Criteria\n- S-1 — a thing is observed.\n\n## Retired\n- none\n`;
  const done = (key: string): TicketState => ({ state: "done", at: T.toISOString(), name: "Done", url: `https://linear.app/x/${key}`, provider: "linear" });
  const canceled: TicketState = { state: "canceled", at: T.toISOString(), name: "Canceled", url: "https://linear.app/x/c", provider: "linear" };
  /** a Linear that answers from the map and records every key it was asked for */
  const linear = (map: Record<string, TicketState>) => {
    const asked: string[][] = [];
    const states = async (keys: string[]): Promise<TicketStates> => {
      asked.push(keys);
      return (k) => map[k] ?? { state: "unknown" };
    };
    return { asked, states };
  };
  async function filed(slug: string, key: string, features: string[]) {
    await newRevision(slug, { title: slug, features }, { now: T });
    for (const f of features) {
      const p = at("revisions", slug, "specs", `${f}.md`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, spec(f));
    }
    await fileRevision(slug, key, ["CTD-999"], { now: T });
  }
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "argus-fold-"));
    process.env.ARGUS_ROOT = ws;
    mkdirSync(at("foundry/features/jobs/docs"), { recursive: true });
    writeFileSync(at("foundry/features/jobs/docs/product.md"), "# Jobs product\n");
    writeFileSync(at("foundry/features/jobs/docs/arch.md"), "# Jobs arch\n");
    mkdirSync(at("alden/alden-portal/features/tasks"), { recursive: true });
    writeFileSync(at("alden/alden-portal/features/tasks/ledger.json"), serializeLedger(emptyLedger("tasks", "", "2026-09-10T00:00:00.000Z")));
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });

  test("AC1: a Done parent folds each spec into its feature, retires product.md, and archives as done; a second run writes nothing", async () => {
    await filed("jobs-rev", "CTD-10", ["foundry/jobs", "alden/alden-portal/tasks"]);
    const { asked, states } = linear({ "CTD-10": done("CTD-10") });
    const r = await reconcileAll({ states, now: T });
    expect(asked[0]).toContain("CTD-10");
    expect(r).toEqual([
      expect.objectContaining({
        feature: "revisions/CTD-10",
        write: null,
        cleared: ["CTD-10: Done in Linear — folded into alden/alden-portal/tasks, foundry/jobs; 1 product doc(s) retired; archived as done"],
      }),
    ]);
    const jobs = at("foundry/features/jobs/docs/spec.md");
    expect(readFileSync(jobs, "utf8")).toContain("revised_by: CTD-10");
    expect(await validateSpec(jobs, "foundry/jobs")).toEqual([]);
    expect(existsSync(at("foundry/features/jobs/docs/product.md"))).toBe(false);
    expect(existsSync(at("foundry/features/jobs/docs/arch.md"))).toBe(true);
    expect(existsSync(at("alden/alden-portal/features/tasks/docs/spec.md"))).toBe(true);
    expect(existsSync(at("revisions/CTD-10"))).toBe(false);
    expect(existsSync(at("revisions/archive/CTD-10/specs/foundry/jobs.md"))).toBe(true);
    const found = await readRevision("CTD-10");
    expect(found?.archived).toBe(true);
    expect(found?.rev).toMatchObject({ status: "done", at: { settled: "2026-09-14" } });
    expect(found?.rev.evidence.filter((e) => e.kind === "ticket")).toHaveLength(1);
    const again = linear({ "CTD-10": done("CTD-10") });
    expect(await reconcileAll({ states: again.states, now: T })).toEqual([]);
    expect(again.asked[0]).not.toContain("CTD-10");
  });

  test("AC2: a Canceled parent archives the revision as dropped; no spec is written and product.md stays", async () => {
    await filed("gone", "CTD-20", ["foundry/jobs"]);
    const r = await reconcileAll({ states: linear({ "CTD-20": canceled }).states, now: T });
    expect(r[0]?.cleared).toEqual(["CTD-20: Canceled in Linear — archived as dropped"]);
    expect((await readRevision("CTD-20"))?.rev).toMatchObject({ status: "dropped", at: { settled: "2026-09-14" } });
    expect(existsSync(at("foundry/features/jobs/docs/spec.md"))).toBe(false);
    expect(existsSync(at("foundry/features/jobs/docs/product.md"))).toBe(true);
  });

  test("AC3: a parent that is open, or that Linear cannot report, leaves the revision byte-for-byte", async () => {
    await filed("a", "CTD-30", ["foundry/jobs"]);
    await filed("b", "CTD-40", ["foundry/jobs"]);
    const before = [readFileSync(at("revisions/CTD-30/revision.json")), readFileSync(at("revisions/CTD-40/revision.json"))];
    const r = await reconcileAll({ states: linear({ "CTD-30": { state: "open", name: "In Progress", url: "u", provider: "linear" } }).states, now: T });
    expect(r).toEqual([]);
    expect(readFileSync(at("revisions/CTD-30/revision.json")).equals(before[0]!)).toBe(true);
    expect(readFileSync(at("revisions/CTD-40/revision.json")).equals(before[1]!)).toBe(true);
    expect(existsSync(at("foundry/features/jobs/docs/spec.md"))).toBe(false);
  });

  test("a dry run reports the fold and writes nothing", async () => {
    await filed("jobs-rev", "CTD-10", ["foundry/jobs"]);
    const r = await reconcileAll({ states: linear({ "CTD-10": done("CTD-10") }).states, now: T, dryRun: true });
    expect(r[0]?.cleared[0]).toContain("folded into foundry/jobs; 1 product doc(s) retired");
    expect(existsSync(at("revisions/CTD-10/revision.json"))).toBe(true);
    expect(existsSync(at("foundry/features/jobs/docs/product.md"))).toBe(true);
    expect(existsSync(at("foundry/features/jobs/docs/spec.md"))).toBe(false);
  });

  test("a run scoped to named features leaves the revisions alone", async () => {
    await filed("jobs-rev", "CTD-10", ["foundry/jobs"]);
    const l = linear({ "CTD-10": done("CTD-10") });
    expect(await reconcileAll({ features: ["tasks"], states: l.states, now: T })).toEqual([]);
    expect(l.asked[0] ?? []).not.toContain("CTD-10");
    expect((await readRevision("CTD-10"))?.rev.status).toBe("filed");
  });

  test("a revision whose feature has gone is reported, writes nothing, and stays filed for the next run", async () => {
    await filed("jobs-rev", "CTD-10", ["foundry/jobs", "alden/alden-portal/tasks"]);
    rmSync(at("foundry/features/jobs"), { recursive: true, force: true });
    const r = await reconcileAll({ states: linear({ "CTD-10": done("CTD-10") }).states, now: T });
    expect(r[0]?.error).toBe("CTD-10: not settled — foundry/jobs is no longer a feature directory");
    expect(existsSync(at("alden/alden-portal/features/tasks/docs/spec.md"))).toBe(false);
    expect((await readRevision("CTD-10"))?.rev.status).toBe("filed");
  });

  test("CTD-199: an AP-keyed parent folds via Trello, and the report line names Trello, not Linear", async () => {
    await filed("tab-projects", "AP-207", ["foundry/jobs"]);
    const trelloDone: TicketState = { state: "done", at: T.toISOString(), name: "Deployed", url: "https://trello.com/c/abc207", provider: "trello" };
    const r = await reconcileAll({ states: async () => (k) => (k === "AP-207" ? trelloDone : { state: "unknown" }), now: T });
    expect(r[0]?.cleared).toEqual(["AP-207: Deployed in Trello — folded into foundry/jobs; 1 product doc(s) retired; archived as done"]);
    expect((await readRevision("AP-207"))?.rev.status).toBe("done");
  });

  test("CTD-199 AC2: an AP-keyed revision whose parent Trello could not report (no credential) stays filed", async () => {
    await filed("tab-projects", "AP-207", ["foundry/jobs"]);
    const r = await reconcileAll({ states: async () => () => ({ state: "unknown" }), now: T });
    expect(r).toEqual([]);
    expect((await readRevision("AP-207"))?.rev.status).toBe("filed");
    expect(existsSync(at("foundry/features/jobs/docs/spec.md"))).toBe(false);
  });
});
