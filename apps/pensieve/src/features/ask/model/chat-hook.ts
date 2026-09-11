/**
 * The Ask chat, bound once (LIA-103): `createChatHook` from `@tanstack/ai-react/ui` with
 * the shadcn.io/ai blocks (LIA-101) as its widgets and `askChat` (LIA-102) as its
 * transport. The route calls `useAppChat({ threadId, initialMessages })` and renders
 * `<chat.AppChat />`. This is the one file that imports every widget; the widgets read the
 * chat through `contexts` in `chat-options`, never through what is returned here.
 */
import { createChatHook } from "@tanstack/ai-react/ui";
import { AskInput } from "../components/input";
import { AskLayout } from "../components/layout";
import { AskMessage } from "../components/message";
import {
  FallbackPart,
  OrphanResultPart,
  TextPart,
  ThinkingPart,
} from "../components/parts";
import { AskQueue } from "../components/queue";
import { toolsComponents } from "../components/tool-call";
import { contexts, options } from "./chat-options";

export const { useAppChat, useChatContext } = createChatHook({
  components: {
    input: AskInput,
    layout: AskLayout,
    message: AskMessage,
    queue: AskQueue,
  },
  context: contexts,
  options,
  partsComponents: {
    fallback: FallbackPart,
    text: TextPart,
    thinking: ThinkingPart,
    toolResult: OrphanResultPart,
  },
  toolsComponents,
});
