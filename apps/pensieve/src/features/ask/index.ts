/**
 * The Ask feature's public API (feature-sliced: `model/` holds the state and the bound
 * hook, `components/` the widgets, `lib/` the pure helpers). Routes import from here only.
 */

// biome-ignore lint/performance/noBarrelFile: this is the feature's public API, the one import path routes use
export { newThreadId } from "./lib/thread-id";
export type { AskContextValue } from "./model/ask-context";
export { AskStatusProvider } from "./model/ask-context";
export { useAppChat, useChatContext } from "./model/chat-hook";
