/**
 * The tickets package (CTD-198, CTD-199, CTD-200): one provider interface for a ticket,
 * routed by the key's prefix. `ticketStates`, `getTicket` and `listOpenTickets` are the
 * router's reads — ask once per provider, merge the answers, write nothing. `claimTicket` is
 * its one write, routed the same way. `linearProvider` and `trelloProvider`, each with its
 * standalone reads, are the adapters; `CTD` and `ALD` route to Linear, `AP` to Trello.
 * Foundry's job pipeline reads and claims through this package (CTD-204).
 */

export { MissingCredentialError } from "./errors.ts";
export { providerNameFor, providerNameForTeam, splitKey } from "./key.ts";
export { LINEAR_API_URL, linearClaim, linearGet, linearListOpen, linearProvider, linearTicketStates, stateOf } from "./linear.ts";
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
export { claimTicket, getTicket, listOpenTickets, ticketStates } from "./router.ts";
export type { TicketRouterOptions } from "./router.ts";
export {
  cardNumber,
  cardState,
  TRELLO_API_URL,
  TRELLO_BOARD_ID,
  TRELLO_BOARD_NAME,
  TRELLO_LISTS,
  TRELLO_PIPELINE_LIST,
  trelloGet,
  trelloListOpen,
  trelloProvider,
  trelloTicketStates,
  trelloViewerId,
} from "./trello.ts";
export type { TrelloOptions } from "./trello.ts";
