/**
 * Node-only. Where the host meets the tickets package (CTD-204, CTD-205): the one place a
 * Foundry credential is handed to the router's `getTicket`/`claimTicket`/`linkTicket`.
 * `job-api.ts` (the trigger API's fetch-then-claim) and `task-context.ts` (linked-ticket
 * hydration) both take this shape — `job-runner.ts` passes it to `hydrateTask` and to
 * `linkPrToTicket` too — so Trello's credentials (CTD-205's AP path) are read fresh from
 * citadel's `.env` once here, not scattered across call sites.
 */
import type { LinkInput, Ticket } from '@citadel/tickets'
import { claimTicket, getTicket, linkTicket } from '@citadel/tickets'
import { readFoundryEnv } from './foundry-env'

/** What a caller needs from a ticket, read through whichever provider its key names. */
export interface HostTickets {
  get(key: string): Promise<Ticket | null>
  claim(key: string, assigneeId?: string): Promise<void>
  link(key: string, input: LinkInput): Promise<void>
}

/** `LINEAR_API_KEY`, `TRELLO_API_KEY` and `TRELLO_TOKEN`, read fresh from citadel's `.env` on every call (spec S-31). */
async function ticketCredentials() {
  const cred = await readFoundryEnv()
  return { apiKey: cred.LINEAR_API_KEY ?? null, trelloKey: cred.TRELLO_API_KEY ?? null, trelloToken: cred.TRELLO_TOKEN ?? null }
}

export const hostTickets: HostTickets = {
  get: async (key) => getTicket(key, await ticketCredentials()),
  claim: async (key, assigneeId) => claimTicket(key, assigneeId, await ticketCredentials()),
  link: async (key, input) => linkTicket(key, input, await ticketCredentials()),
}
