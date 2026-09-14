/**
 * `argus tracker show|list|create|edit` (CTD-200, CTD-201): a ticket, or the open ones,
 * from whichever provider owns them — Linear for `CTD`/`ALD`, Trello for `AP` — through
 * the tickets package's router (`@citadel/tickets`), so a skill or Ask can read or write a
 * ticket without knowing which provider holds it, in place of the Linear MCP tools (which
 * cannot reach Trello).
 *
 * `create` and `edit` shape the CLI's flags into `CreateTicketInput`/`UpdateTicketInput`
 * and route through `createTicket`/`updateTicket`: `--team` picks the provider on create,
 * the key does on edit; `--assignee` is `"me"`, `"none"` (explicitly unassigned) or the
 * provider's own id; `--parent` and each `--blocked-by` key is checked as a ticket key
 * before anything is written, so a typo is refused rather than silently dropped. `edit`
 * with no field given is refused — there is nothing for the provider to write.
 */

import { createTicket, getTicket, listOpenTickets, splitKey, updateTicket, type CreateTicketInput, type ListOpenOptions, type Ticket, type TicketRouterOptions, type UpdateTicketInput } from "@citadel/tickets";

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

/** `"none"` clears the assignee, `"me"` and any other id pass through to the provider as given */
const assigneeIdFor = (assignee: string): string | null => (assignee === "none" ? null : assignee);

/** refuses a parent or blocker that is not shaped like a ticket key, by name, before anything is written */
function checkTicketKey(key: string, label: string): void {
  if (!splitKey(key)) throw new Error(`${label} "${key}" is not a ticket key`);
}

export type TrackerCreateOpts = { title: string; body?: string; team: string; project?: string; assignee?: string; parent?: string; blockedBy?: string[] };

/** `argus tracker create` (CTD-201 AC1, AC3): files on the provider `--team` names, printing the key and url */
export async function trackerCreate(opts: TrackerCreateOpts, routerOpts: TicketRouterOptions = {}): Promise<Ticket> {
  if (opts.parent) checkTicketKey(opts.parent, "--parent");
  for (const b of opts.blockedBy ?? []) checkTicketKey(b, "--blocked-by");
  const input: CreateTicketInput = {
    title: opts.title,
    description: opts.body ?? "",
    team: opts.team.toUpperCase(),
    ...(opts.project ? { project: opts.project } : {}),
    ...(opts.assignee !== undefined ? { assigneeId: assigneeIdFor(opts.assignee) } : {}),
    ...(opts.parent ? { parent: opts.parent } : {}),
    ...(opts.blockedBy?.length ? { blockedBy: opts.blockedBy } : {}),
  };
  return createTicket(input, routerOpts);
}

export type TrackerEditOpts = { title?: string; body?: string; project?: string; assignee?: string; parent?: string; state?: string; blockedBy?: string[] };

/** `argus tracker edit <KEY>` (CTD-201 AC2): changes only the fields given, on the key's own provider — `state` is an `AP` card's list; refused when nothing was given to change */
export async function trackerEdit(key: string, opts: TrackerEditOpts, routerOpts: TicketRouterOptions = {}): Promise<Ticket> {
  if (opts.parent) checkTicketKey(opts.parent, "--parent");
  for (const b of opts.blockedBy ?? []) checkTicketKey(b, "--blocked-by");
  const input: UpdateTicketInput = {
    ...(opts.title !== undefined ? { title: opts.title } : {}),
    ...(opts.body !== undefined ? { description: opts.body } : {}),
    ...(opts.project !== undefined ? { project: opts.project } : {}),
    ...(opts.assignee !== undefined ? { assigneeId: assigneeIdFor(opts.assignee) } : {}),
    ...(opts.parent ? { parent: opts.parent } : {}),
    ...(opts.state !== undefined ? { state: opts.state } : {}),
    ...(opts.blockedBy?.length ? { blockedBy: opts.blockedBy } : {}),
  };
  if (Object.keys(input).length === 0) throw new Error(`${key}: nothing to change`);
  return updateTicket(key, input, routerOpts);
}
