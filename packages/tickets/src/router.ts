/**
 * The provider router (CTD-198): the key's prefix picks the provider (`key.ts`), each
 * provider is asked once per run for only the keys it owns, and the answers are merged into
 * one lookup. A key no provider owns, a provider this run has none registered for, or a
 * provider whose read throws all leave that ticket `unknown` — the other provider's tickets
 * still settle, and this never writes anything (spec S-7).
 */

import { providerNameFor } from "./key.ts";
import { linearProvider, type LinearOptions } from "./linear.ts";
import type { Ticket, TicketProvider, TicketState, TicketStates } from "./provider.ts";
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
  for (const [name, owned] of groupByProvider(keys, routeKey)) {
    const provider = providers[name];
    if (!provider) continue;
    try {
      const states = await provider.states(owned);
      for (const key of owned) found.set(key, states(key));
    } catch (e) {
      console.error(`tickets: could not read ${name} tickets — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
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
