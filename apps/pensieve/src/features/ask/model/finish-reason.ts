/**
 * How the last run ended, per thread. `RUN_FINISHED` carries a `finishReason` (top-level
 * on the adapter's chunk, under `metadata.tanstack` on the engine's own); the hook keeps
 * nothing of it. When the reason is `length` the claude CLI hit the adapter's `maxTurns`
 * and the answer stops mid-thought, which deserves a line under it. Kept in a module-level
 * store read with `useSyncExternalStore`, because the chat options are bound once at module
 * scope and cannot close over component state.
 */

import type { StreamChunk } from "@tanstack/ai";
import { useSyncExternalStore } from "react";

const finishReasons = new Map<string, string | undefined>();
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Record a run's end (or its start, as `undefined`): a run happened here, and whatever the file said before is superseded. */
export const noteFinish = (threadId: string, reason: string | undefined) => {
  finishReasons.set(threadId, reason);
  for (const l of listeners) {
    l();
  }
};

/** The reason on a RUN_FINISHED chunk, whichever shape it came in. */
export const finishReasonOf = (chunk: StreamChunk): string | undefined => {
  if (chunk.type !== "RUN_FINISHED") {
    return undefined;
  }
  const top = (chunk as { finishReason?: string | null }).finishReason;
  const meta = (
    chunk as { metadata?: { tanstack?: { finishReason?: string | null } } }
  ).metadata?.tanstack?.finishReason;
  return top ?? meta ?? undefined;
};

/** This session's finish for the thread; before any run here, what the stored conversation says. */
export const useFinishReason = (
  threadId: string | undefined,
  stored: string | undefined
) =>
  useSyncExternalStore(
    subscribe,
    () =>
      threadId && finishReasons.has(threadId)
        ? finishReasons.get(threadId)
        : stored,
    () => stored
  );

/** Has a run started on this page for the thread? (Then the stored error no longer stands.) */
export const useRanHere = (threadId: string | undefined) =>
  useSyncExternalStore(
    subscribe,
    () => (threadId ? finishReasons.has(threadId) : false),
    () => false
  );
