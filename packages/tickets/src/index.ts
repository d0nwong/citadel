/**
 * The tickets package (CTD-198, CTD-199): one provider interface for a ticket, routed by
 * the key's prefix. `ticketStates` and `getTicket` are the router — ask once per provider,
 * merge the answers, write nothing. `linearProvider` and `trelloProvider`, each with its two
 * standalone reads, are the adapters; `CTD` and `ALD` route to Linear, `AP` to Trello.
 */

export { providerNameFor, splitKey } from "./key.ts";
export { LINEAR_API_URL, linearGet, linearProvider, linearTicketStates, stateOf } from "./linear.ts";
export type { LinearOptions } from "./linear.ts";
export type {
  Assignee,
  CreateTicketInput,
  LinkInput,
  ListOpenOptions,
  Stage,
  Ticket,
  TicketProvider,
  TicketState,
  TicketStates,
  UpdateTicketInput,
} from "./provider.ts";
export { providerLabel } from "./provider.ts";
export { getTicket, ticketStates } from "./router.ts";
export type { TicketRouterOptions } from "./router.ts";
export { cardNumber, cardState, TRELLO_API_URL, TRELLO_BOARD_ID, TRELLO_LISTS, trelloGet, trelloProvider, trelloTicketStates } from "./trello.ts";
export type { TrelloOptions } from "./trello.ts";
