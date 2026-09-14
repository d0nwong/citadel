/**
 * Node-only. Where the host meets the tickets package (CTD-204): the one place a Foundry
 * credential is handed to the router's `getTicket`/`claimTicket`. `job-api.ts` (the trigger
 * API's fetch-then-claim) and `task-context.ts` (linked-ticket hydration) both take this
 * shape — `job-runner.ts` passes it to `hydrateTask` too — so ticket 8's Trello path is one
 * more key read here, not a second call site in either of them.
 */
import type { Ticket } from '@citadel/tickets'
import { claimTicket, getTicket } from '@citadel/tickets'
import { linearApiKey } from './linear-link'

/** What a caller needs from a ticket, read through whichever provider its key names. */
export interface HostTickets {
  get(key: string): Promise<Ticket | null>
  claim(key: string, assigneeId?: string): Promise<void>
}

export const hostTickets: HostTickets = {
  get: async (key) => getTicket(key, { apiKey: (await linearApiKey()) ?? null }),
  claim: async (key, assigneeId) => claimTicket(key, assigneeId, { apiKey: (await linearApiKey()) ?? null }),
}
