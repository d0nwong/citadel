/**
 * What the page knows and the widgets need but the hook does not carry: whether a
 * credential is available (AC4), which thread is on screen, a draft for the composer, and
 * how the stored conversation's last run ended. The route wraps `<chat.AppChat />` in the
 * provider; the widgets read it (they take no props of their own).
 */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { AskStatus, LastError } from '#/server/ask'

export interface AskContextValue {
  status: AskStatus
  /** The conversation on screen — the hook does not expose its own thread id. */
  threadId?: string
  /** Text to start the composer with — a question arriving from a point that could not be sent. */
  draft?: string
  /** How the stored conversation's last run ended (the file's `metadata`), for a page opened after it. */
  finishReason?: 'length'
  lastError?: LastError
}

const AskContext = createContext<AskContextValue>({ status: { available: true, authMode: 'host', claudePath: null, probe: { loggedIn: null } } })

export function AskStatusProvider({ children, ...value }: AskContextValue & { children: ReactNode }) {
  return <AskContext.Provider value={value}>{children}</AskContext.Provider>
}

export const useAskContext = () => useContext(AskContext)
