/**
 * `writeLedger` against a temp workspace: no-op on an unchanged ledger, ids allocated
 * above the highest ever used, refusal leaves the file alone, `ready` derived, the diff
 * lines say what moved.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ledgerPath } from "./paths.ts";
import { emptyLedger, type Ledger, parseLedger } from "./schema.ts";
import { ValidationError } from "./validate.ts";
import { readLedger, writeLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const valid = async (): Promise<Ledger> => parseLedger(await Bun.file(`${FIX}valid.json`).json());
const T0 = new Date("2026-09-11T10:00:00Z");
const T1 = new Date("2026-09-11T11:00:00Z");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "argus-ws-"));
  process.env.ARGUS_ROOT = dir;
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(dir, { recursive: true, force: true });
});

describe("writeLedger", () => {
  test("reads null where there is no ledger, writes one, reads it back", async () => {
    expect(await readLedger("admin/invoicing")).toBeNull();
    const r = await writeLedger("admin/invoicing", await valid(), { now: T0 });
    expect(r.wrote).toBe(true);
    expect(r.ledger.as_of).toBe(T0.toISOString());
    expect(r.ledger.ids).toEqual({ R: 3, A: 2, P: 1 });
    expect((await readLedger("admin/invoicing"))?.asks).toHaveLength(2);
    expect(r.diff).toContain("+ A-2 asked: Sam asked you and Carlos who takes the front end for his three new billing fields.");
  });

  test("an unchanged ledger is a no-op, whatever its as_of says", async () => {
    await writeLedger("admin/invoicing", await valid(), { now: T0 });
    const path = ledgerPath("admin/invoicing");
    const before = statSync(path).mtimeMs;
    const again = { ...(await valid()), as_of: "2030-01-01T00:00:00Z" };
    const r = await writeLedger("admin/invoicing", again, { now: T1 });
    expect(r.wrote).toBe(false);
    expect(r.diff).toEqual([]);
    expect(statSync(path).mtimeMs).toBe(before);
    expect((await readLedger("admin/invoicing"))?.as_of).toBe(T0.toISOString());
  });

  test("new entries get ids above the highest ever used, including a removed proposal's", async () => {
    await writeLedger("admin/invoicing", await valid(), { now: T0 });
    // file the proposal (it leaves) and add an ask and a proposal with placeholder ids
    const next = await valid();
    next.proposals = [{ id: "", kind: "ticket", title: "[FE] Something new", body: "## Summary\n\nx\n", asks: ["A-1"], at: "2026-09-11" }];
    next.asks.push({
      id: "new",
      text: "Carlos asked for the export button.",
      by: "Carlos Lopes",
      to: "you",
      at: "2026-09-11",
      status: "asked",
      origin: { kind: "slack", url: "https://alden-studios.slack.com/archives/C07KG06L601/p1789200000000000", thread: "1789200000.000000" },
      history: [],
    });
    const r = await writeLedger("admin/invoicing", next, { now: T1 });
    expect(r.ledger.asks.at(-1)?.id).toBe("A-3");
    expect(r.ledger.proposals[0]?.id).toBe("P-2");
    expect(r.ledger.ids).toEqual({ R: 3, A: 3, P: 2 });
    expect(r.diff).toContain("- P-1 gone");
    expect(r.diff).toContain("+ P-2 proposed: [FE] Something new");
  });

  test("a refused write leaves the file untouched", async () => {
    await writeLedger("admin/invoicing", await valid(), { now: T0 });
    const bad = await valid();
    bad.requirements[0]!.evidence = [];
    await expect(writeLedger("admin/invoicing", bad, { now: T1 })).rejects.toBeInstanceOf(ValidationError);
    expect((await readLedger("admin/invoicing"))?.as_of).toBe(T0.toISOString());
  });

  test("the model cannot delete an ask; the user cannot either", async () => {
    await writeLedger("admin/invoicing", await valid(), { now: T0 });
    const fewer = await valid();
    fewer.asks.pop();
    fewer.proposals = [];
    await expect(writeLedger("admin/invoicing", fewer, { now: T1, actor: "user" })).rejects.toThrow("A-2 was in the previous ledger and is gone");
  });

  test("ready is derived, so a ledger claiming ready with a blocker is repaired, not refused", async () => {
    const l = await valid();
    l.tickets[0]!.ready = true;
    const r = await writeLedger("admin/invoicing", l, { now: T0 });
    expect(r.ledger.tickets[0]?.ready).toBe(false);
    const cleared = await valid();
    for (const b of cleared.tickets[0]!.blockers) b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "https://alden-studios.slack.com/archives/C07KG06L601/p1789200000000001" }] };
    const r2 = await writeLedger("admin/invoicing", cleared, { now: T1 });
    expect(r2.ledger.tickets[0]?.ready).toBe(true);
    expect(r2.diff).toContain("ALD-41 ready");
  });

  test("dry run validates and reports but writes nothing", async () => {
    const r = await writeLedger("tasks", emptyLedger("tasks", "Tasks and subtasks."), { now: T0, dryRun: true });
    expect(r.wrote).toBe(false);
    expect(r.diff).toEqual(["new ledger"]);
    expect(await readLedger("tasks")).toBeNull();
  });

  test("the feature in the file must match the feature written", async () => {
    await expect(writeLedger("tasks", await valid())).rejects.toThrow('says feature "admin/invoicing"');
  });
});

describe("writeLedger against a project's declared repo ids (ledger S-22, AC2)", () => {
  const projectsConfig = {
    projects: [
      {
        id: "widget",
        repos: [{ id: "app", cloneUrl: "https://example.com/app.git", path: "", baseBranch: "main", host: "github", deploy: { kind: "live" } }],
        trackers: [],
        jobs: ["record"],
        areas: [{ id: "widget", repo: "app", dir: "widget" }],
      },
    ],
    channels: [],
  };

  const widgetLedger = (repo: string): Ledger => ({
    ...emptyLedger("core", "A widget feature."),
    landings: [{ at: "2026-09-11", repo, ref: `${repo}#12`, number: 12, sha: "abc1234", title: "x", by: "Sam", url: null, asks: [], files: [] }],
  });

  test("a landing with the project's own repo id is accepted", async () => {
    writeFileSync(join(dir, "projects.json"), JSON.stringify(projectsConfig));
    const r = await writeLedger("core", widgetLedger("app"), { now: T0, app: "widget" });
    expect(r.wrote).toBe(true);
    expect(r.ledger.landings[0]?.repo).toBe("app");
  });

  test("a landing with an undeclared repo id is refused, and the ledger on disk is unchanged", async () => {
    writeFileSync(join(dir, "projects.json"), JSON.stringify(projectsConfig));
    await expect(writeLedger("core", widgetLedger("fe"), { now: T0, app: "widget" })).rejects.toBeInstanceOf(ValidationError);
    expect(await readLedger("core", "widget")).toBeNull();
  });
});
