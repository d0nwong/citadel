/**
 * The ledger reader against a temp workspace: nested features resolve, a broken file is
 * a problem beside the good ones, and the home lists are derived the way the record
 * intends: on-you is every open ask aimed at "you", ready is every ticket with no
 * blocker left, unplaced is argus's file or nothing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Ledger } from "#/lib/ledger";
import { home, listLedgers, readLedger, readUnplaced } from "./ledger";
import type { AppRoot } from "./workspace";

const FIXTURE = new URL("../test/fixtures/ledger.json", import.meta.url)
  .pathname;
const APP = "alden/alden-portal";
let root: string;
let roots: AppRoot[];

const put = async (rel: string, body: unknown) => {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(
    abs,
    typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`
  );
};

const fixture = async (over: Partial<Ledger> = {}): Promise<Ledger> => ({
  ...(JSON.parse(await Bun.file(FIXTURE).text()) as Ledger),
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pensieve-ledger-"));
  roots = [{ app: APP, dir: join(root, APP, "features") }];
  await put(`${APP}/features/admin/invoicing/ledger.json`, await fixture());
  await put(
    `${APP}/features/tasks/ledger.json`,
    await fixture({ asks: [], feature: "tasks", proposals: [], tickets: [] })
  );
  await put(`${APP}/features/broken/ledger.json`, "{ not json");
  await put(`${APP}/features/nothing/docs/arch.md`, "# no ledger here\n");
});
afterEach(() => rm(root, { force: true, recursive: true }));

describe("listLedgers", () => {
  test("finds nested and flat ledgers, reports the broken one, skips a feature without one", async () => {
    const { ledgers, problems } = await listLedgers(roots);
    expect(ledgers.map((l) => l.feature)).toEqual([
      `${APP}/admin/invoicing`,
      `${APP}/tasks`,
    ]);
    expect(problems).toEqual([
      { app: APP, dir: "broken", problem: expect.stringContaining("JSON") },
    ]);
  });
  test("readLedger takes the route param or a unique bare dir", async () => {
    expect((await readLedger(`${APP}/admin/invoicing`, roots))?.dir).toBe(
      "admin/invoicing"
    );
    expect((await readLedger("tasks", roots))?.feature).toBe(`${APP}/tasks`);
    expect(await readLedger("nope", roots)).toBeNull();
  });
});

describe("home", () => {
  test("on-you, ready and the feature summaries", async () => {
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.onYou.map((a) => [a.id, a.dir])).toEqual([
      ["A-2", "admin/invoicing"],
    ]);
    expect(h.ready).toEqual([]);
    expect(h.unplaced).toEqual([]);
    expect(
      h.features.map((f) => [f.dir, f.open, f.onYou, f.proposals])
    ).toEqual([
      ["admin/invoicing", 1, 1, 1],
      ["tasks", 0, 0, 0],
    ]);
    expect(h.problems).toHaveLength(1);
  });
  test("a ticket with every blocker cleared is ready; unplaced comes from argus's file", async () => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    await put("state/unplaced.json", [
      {
        at: "2026-09-11",
        batch: "b",
        by: "Sam O",
        candidates: ["tasks"],
        id: "1",
        kind: "message",
        text: "x",
        url: "u",
      },
    ]);
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.map((t) => t.key)).toEqual(["ALD-41"]);
    expect(h.unplaced).toHaveLength(1);
    expect(await readUnplaced(join(root, "missing.json"))).toEqual([]);
  });
});
