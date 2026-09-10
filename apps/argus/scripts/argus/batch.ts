/**
 * A batch is what one `argus pull` brought in: the Slack pull since the cursor and the
 * landings on both base branches since each ledger's newest, in one file under
 * `state/batches/`, named by the moment it was pulled. `place` reads a batch and writes
 * the placed file beside it; the sweep reads the placed file; nothing rewrites a batch.
 */

import { join } from "node:path";
import { batchesDir } from "./paths.ts";
import type { Landing } from "./pr-facts.ts";
import type { Msg, Pull } from "./slack-pull.ts";

export type Batch = {
  id: string;
  pulled_at: string;
  since: { slack: string | null; fe: string | null; be: string | null };
  slack: Pull | null;
  landings: Landing[];
};

/** one feature's share of a batch */
export type Slice = { feature: string; messages: Msg[]; landings: Landing[] };

export type Placed = {
  batch: string;
  placed_at: string;
  slices: Slice[];
  /** ids of what went to state/unplaced.json */
  unplaced: string[];
};

export const batchId = (d: Date) => d.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
export const batchPath = (id: string, dir = batchesDir()) => join(dir, `${id}.json`);
export const placedPath = (id: string, dir = batchesDir()) => join(dir, `${id}.placed.json`);

export async function readBatch(idOrPath: string): Promise<Batch> {
  const path = idOrPath.endsWith(".json") ? idOrPath : batchPath(idOrPath);
  const f = Bun.file(path);
  if (!(await f.exists())) throw new Error(`no batch at ${path}`);
  return (await f.json()) as Batch;
}
