/**
 * `marauder apply` — a verdict applied and rendered on demand (ARG-168 AC1–AC3), run as the
 * real command against a fixture root.
 *
 *   bun test skills/sweep/scripts/marauder/apply.test.ts
 */

import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, exists, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeWork, type UnsortedItem, type Work } from "./record.ts";

const SCRIPT = join(import.meta.dir, "../../../../scripts/marauder.ts");
const APP = "alden/alden-portal";
const NOW = "2026-09-10T14:00:00.000Z";

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

const item: UnsortedItem = {
  id: "1788949866.296519",
  kind: "slack",
  summary: "Sam O said the asset entity on each subtask row should be editable.",
  text: "the asset entity on each subtask row should be editable",
  source: { type: "slack", ref: "1788949866.296519", url: "https://alden-studios.slack.com/archives/C07/p1788949866296519" },
  candidates: [],
  needs: "read",
  at: "2026-09-10T09:00:00Z",
};

const work: Work = {
  feature: "admin/usage",
  keys: { tickets: [], prs: [], threads: [], vocab: [] },
  open_questions: [],
  events: [],
  updated: "2026-09-09T04:00:00Z",
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "marauder-apply-"));
  roots.push(root);
  const feature = join(root, APP, "features", "admin/usage");
  await mkdir(join(feature, "docs"), { recursive: true });
  await Bun.write(join(feature, "docs", "product.md"), "# Usage\n");
  await Bun.write(join(feature, "work.json"), serializeWork(work));
  await Bun.write(join(root, "queue", "_unsorted.json"), JSON.stringify([item], null, 2) + "\n");
  await Bun.write(
    join(root, "decisions", "marauder", "1788962409-1.json"),
    JSON.stringify({ action: "attach", id: item.id, feature: "admin/usage", at: "2026-09-10T13:00:00.000Z", by: "Liam Leung" }),
  );
  return root;
}

async function run(root: string, ...extra: string[]) {
  const p = Bun.spawn(["bun", SCRIPT, "apply", "--root", root, "--now", NOW, ...extra], { stdout: "pipe", stderr: "pipe" });
  const [code, err] = [await p.exited, await new Response(p.stderr).text()];
  return { code, err, last: err.trim().split("\n").at(-1)! };
}

const unsorted = async (root: string) => (await Bun.file(join(root, "queue", "_unsorted.json")).json()) as UnsortedItem[];

test("one unapplied decision: the entry leaves the queue, the record and the board are written, the file stays", async () => {
  const root = await fixture();
  const r = await run(root);
  expect(r.code).toBe(0);
  expect(r.last).toMatch(/^marauder: 1 decided · \d+ files written$/);
  expect(await unsorted(root)).toEqual([]);
  const record = (await Bun.file(join(root, APP, "features", "admin/usage", "work.json")).json()) as Work;
  expect(record.events.length).toBe(1);
  expect(await exists(join(root, "marauder", "board.md"))).toBe(true);
  expect(await exists(join(root, "decisions", "marauder", "1788962409-1.json"))).toBe(true);
  expect(await exists(join(root, "queue", ".lock"))).toBe(false);
});

test("run again, nothing to apply: no byte written, one line, exit zero", async () => {
  const root = await fixture();
  await run(root);
  const board = join(root, "marauder", "board.md");
  const before = (await stat(board)).mtimeMs;
  const r = await run(root);
  expect(r.code).toBe(0);
  expect(r.last).toBe("marauder: nothing to apply");
  expect((await stat(board)).mtimeMs).toBe(before);
});

test("--dry-run says what it would do and writes nothing", async () => {
  const root = await fixture();
  const r = await run(root, "--dry-run");
  expect(r.code).toBe(0);
  expect(r.last).toContain("(dry run)");
  expect((await unsorted(root)).length).toBe(1);
  expect(await exists(join(root, "marauder", "board.md"))).toBe(false);
});

test("two runs at once serialise: one applies, the other finds nothing left, both exit zero", async () => {
  const root = await fixture();
  const [a, b] = await Promise.all([run(root), run(root)]);
  expect([a.code, b.code]).toEqual([0, 0]);
  expect([a.last, b.last].filter((l) => l === "marauder: nothing to apply").length).toBe(1);
  const record = (await Bun.file(join(root, APP, "features", "admin/usage", "work.json")).json()) as Work;
  expect(record.events.length).toBe(1);
});

test("a read verb never waits on the lock", async () => {
  const root = await fixture();
  await mkdir(join(root, "queue", ".lock"));
  await Bun.write(join(root, "queue", ".lock", "holder"), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const t = Date.now();
  const p = Bun.spawn(["bun", SCRIPT, "board", "--root", root, "--now", NOW, "--dry-run"], { stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).toBe(0);
  expect(Date.now() - t).toBeLessThan(5_000);
});
