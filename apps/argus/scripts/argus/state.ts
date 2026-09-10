/**
 * The global state beside the ledgers, under `state/`: the thread map (thread root → the
 * feature a person or the sweep placed it on; the only learned state, committed) and the
 * unplaced list (what neither the joins nor the sweep could attribute; Pensieve's list, a
 * click empties it). The Slack cursor and the batches are `pull.ts`'s.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { threadsPath, unplacedPath } from "./paths.ts";

/** thread root ts → feature, with who placed it and when */
export type ThreadMap = Record<string, { feature: string; by: "user" | "sweep"; at: string }>;

export type UnplacedKind = "message" | "landing";

/** one thing nobody could place; `id` is the Slack ts for a message, `<repo>#<n>` for a landing */
export type Unplaced = {
  id: string;
  kind: UnplacedKind;
  /** the thread root, when the message is a reply */
  thread?: string;
  by: string;
  at: string;
  text: string;
  url: string;
  /** what the joins and the sweep considered, for the reader */
  candidates: string[];
  batch: string;
};

async function readJson<T>(path: string, empty: T): Promise<T> {
  const f = Bun.file(path);
  return (await f.exists()) ? ((await f.json()) as T) : empty;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2) + "\n");
}

export const readThreads = () => readJson<ThreadMap>(threadsPath(), {});
export const writeThreads = (m: ThreadMap) => writeJson(threadsPath(), m);
export const readUnplaced = () => readJson<Unplaced[]>(unplacedPath(), []);
export const writeUnplaced = (u: Unplaced[]) => writeJson(unplacedPath(), u);
