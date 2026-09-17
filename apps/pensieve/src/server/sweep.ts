/**
 * The sweep as the top bar sees it: the status file and the tick log the stack's sweep loop
 * (argus `infra/sweep/loop.sh`) writes beside its lock in the data repo's `.git`. Nothing
 * here writes; a workspace the loop never ran on has neither file, and reads as `null`.
 */

import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WORKSPACE_DIR } from "./workspace";

export interface SweepStatus {
  lastExit?: number;
  lastRunAt?: string;
  nextRunAt?: string;
  running: boolean;
  startedAt?: string;
}

/** A tick longer than this is a loop that died without clearing the flag, not a run. */
const STALE_MS = 3 * 60 * 60 * 1000;
/** The log's tail the page shows; a tick's stream-json runs to megabytes. */
const LOG_TAIL_BYTES = 512 * 1024;

const statusPath = () => join(WORKSPACE_DIR, ".git", "sweep-status.json");
const logPath = () => join(WORKSPACE_DIR, ".git", "sweep.log");

export async function readSweepStatus(): Promise<SweepStatus | null> {
  let raw: Partial<SweepStatus>;
  try {
    raw = JSON.parse(await readFile(statusPath(), "utf8"));
  } catch {
    return null;
  }
  const started = raw.startedAt ? Date.parse(raw.startedAt) : Number.NaN;
  const running =
    raw.running === true &&
    !(Number.isFinite(started) && Date.now() - started > STALE_MS);
  return { ...raw, running };
}

/** The last `LOG_TAIL_BYTES` of the tick log, starting at a whole line. */
export async function readSweepLog(): Promise<{
  text: string;
  truncated: boolean;
} | null> {
  let fh: Awaited<ReturnType<typeof open>>;
  try {
    fh = await open(logPath(), "r");
  } catch {
    return null;
  }
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) {
      text = text.slice(text.indexOf("\n") + 1);
    }
    return { text, truncated: start > 0 };
  } finally {
    await fh.close();
  }
}
