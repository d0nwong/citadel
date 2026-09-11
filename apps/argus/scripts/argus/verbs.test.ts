/**
 * The click verbs against a temp workspace: each is idempotent, each writes `user`
 * evidence, refusals write nothing, and `place` teaches the thread map.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readThreads, readUnplaced, writeUnplaced, type Unplaced } from "./state.ts";
import { closeAsk, confirmRequirement, dismissMessage, dropAsk, moveAsk, placeMessage, recordSent, recordTicket, recordTicketForAsk } from "./verbs.ts";
import { readLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const T0 = new Date("2026-09-11T10:00:00Z");
let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-verbs-"));
  process.env.ARGUS_ROOT = ws;
  for (const f of ["tasks", "admin/invoicing"]) mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
  cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

describe("close", () => {
  test("closes an open ask with user evidence, and a second close is a no-op", async () => {
    const r = await closeAsk("admin/invoicing", "A-2", "answered in the standup", { now: T0 });
    expect(r.wrote).toBe(true);
    expect(r.diff).toEqual(["A-2 asked → closed"]);
    const a = (await readLedger("admin/invoicing"))!.asks[1]!;
    expect(a.status).toBe("closed");
    expect(a.history.at(-1)?.evidence[0]).toEqual({ kind: "user", reason: "answered in the standup", at: T0.toISOString() });
    const again = await closeAsk("admin/invoicing", "A-2", "again", { now: new Date("2026-09-11T11:00:00Z") });
    expect(again.wrote).toBe(false);
  });
  test("refuses an unknown ask and writes nothing", async () => {
    await expect(closeAsk("admin/invoicing", "A-9", "x")).rejects.toThrow("no ask A-9");
    await expect(closeAsk("tasks", "A-1", "x")).rejects.toThrow("no ledger");
  });
});

describe("confirm", () => {
  test("confirms one requirement, dropping its assumption evidence", async () => {
    const r = await confirmRequirement("admin/invoicing", "R-3", "lived with it since launch", { now: T0 });
    expect(r.diff).toEqual(["R-3 assumed → confirmed"]);
    const req = (await readLedger("admin/invoicing"))!.requirements[2]!;
    expect(req.status).toBe("confirmed");
    expect(req.by).toBe("you");
    expect(req.evidence.map((e) => e.kind)).toEqual(["user"]);
  });
  test("contradicts with a reason", async () => {
    const r = await confirmRequirement("admin/invoicing", "R-1", "Foong changed his mind on Friday", { now: T0, contradict: true, by: "Foong Leung" });
    expect(r.diff).toEqual(["R-1 confirmed → contradicted"]);
    expect((await readLedger("admin/invoicing"))!.requirements[0]!.by).toBe("Foong Leung");
  });
  test("--all confirms only the assumed ones, and is idempotent", async () => {
    const r = await confirmRequirement("admin/invoicing", null, "bulk after launch", { now: T0, all: true });
    expect(r.diff).toEqual(["R-3 assumed → confirmed"]);
    const l = (await readLedger("admin/invoicing"))!;
    expect(l.requirements.map((x) => x.status)).toEqual(["confirmed", "contradicted", "confirmed"]);
    expect((await confirmRequirement("admin/invoicing", null, "again", { all: true })).wrote).toBe(false);
  });
  test("refuses an unknown requirement", async () => {
    await expect(confirmRequirement("admin/invoicing", "R-9", "x")).rejects.toThrow("no requirement R-9");
  });
});

describe("place", () => {
  const unplaced: Unplaced[] = [
    { id: "1789000000.000001", kind: "message", by: "Sam O", at: "2026-09-11", text: "root", url: "u1", candidates: ["tasks", "admin/usage"], batch: "b" },
    { id: "1789000000.000002", kind: "message", thread: "1789000000.000001", by: "Foong Leung", at: "2026-09-11", text: "reply", url: "u2", candidates: [], batch: "b" },
    { id: "1789000000.000003", kind: "message", by: "Carlos Lopes", at: "2026-09-11", text: "other", url: "u3", candidates: [], batch: "b" },
    { id: "fe#430", kind: "landing", by: "you", at: "2026-09-11", text: "a landing", url: "u4", candidates: [], batch: "b" },
  ];
  beforeEach(() => writeUnplaced(unplaced));

  test("places a root, takes its replies with it, teaches the thread, opens a ledger", async () => {
    const r = await placeMessage("1789000000.000001", "tasks", { now: T0 });
    expect(r).toMatchObject({ placed: true, feature: "tasks", thread: "1789000000.000001" });
    expect(r.ledger?.wrote).toBe(true);
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1789000000.000003", "fe#430"]);
    expect(await readThreads()).toEqual({ "1789000000.000001": { feature: "tasks", by: "user", at: T0.toISOString() } });
    expect((await readLedger("tasks"))?.feature).toBe("tasks");
  });
  test("placing a reply places its whole thread", async () => {
    await placeMessage("1789000000.000002", "admin/invoicing", { now: T0 });
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1789000000.000003", "fe#430"]);
    expect((await readThreads())["1789000000.000001"]?.feature).toBe("admin/invoicing");
  });
  test("a landing has no thread and opens no second ledger", async () => {
    const r = await placeMessage("fe#430", "admin/invoicing", { now: T0 });
    expect(r.thread).toBeNull();
    expect(r.ledger).toBeNull();
    expect(await readThreads()).toEqual({});
  });
  test("refuses an unknown id or feature and changes nothing", async () => {
    await expect(placeMessage("nope", "tasks")).rejects.toThrow("not in the unplaced list");
    await expect(placeMessage("1789000000.000001", "nope")).rejects.toThrow("not a feature");
    expect(await readUnplaced()).toHaveLength(4);
    expect(await readThreads()).toEqual({});
  });
  test("dismiss takes a root and its replies off the list and marks the thread nobody's", async () => {
    const r = await dismissMessage("1789000000.000001", { now: T0 });
    expect(r).toEqual({ dismissed: true, thread: "1789000000.000001", removed: 2 });
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1789000000.000003", "fe#430"]);
    expect(await readThreads()).toEqual({ "1789000000.000001": { feature: null, by: "user", at: T0.toISOString() } });
    await expect(dismissMessage("1789000000.000001")).rejects.toThrow("not in the unplaced list");
  });
  test("dismissing a reply dismisses its thread; a landing has no thread; a dry run changes nothing", async () => {
    await dismissMessage("1789000000.000002", { now: T0 });
    expect((await readThreads())["1789000000.000001"]?.feature).toBeNull();
    const l = await dismissMessage("fe#430", { now: T0 });
    expect(l).toEqual({ dismissed: true, thread: null, removed: 1 });
    expect(Object.keys(await readThreads())).toEqual(["1789000000.000001"]);
    const d = await dismissMessage("1789000000.000003", { dryRun: true });
    expect(d.dismissed).toBe(false);
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1789000000.000003"]);
  });
  test("dry run reports and writes nothing", async () => {
    const r = await placeMessage("1789000000.000001", "tasks", { dryRun: true });
    expect(r.placed).toBe(false);
    expect(await readUnplaced()).toHaveLength(4);
  });
});

describe("ticket", () => {
  test("turns a proposal into a ticket and keys its asks; a repeat is a no-op", async () => {
    const r = await recordTicket("admin/invoicing", "P-1", "ALD-52", { now: T0 });
    expect(r.diff).toEqual(["+ ALD-52 ready", "- P-1 gone"]);
    const l = (await readLedger("admin/invoicing"))!;
    expect(l.proposals).toEqual([]);
    expect(l.tickets.map((t) => t.key)).toEqual(["ALD-41", "ALD-52"]);
    expect(l.asks[1]?.ticket).toBe("ALD-52");
    expect((await recordTicket("admin/invoicing", "P-1", "ALD-52")).wrote).toBe(false);
  });
  test("refuses an unknown proposal", async () => {
    await expect(recordTicket("admin/invoicing", "P-7", "ALD-1")).rejects.toThrow("no proposal P-7");
  });
});

describe("sent", () => {
  test("records the job once; a replay of the same job is a no-op; an unknown ticket is refused", async () => {
    const r = await recordSent("admin/invoicing", "ALD-41", "alden-portal-fe", "job-1", { now: T0 });
    expect(r.wrote).toBe(true);
    expect((await readLedger("admin/invoicing"))!.tickets[0]!.sent).toEqual([{ at: T0.toISOString(), repo: "alden-portal-fe", job: "job-1" }]);
    expect((await recordSent("admin/invoicing", "ALD-41", "alden-portal-fe", "job-1")).wrote).toBe(false);
    await expect(recordSent("admin/invoicing", "ALD-99", "x", "j")).rejects.toThrow("no ticket ALD-99");
  });
});

describe("drop and a ticket from an ask", () => {
  test("drop settles an ask as dropped with the reason", async () => {
    const r = await dropAsk("admin/invoicing", "A-2", "that was chat", { now: T0 });
    expect(r.diff).toEqual(["A-2 asked → dropped"]);
    expect((await readLedger("admin/invoicing"))!.asks[1]!.history.at(-1)).toMatchObject({ status: "dropped", evidence: [{ kind: "user", reason: "that was chat" }] });
  });
  test("a ticket filed from an ask carries the ask's open blockers and puts the key on the ask", async () => {
    const l = (await readLedger("admin/invoicing"))!;
    l.asks[1]!.blockers = [{ kind: "answer", from: "Foong Leung", question: "which fields?", cleared: null }];
    await Bun.write(join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"), JSON.stringify(l));
    const r = await recordTicketForAsk("admin/invoicing", "A-2", "ALD-70", "[FE] Billing fields", { now: T0 });
    expect(r.diff).toEqual(["+ ALD-70 blocked"]);
    const after = (await readLedger("admin/invoicing"))!;
    expect(after.asks[1]!.ticket).toBe("ALD-70");
    expect(after.tickets.at(-1)).toMatchObject({ key: "ALD-70", asks: ["A-2"], ready: false });
    expect((await recordTicketForAsk("admin/invoicing", "A-2", "ALD-70", "x")).wrote).toBe(false);
  });
});

describe("move", () => {
  test("drops the ask here, re-creates it there with its trail, and re-points the thread", async () => {
    const r = await moveAsk("admin/invoicing", "A-2", "tasks", { now: T0 });
    expect(r.id).toBe("A-1");
    expect(r.from.diff).toEqual(["A-2 asked → dropped"]);
    const src = (await readLedger("admin/invoicing"))!;
    expect(src.asks[1]!.history.at(-1)!.evidence[0]).toMatchObject({ kind: "user", reason: "moved to tasks as A-1" });
    const dst = (await readLedger("tasks"))!;
    expect(dst.asks[0]).toMatchObject({ id: "A-1", status: "asked", text: expect.stringContaining("billing fields"), origin: { thread: "1788927279.211770" } });
    expect(dst.asks[0]!.history.at(-1)!.evidence[0]).toMatchObject({ kind: "user", reason: "moved from admin/invoicing A-2" });
    expect((await readThreads())["1788927279.211770"]).toMatchObject({ feature: "tasks", by: "user" });
    await expect(moveAsk("admin/invoicing", "A-2", "nope")).rejects.toThrow("not a feature");
  });
});
