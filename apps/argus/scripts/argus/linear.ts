/**
 * What Linear says about a ticket. `reconcile` asks once per run for every ticket the
 * ledgers still hold open, and a Done or Canceled answer settles the ticket and the asks it
 * serves; anything else is "open" and nothing moves. One GraphQL query per team, by issue
 * number, so a run costs as many calls as there are team keys among the open tickets.
 *
 * Auth: LINEAR_API_KEY from the environment, the same key Pensieve files with, read here and
 * nowhere else in argus. Without it every answer is `unknown` and reconcile leaves tickets to
 * the landings, exactly as a landing waits when Bitbucket cannot be asked. Read-only: argus
 * never writes Linear.
 */

export const LINEAR_API_URL = "https://api.linear.app/graphql";

export type TicketState =
  | { state: "done"; at: string; name: string; url: string }
  | { state: "canceled"; at: string; name: string; url: string }
  | { state: "open"; name: string; url: string }
  | { state: "unknown" };

export type TicketStates = (key: string) => TicketState;

const QUERY = `query TicketStates($team: String!, $numbers: [Float!]!) {
  issues(filter: { team: { key: { eq: $team } }, number: { in: $numbers } }, first: 250) {
    nodes { identifier url completedAt canceledAt state { name type } }
  }
}`;

type Node = { identifier: string; url: string; completedAt?: string | null; canceledAt?: string | null; state?: { name?: string; type?: string } };

/** `ALD-45` → `["ALD", 45]`; null for anything that is not a ticket key */
export function splitKey(key: string): [team: string, number: number] | null {
  const m = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(key);
  return m ? [m[1]!, Number(m[2])] : null;
}

/** one node → its state; the state's `type` is Linear's own, since a workspace may rename a column */
export function stateOf(n: Node, now: Date): TicketState {
  const name = n.state?.name ?? "";
  const type = n.state?.type ?? "";
  if (type === "completed") return { state: "done", at: n.completedAt ?? now.toISOString(), name, url: n.url };
  if (type === "canceled") return { state: "canceled", at: n.canceledAt ?? now.toISOString(), name, url: n.url };
  return { state: "open", name, url: n.url };
}

/**
 * The state of every key, asked of Linear once per team. Keys Linear does not list, keys
 * that are not ticket keys, and every key when there is no credential answer `unknown`.
 * A failed request answers `unknown` for that team and is reported on stderr, never thrown:
 * reconcile still has the landings.
 */
export async function ticketStates(
  keys: string[],
  opts: { fetch?: typeof fetch; apiKey?: string | null; now?: Date } = {},
): Promise<TicketStates> {
  const apiKey = opts.apiKey === undefined ? (process.env.LINEAR_API_KEY?.trim() || null) : opts.apiKey;
  const now = opts.now ?? new Date();
  const found = new Map<string, TicketState>();
  if (!apiKey || keys.length === 0) return (k) => found.get(k) ?? { state: "unknown" };
  const byTeam = new Map<string, number[]>();
  for (const k of keys) {
    const s = splitKey(k);
    if (s) byTeam.set(s[0], [...(byTeam.get(s[0]) ?? []), s[1]]);
  }
  const f = opts.fetch ?? fetch;
  for (const [team, numbers] of byTeam) {
    try {
      const res = await f(LINEAR_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query: QUERY, variables: { team, numbers } }),
      });
      if (!res.ok) throw new Error(`linear: ${res.status}`);
      const body = (await res.json()) as { data?: { issues?: { nodes: Node[] } }; errors?: { message: string }[] };
      if (body.errors?.length) throw new Error(`linear: ${body.errors.map((e) => e.message).join("; ")}`);
      for (const n of body.data?.issues?.nodes ?? []) found.set(n.identifier, stateOf(n, now));
    } catch (e) {
      console.error(`linear: could not read ${team} tickets — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return (k) => found.get(k) ?? { state: "unknown" };
}
