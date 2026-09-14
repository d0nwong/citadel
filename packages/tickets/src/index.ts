/**
 * The tickets package (CTD-198, CTD-199, CTD-200, CTD-201): one provider interface for a
 * ticket, routed by the key's prefix. `ticketStates`, `getTicket` and `listOpenTickets` are
 * the router's reads — ask once per provider, merge the answers, write nothing.
 * `createTicket` (routed by team) and `updateTicket`/`claimTicket` (routed by key) are its
 * writes. `linearProvider` and `trelloProvider`, each with its standalone reads and writes,
 * are the adapters; `CTD` and `ALD` route to Linear, `AP` to Trello. Foundry's job pipeline
 * reads and claims through this package (CTD-204); `argus tracker create`/`edit` create and
 * update through it (CTD-201).
 */

export { MissingCredentialError } from "./errors.ts";
export { providerNameFor, providerNameForTeam, splitKey } from "./key.ts";
export { LINEAR_API_URL, linearClaim, linearCreate, linearGet, linearListOpen, linearProvider, linearTicketStates, linearUpdate, stateOf } from "./linear.ts";
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
export { claimTicket, createTicket, getTicket, listOpenTickets, ticketStates, updateTicket } from "./router.ts";
export type { TicketRouterOptions } from "./router.ts";
export {
  cardNumber,
  cardState,
  TRELLO_API_URL,
  TRELLO_BOARD_ID,
  TRELLO_BOARD_NAME,
  TRELLO_CHECKLIST_NAME,
  TRELLO_LISTS,
  TRELLO_PIPELINE_LIST,
  trelloCreate,
  trelloGet,
  trelloListOpen,
  trelloProvider,
  trelloTicketStates,
  trelloUpdate,
  trelloViewerId,
} from "./trello.ts";
export type { TrelloOptions } from "./trello.ts";
