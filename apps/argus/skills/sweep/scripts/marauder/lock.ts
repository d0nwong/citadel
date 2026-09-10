/**
 * lock.ts — one writer at a time over the record (ARG-168).
 *
 * Every writing `marauder` verb loads the whole record, changes it and writes it back, so a
 * click in Pensieve and a tick of the sweep running at once could lose a write. The lock is
 * a directory beside the Slack cursor: `mkdir` either makes it or throws `EEXIST`, on every
 * filesystem Bun runs on, and a `holder` file inside says who took it and when.
 *
 * A run that cannot take it within ten seconds gives up naming the holder. A lock older than
 * five minutes whose pid is gone is a crash's leftover, and is taken over with a note.
 */

import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_DIR } from "./record.ts";

export const LOCK_DIR = ".lock";

export type Holder = { pid: number; at: string };

export type LockOptions = {
  /** how long to wait for a holder that is alive (ms) */
  timeout?: number;
  /** how often to try again (ms) */
  every?: number;
  /** how old a lock whose pid is gone must be before it is taken over (ms) */
  stale?: number;
  /** where a take-over is said */
  note?: (line: string) => void;
  /** the clock, for tests */
  now?: () => number;
};

export const lockPath = (root: string) => join(root, QUEUE_DIR, LOCK_DIR);

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM is a process that exists and belongs to someone else
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const readHolder = (dir: string): Holder | null => {
  try {
    return JSON.parse(readFileSync(join(dir, "holder"), "utf8")) as Holder;
  } catch {
    return null;
  }
};

/**
 * Take the lock, waiting for a live holder up to `timeout`. Returns the function that gives
 * it back; calling that more than once is harmless.
 */
export async function acquire(root: string, opts: LockOptions = {}): Promise<() => void> {
  const { timeout = 10_000, every = 200, stale = 5 * 60_000, note = (l) => console.error(l), now = Date.now } = opts;
  const dir = lockPath(root);
  mkdirSync(join(dir, ".."), { recursive: true });
  const start = now();
  for (;;) {
    try {
      mkdirSync(dir);
      const holder: Holder = { pid: process.pid, at: new Date(now()).toISOString() };
      writeFileSync(join(dir, "holder"), JSON.stringify(holder));
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        rmSync(dir, { recursive: true, force: true });
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const holder = readHolder(dir);
    // a holder file not yet written is a run between its mkdir and its write — wait for it
    if (holder && now() - Date.parse(holder.at) > stale && !alive(holder.pid)) {
      note(`marauder: took over the lock pid ${holder.pid} left at ${holder.at}; that run is gone`);
      rmSync(dir, { recursive: true, force: true });
      continue;
    }
    if (now() - start >= timeout)
      throw new Error(
        holder
          ? `another marauder run holds the lock — pid ${holder.pid}, since ${holder.at}`
          : `another marauder run holds the lock, and has not said who it is`,
      );
    await Bun.sleep(every);
  }
}

/** run `fn` holding the lock, and give it back however `fn` ends */
export async function withLock<T>(root: string, fn: () => Promise<T> | T, opts?: LockOptions): Promise<T> {
  const release = await acquire(root, opts);
  try {
    return await fn();
  } finally {
    release();
  }
}
