/**
 * A ticket key names its own provider: the letters before the dash are a Linear team key or
 * a Trello board's own scheme, and the table below is the only place that mapping lives.
 * Moved from argus's `linear.ts` (CTD-198), unchanged — `splitKey` doesn't care which
 * provider ends up owning the team it finds.
 */

/** `ALD-45` → `["ALD", 45]`; null for anything that is not a ticket key */
export function splitKey(key: string): [team: string, number: number] | null {
  const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
  return m ? [m[1]!, Number(m[2])] : null;
}

/** the provider each team key routes to; `AP` joins this for Trello in ticket 2 */
const PROVIDER_BY_TEAM: Record<string, string> = {
  ALD: "linear",
  CTD: "linear",
};

/** the provider that owns a key, or null when it is not a ticket key or no provider claims its team */
export function providerNameFor(key: string): string | null {
  const split = splitKey(key);
  return split ? (PROVIDER_BY_TEAM[split[0]] ?? null) : null;
}
