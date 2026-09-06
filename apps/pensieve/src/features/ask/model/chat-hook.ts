/**
 * The Ask chat, bound once (LIA-103): `createChatHook` from `@tanstack/ai-react/ui` with
 * the shadcn.io/ai blocks (LIA-101) as its widgets and `askChat` (LIA-102) as its
 * transport. The route calls `useAppChat({ threadId, initialMessages })` and renders
 * `<chat.AppChat />`. This is the one file that imports every widget; the widgets read the
 * chat through `contexts` in `chat-options`, never through what is returned here.
 */
import { createChatHook } from '@tanstack/ai-react/ui'
import { contexts, options } from './chat-options'
import { AskLayout } from '../components/layout'
import { AskMessage } from '../components/message'
import { AskInput } from '../components/input'
import { AskQueue } from '../components/queue'
import { FallbackPart, OrphanResultPart, TextPart, ThinkingPart } from '../components/parts'
import { toolsComponents } from '../components/tool-call'

export const { useAppChat, useChatContext } = createChatHook({
  options,
  context: contexts,
  components: { layout: AskLayout, message: AskMessage, input: AskInput, queue: AskQueue },
  partsComponents: { text: TextPart, thinking: ThinkingPart, toolResult: OrphanResultPart, fallback: FallbackPart },
  toolsComponents,
})
