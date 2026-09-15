/**
 * The provider router (CTD-198): the key's prefix picks the provider (`key.ts`), each
 * provider is asked once per run for only the keys it owns, and the answers are merged into
 * one lookup. A key no provider owns, a provider this run has none registered for, or a
 * provider whose read throws all leave that ticket `unknown` — the other provider's tickets
 * still settle, and reads never write anything (spec S-7). `listOpenTickets` (CTD-200) does
 * the same for the open-ticket list, routed by a bare team key instead of a ticket key.
 * `createTicket` (CTD-201) routes the same way, by `input.team`; `updateTicket` and
 * `linkTicket` (CTD-205) route by the key, like `claimTicket` — a write has no meaningful
 * "unknown" to fall back to, so any of the three throws naming what it could not route.
 */

import { providerNameFor, providerNameForTeam } from "./key.ts";
import { linearProvider, type LinearOptions } from "./linear.ts";
import type { CreateTicketInput, LinkInput, ListOpenOptions, Ticket, TicketProvider, TicketState, TicketStates, UpdateTicketInput } from "./provider.ts";
import { trelloProvider, type TrelloOptions } from "./trello.ts";

export type TicketRouterOptions = LinearOptions &
  TrelloOptions & {
    /** override the provider registry — tests inject fakes here instead of a real Linear or Trello */
    providers?: Record<string, TicketProvider>;
    /** override the prefix → provider map — tests only; production always uses `providerNameFor` */
    routeKey?: (key: string) => string | null;
  };

const providersFor = (opts: TicketRouterOptions): Record<string, TicketProvider> =>
  opts.providers ?? { linear: linearProvider(opts), trello: trelloProvider(opts) };

const groupByProvider = (keys: string[], routeKey: (key: string) => string | null): Map<string, string[]> => {
  const byProvider = new Map<string, string[]>();
  for (const key of keys) {
    const name = routeKey(key);
    if (name) byProvider.set(name, [...(byProvider.get(name) ?? []), key]);
  }
  return byProvider;
};

/**
 * The state of every key, asked of each key's provider once per run (spec S-7). Keys are
 * grouped by the provider their prefix names, each provider is called with only its own
 * keys, and the merged lookup answers `unknown` for anything left over.
 */
export async function ticketStates(keys: string[], opts: TicketRouterOptions = {}): Promise<TicketStates> {
  const providers = providersFor(opts);
  const routeKey = opts.routeKey ?? providerNameFor;
  const found = new Map<string, TicketState>();
  await Promise.all(
    Array.from(groupByProvider(keys, routeKey)).map(async ([name, owned]) => {
      const provider = providers[name];
      if (!provider) return;
      try {
        const states = await provider.states(owned);
        for (const key of owned) found.set(key, states(key));
      } catch (e) {
        console.error(`tickets: could not read ${name} tickets — ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );
  return (key) => found.get(key) ?? { state: "unknown" };
}

/** one ticket, from the provider its key names; `null` when no provider owns the key */
export async function getTicket(key: string, opts: TicketRouterOptions = {}): Promise<Ticket | null> {
  const name = (opts.routeKey ?? providerNameFor)(key);
  if (!name) return null;
  const provider = providersFor(opts)[name];
  if (!provider) return null;
  return provider.get(key);
}

/**
 * The open tickets (CTD-200): with `opts.team` set, asks only the one provider that team
 * names — like `getTicket`, a single-provider request, so a missing credential or an
 * unknown team propagates as a throw rather than an empty list. With no team, asks every
 * registered provider and merges what came back; a provider that throws (no credential, a
 * failed request) is logged and skipped, the same graceful-degrade `ticketStates` gives a
 * batch of keys (spec S-7) — the point of not scoping to one team is to see everything
 * that is actually reachable, not to demand every provider be configured.
 */
export async function listOpenTickets(opts: TicketRouterOptions & ListOpenOptions = {}): Promise<Ticket[]> {
  const providers = providersFor(opts);
  if (opts.team) {
    const name = providerNameForTeam(opts.team);
    if (!name) throw new Error(`${opts.team}: not a known team`);
    const provider = providers[name];
    if (!provider) throw new Error(`${opts.team}: no ${name} provider registered`);
    return provider.listOpen(opts);
  }
  const out: Ticket[] = [];
  await Promise.all(
    Object.entries(providers).map(async ([name, provider]) => {
      try {
        out.push(...(await provider.listOpen(opts)));
      } catch (e) {
        console.error(`tickets: could not list ${name} tickets — ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );
  return out;
}

/**
 * Claims one ticket on the provider its key names. A write has no meaningful "unknown" to
 * fall back to, so a key no provider owns, or a provider this run has none registered for,
 * throws naming the key.
 */
export async function claimTicket(key: string, assigneeId?: string, opts: TicketRouterOptions = {}): Promise<void> {
  const name = (opts.routeKey ?? providerNameFor)(key);
  const provider = name ? providersFor(opts)[name] : undefined;
  if (!provider) throw new Error(`tickets: no provider owns ${key}`);
  await provider.claim(key, assigneeId);
}

/**
 * Creates one ticket on the provider `input.team` names (CTD-201 AC1). A team no provider
 * owns, or a provider this run has none registered for, throws naming the team.
 */
export async function createTicket(input: CreateTicketInput, opts: TicketRouterOptions = {}): Promise<Ticket> {
  const name = providerNameForTeam(input.team);
  const provider = name ? providersFor(opts)[name] : undefined;
  if (!provider) throw new Error(`tickets: no provider owns team ${input.team}`);
  return provider.create(input);
}

/**
 * Updates one ticket on the provider its key names (CTD-201 AC2). As `claimTicket`, a key
 * no provider owns, or a provider this run has none registered for, throws naming the key.
 */
export async function updateTicket(key: string, input: UpdateTicketInput, opts: TicketRouterOptions = {}): Promise<Ticket> {
  const name = (opts.routeKey ?? providerNameFor)(key);
  const provider = name ? providersFor(opts)[name] : undefined;
  if (!provider) throw new Error(`tickets: no provider owns ${key}`);
  return provider.update(key, input);
}

/**
 * Links a PR (or other) input onto one ticket, on the provider its key names (CTD-205 AC2).
 * As `claimTicket`, a key no provider owns, or a provider this run has none registered for,
 * throws naming the key.
 */
export async function linkTicket(key: string, input: LinkInput, opts: TicketRouterOptions = {}): Promise<void> {
  const name = (opts.routeKey ?? providerNameFor)(key);
  const provider = name ? providersFor(opts)[name] : undefined;
  if (!provider) throw new Error(`tickets: no provider owns ${key}`);
  await provider.link(key, input);
}
