/** A new conversation's id: what `useChat` would mint itself, and what the server's thread-id rule accepts. */
export const newThreadId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
