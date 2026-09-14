/**
 * The tickets package (CTD-198): one provider interface for a ticket, routed by the key's
 * prefix. `ticketStates` and `getTicket` are the router — ask once per provider, merge the
 * answers, write nothing. `linearProvider` and its two standalone reads are the Linear
 * adapter; `CTD` and `ALD` route to it today, `AP` joins for Trello in ticket 2.
 */

export { providerNameFor, splitKey } from "./key.ts";
export { LINEAR_API_URL, linearGet, linearProvider, linearTicketStates, stateOf } from "./linear.ts";
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
export { getTicket, ticketStates } from "./router.ts";
export type { TicketRouterOptions } from "./router.ts";
