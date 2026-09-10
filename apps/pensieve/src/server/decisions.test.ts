import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarauderDecision } from "../lib/marauder";
import { isMarauderId } from "../lib/marauder";
import { isSendId } from "../lib/send";
import type { SendDecision } from "./decisions";
import {
  decisionPath,
  parseMarauderDecision,
  parseSendDecision,
  readMarauderDecision,
  readMarauderDecisions,
  readSendDecision,
  readSendDecisions,
  writeMarauderDecision,
  writeSendDecision,
} from "./decisions";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-decisions-"));
});
afterEach(() => rm(dir, { force: true, recursive: true }));

describe("the writer refuses anything outside decisions/", () => {
  test("a well-formed id maps to decisions/<group>/<slug>.json", () => {
    expect(decisionPath("marauder/fe-417", dir)).toBe(
      join(dir, "marauder", "fe-417.json")
    );
    expect(decisionPath("send/lia-162", dir)).toBe(
      join(dir, "send", "lia-162.json")
    );
  });
  test.each([
    "../etc/passwd",
    "marauder/../../x",
    "/marauder/x",
    "marauder/x/y",
    "send/../x",
    "reports/points",
    "marauder/",
    "marauder/UPPER",
    "marauder/a b",
    "marauder/-leading",
    "decide/lia-86",
    "arc/invoice-emails",
    "",
  ])("refuses %j", (id) => {
    expect(isMarauderId(id) || isSendId(id)).toBe(false);
    expect(() => decisionPath(id, dir)).toThrow(/refused/);
  });
});

// ── the marauder group: a correction, or a confirmed event (LIA-160, LIA-162) ──

const entry = (extra: Partial<MarauderDecision> = {}): MarauderDecision => ({
  action: "attach",
  at: "2026-09-09T20:00:00.000Z",
  by: "Liam Leung",
  id: "fe#417",
  slug: "usage-page",
  ...extra,
});

describe("AC3 — the decision file a click writes", () => {
  test("lands at decisions/marauder/<slug>.json, atomically, with the id inside", async () => {
    const target = await writeMarauderDecision(entry(), dir);
    expect(target).toBe(join(dir, "marauder", "fe-417.json"));
    // The name is the id folded to a path segment; the id itself is what ingest matches on.
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      action: "attach",
      at: "2026-09-09T20:00:00.000Z",
      by: "Liam Leung",
      id: "fe#417",
      slug: "usage-page",
    });
    // Nothing half-written is left behind for the sweep to read.
    expect(
      (await readdir(join(dir, "marauder"))).filter((n) => n.includes(".tmp-"))
    ).toEqual([]);
  });

  test("a second click reads the file already there rather than writing a later one", async () => {
    await writeMarauderDecision(entry(), dir);
    const already = await readMarauderDecision("fe#417", dir);
    expect(already).toMatchObject({ action: "attach", slug: "usage-page" });
    // What `decideUnsorted` does with that: answer it, and write nothing more.
    const before = await readFile(join(dir, "marauder", "fe-417.json"), "utf8");
    expect(await readMarauderDecision("fe#417", dir)).toEqual(already);
    expect(await readFile(join(dir, "marauder", "fe-417.json"), "utf8")).toBe(
      before
    );
  });

  test("an entry with no decision reads as none", async () => {
    expect(await readMarauderDecision("fe#999", dir)).toBeNull();
  });

  test("a dismiss with no reason is not a decision ingest would apply", () => {
    expect(
      parseMarauderDecision(
        JSON.stringify({ action: "dismiss", at: "", by: "", id: "fe#417" })
      )
    ).toBeNull();
    expect(
      parseMarauderDecision(
        JSON.stringify({
          action: "dismiss",
          at: "",
          by: "",
          id: "fe#417",
          reason: "chat",
        })
      )
    ).toMatchObject({ action: "dismiss", reason: "chat" });
  });

  test.each([
    ["not JSON at all", "{"],
    ["an unknown verb", JSON.stringify({ action: "ignore", id: "fe#417" })],
    ["no id", JSON.stringify({ action: "attach", slug: "usage-page" })],
    [
      "an attach naming no workstream",
      JSON.stringify({ action: "attach", id: "fe#417" }),
    ],
    ["a new with no name", JSON.stringify({ action: "new", id: "fe#417" })],
  ])("%s is refused", (_what, text) => {
    expect(parseMarauderDecision(text)).toBeNull();
  });

  test("the queue reads back keyed by the entry's own id, later verdict winning", async () => {
    await writeMarauderDecision(entry(), dir);
    await writeMarauderDecision(
      entry({
        action: "dismiss",
        id: "split/usage-page",
        reason: "not two things",
      }),
      dir
    );
    const all = await readMarauderDecisions(dir);
    expect([...all.keys()].sort()).toEqual(["fe#417", "split/usage-page"]);
    expect(all.get("split/usage-page")?.action).toBe("dismiss");
  });
});

// ── the send group: a ticket handed to Foundry (LIA-162 AC2) ───────────────────

const sent = (extra: Partial<SendDecision> = {}): SendDecision => ({
  action: "sent",
  at: "2026-09-09T20:00:00.000Z",
  by: "Liam Leung",
  job: { id: "9f1c2d3e", url: "http://localhost:3777/" },
  ticket: "LIA-162",
  ...extra,
});

describe("AC2 — the file a Send writes", () => {
  test("lands at decisions/send/<ticket>.json with the key inside, verbatim", async () => {
    const target = await writeSendDecision(sent(), dir);
    expect(target).toBe(join(dir, "send", "lia-162.json"));
    // The name is the key folded to the one shape every decision file's name has; the key
    // itself travels inside, since that is what argus's `sentTickets` matches on.
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      action: "sent",
      at: "2026-09-09T20:00:00.000Z",
      by: "Liam Leung",
      job: { id: "9f1c2d3e", url: "http://localhost:3777/" },
      ticket: "LIA-162",
    });
    expect(
      (await readdir(join(dir, "send"))).filter((n) => n.includes(".tmp-"))
    ).toEqual([]);
  });

  test("argus would read it: a `sent` action, a job, and an LIA key to match on", async () => {
    // `scripts/marauder.ts` sentTickets: `d.action === "sent" && d.job`, then /\bLIA-\d+\b/
    // over `${d.ticket} ${d.subject}`. Restated here so a change to either side shows up.
    const file = JSON.parse(
      await readFile(await writeSendDecision(sent(), dir), "utf8")
    );
    expect(file.action).toBe("sent");
    expect(file.job).toBeTruthy();
    expect(`${file.ticket ?? ""} ${file.subject ?? ""}`).toMatch(/\bLIA-\d+\b/);
  });

  test("a second click reads the file already there rather than sending again", async () => {
    await writeSendDecision(sent(), dir);
    const already = await readSendDecision("LIA-162", dir);
    expect(already).toMatchObject({ action: "sent", ticket: "LIA-162" });
    const before = await readFile(join(dir, "send", "lia-162.json"), "utf8");
    expect(await readSendDecision("LIA-162", dir)).toEqual(already);
    expect(await readFile(join(dir, "send", "lia-162.json"), "utf8")).toBe(
      before
    );
  });

  test("an unsent ticket, and a key that is not one, read as none", async () => {
    expect(await readSendDecision("LIA-999", dir)).toBeNull();
    expect(await readSendDecision("not a key", dir)).toBeNull();
  });

  test.each([
    ["not JSON at all", "{"],
    ["no ticket", JSON.stringify({ action: "sent", job: { id: "a" } })],
    [
      "no job — argus ignores it, so it is never written",
      JSON.stringify({ action: "sent", ticket: "LIA-162" }),
    ],
    [
      "a job with no id",
      JSON.stringify({ action: "sent", job: {}, ticket: "LIA-162" }),
    ],
    [
      "another verb",
      JSON.stringify({
        action: "ignored",
        job: { id: "a" },
        ticket: "LIA-162",
      }),
    ],
  ])("%s is refused", (_what, text) => {
    expect(parseSendDecision(text)).toBeNull();
  });

  test("the group reads back keyed by the ticket, later send winning", async () => {
    await writeSendDecision(sent(), dir);
    await writeSendDecision(sent({ ticket: "LIA-116" }), dir);
    const all = await readSendDecisions(dir);
    expect([...all.keys()].sort()).toEqual(["LIA-116", "LIA-162"]);
    expect(all.get("LIA-162")?.job.id).toBe("9f1c2d3e");
  });
});

// ── the event-keyed Verify (LIA-162 AC3) ───────────────────────────────────────

describe("AC3 — the file a Verify writes", () => {
  test("is a marauder decision keyed by the event, with no argument but the id", async () => {
    const target = await writeMarauderDecision(
      {
        action: "verified",
        at: "2026-09-09T21:00:00.000Z",
        by: "Liam Leung",
        id: "LIA-133",
      },
      dir
    );
    expect(target).toBe(join(dir, "marauder", "lia-133.json"));
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      action: "verified",
      at: "2026-09-09T21:00:00.000Z",
      by: "Liam Leung",
      id: "LIA-133",
    });
  });

  test("a note rides along as the reason the correction stamps onto the event", async () => {
    await writeMarauderDecision(
      {
        action: "verified",
        at: "2026-09-09T21:00:00.000Z",
        by: "Liam Leung",
        id: "1788949866.296519",
        reason: "yes — and say the fee is per entity",
      },
      dir
    );
    expect(await readMarauderDecision("1788949866.296519", dir)).toMatchObject({
      action: "verified",
      reason: "yes — and say the fee is per entity",
    });
  });

  test("`verified` is a verb ingest applies, unlike an invented one", () => {
    expect(
      parseMarauderDecision(
        JSON.stringify({ action: "verified", at: "", by: "", id: "LIA-133" })
      )
    ).toMatchObject({ action: "verified", id: "LIA-133" });
    expect(
      parseMarauderDecision(
        JSON.stringify({ action: "confirmed", at: "", by: "", id: "LIA-133" })
      )
    ).toBeNull();
  });
});
