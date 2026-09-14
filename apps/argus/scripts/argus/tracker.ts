/**
 * `argus tracker show|list` (CTD-200): a ticket, or the open ones, from whichever
 * provider owns them — Linear for `CTD`/`ALD`, Trello for `AP` — through the tickets
 * package's router (`@citadel/tickets`). Read-only, so a skill or Ask can ask about a
 * ticket without knowing which provider holds it, in place of the Linear MCP tools
 * (which cannot reach Trello).
 */

import { getTicket, listOpenTickets, type ListOpenOptions, type Ticket, type TicketRouterOptions } from "@citadel/tickets";

/** one ticket, from the provider its key names; refused, rather than left null, since a caller asking for one specific ticket has nothing else to show */
export async function trackerShow(key: string, opts: TicketRouterOptions = {}): Promise<Ticket> {
  const t = await getTicket(key, opts);
  if (!t) throw new Error(`${key}: not found`);
  return t;
}

/** the open tickets, across providers or narrowed to the one `--team` names */
export async function trackerList(opts: ListOpenOptions & TicketRouterOptions = {}): Promise<Ticket[]> {
  return listOpenTickets(opts);
}
