/**
 * The chat's transport and options, bound once (LIA-103). `createChatHook` takes these
 * together with the widgets; the widgets need the options' type and the scoped contexts,
 * so both live here rather than beside the `createChatHook` call, which imports the widgets.
 *
 * Transport: the hook holds the full transcript (the stored turns from the route loader
 * plus whatever was said since) and the fetcher sends all of it every turn — the server's
 * "full transcript, or none of it" rule; `[]` would only work once the new question was
 * already on disk, and it never is. Hydration is `initialMessages`: a fetcher-based
 * connection has no `hydrate`, so `persistence: true` here means "keyed by threadId,
 * nothing cached in the browser" and no more.
 */

import type { StreamChunk } from "@tanstack/ai";
import type { ChatFetcher } from "@tanstack/ai-react";
import { createChatHookContexts } from "@tanstack/ai-react/ui";
import { askChat } from "#/lib/api";
import { finishReasonOf, noteFinish } from "./finish-reason";

/**
 * `threadId` is the hook's own (the per-call override), so nothing here closes over state.
 * `data` is the merged body — what the page put in `useAppChat({ body })` — which is how the
 * point a conversation was opened on reaches the server's first run (LIA-109) — and the
 * arc, on the same path (LIA-149).
 */
const fetcher: ChatFetcher = ({ messages, threadId, data }, { signal }) => {
  const point = data?.point;
  const arc = data?.arc;
  return askChat({
    data: {
      messages,
      threadId,
      ...(typeof point === "string" ? { point } : {}),
      ...(typeof arc === "string" ? { arc } : {}),
    },
    signal,
  });
};

export const options = {
  devtools: { name: "Ask argus" },
  fetcher,
  onChunk: (chunk: StreamChunk) => {
    if (chunk.type === "RUN_STARTED" && chunk.threadId) {
      noteFinish(chunk.threadId, undefined);
    }
    if (chunk.type === "RUN_FINISHED" && chunk.threadId) {
      noteFinish(chunk.threadId, finishReasonOf(chunk));
    }
  },
  persistence: true as const,
};
export type Opts = typeof options;

/**
 * Widgets read the chat through these scoped contexts rather than the `useChatContext`
 * that `createChatHook` returns — the documented way around the module-level circularity
 * (the widgets are arguments to the call that defines that hook).
 */
export const contexts = createChatHookContexts();
export const useChat = contexts.useChatContext;
