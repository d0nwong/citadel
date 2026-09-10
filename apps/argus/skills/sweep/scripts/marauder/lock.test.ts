/**
 * lock.ts — one writer at a time (ARG-168 AC3–AC5).
 *
 *   bun test skills/sweep/scripts/marauder/lock.test.ts
 */

import { test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, exists } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire, lockPath, withLock } from "./lock.ts";

const roots: string[] = [];
const fresh = async () => {
  const r = await mkdtemp(join(tmpdir(), "marauder-lock-"));
  roots.push(r);
  return r;
};
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true });
});

test("two holders serialise: the second runs after the first has finished", async () => {
  const root = await fresh();
  const order: string[] = [];
  const first = withLock(root, async () => {
    order.push("first in");
    await Bun.sleep(150);
    order.push("first out");
  });
  await Bun.sleep(10);
  const second = withLock(root, () => void order.push("second"), { every: 20 });
  await Promise.all([first, second]);
  expect(order).toEqual(["first in", "first out", "second"]);
  expect(await exists(lockPath(root))).toBe(false);
});

test("a live holder that does not let go: the wait ends naming its pid and when it took the lock", async () => {
  const root = await fresh();
  const release = await acquire(root);
  await expect(acquire(root, { timeout: 100, every: 20 })).rejects.toThrow(new RegExp(`pid ${process.pid}, since \\d{4}-`));
  release();
});

test("an old lock whose pid is gone is taken over with a note, not waited on", async () => {
  const root = await fresh();
  await mkdir(lockPath(root), { recursive: true });
  await Bun.write(join(lockPath(root), "holder"), JSON.stringify({ pid: 999_999_9, at: "2026-09-10T00:00:00.000Z" }));
  const notes: string[] = [];
  const release = await acquire(root, { timeout: 0, note: (l) => notes.push(l) });
  expect(notes).toEqual([expect.stringContaining("took over the lock pid 9999999")]);
  release();
});

test("a recent lock whose pid is gone is still waited on", async () => {
  const root = await fresh();
  await mkdir(lockPath(root), { recursive: true });
  await Bun.write(join(lockPath(root), "holder"), JSON.stringify({ pid: 999_999_9, at: new Date().toISOString() }));
  await expect(acquire(root, { timeout: 50, every: 10 })).rejects.toThrow(/pid 9999999/);
});

test("a throw inside the locked run gives the lock back", async () => {
  const root = await fresh();
  await expect(withLock(root, () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await exists(lockPath(root))).toBe(false);
});
