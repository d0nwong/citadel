/**
 * The Ask feature's public API (feature-sliced: `model/` holds the state and the bound
 * hook, `components/` the widgets, `lib/` the pure helpers). Routes import from here only.
 */
export { useAppChat, useChatContext } from './model/chat-hook'
export { AskStatusProvider } from './model/ask-context'
export type { AskContextValue } from './model/ask-context'
export { newThreadId } from './lib/thread-id'
