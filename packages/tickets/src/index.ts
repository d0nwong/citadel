/**
 * The tickets package (CTD-198): one provider interface for a ticket, routed by the key's
 * prefix. `ticketStates` and `getTicket` are the router's reads, which write nothing;
 * `claimTicket` is its one write, routed the same way. `linearProvider` and its standalone
 * `linearGet`/`linearClaim` are the Linear adapter; `CTD` and `ALD` route to it today, `AP`
 * joins for Trello in ticket 2. Foundry's job pipeline reads and claims through this
 * package (CTD-204).
 */

export { MissingCredentialError } from "./errors.ts";
export { providerNameFor, splitKey } from "./key.ts";
export { LINEAR_API_URL, linearClaim, linearGet, linearProvider, linearTicketStates, stateOf } from "./linear.ts";
export type { LinearOptions } from "./linear.ts";
export type {
  Assignee,
  CreateTicketInput,
  LinkInput,
  ListOpenOptions,
  Ticket,
  TicketProvider,
  TicketState,
  TicketStates,
  UpdateTicketInput,
} from "./provider.ts";
export { claimTicket, getTicket, ticketStates } from "./router.ts";
export type { TicketRouterOptions } from "./router.ts";
