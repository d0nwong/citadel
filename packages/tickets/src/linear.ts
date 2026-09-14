/**
 * The Linear adapter (CTD-198). `states` batches keys by team and answers `TicketState`,
 * each one carrying the ticket's assignee (`assignee { id }` in the same query, for ticket
 * 13 to read); `get` answers one ticket by its identifier, with its parent's key when it has
 * one. One GraphQL query per team for `states`, so a run costs as many calls as there are
 * team keys among the tickets asked for. This is argus's old `linear.ts`, moved: the logic
 * is unchanged, so `ticketStates` for `ALD` and `CTD` keys settles exactly as before
 * (spec S-15). The other five verbs on `TicketProvider` are ticket 4's to write.
 *
 * Auth: `LINEAR_API_KEY` from the environment, read fresh per call so a key set after the
 * process started still counts. Without it `states` answers `unknown` for every key — a
 * caller with a batch to read still has its other facts — and `get` throws, naming the
 * variable, since a caller asking for one ticket has nothing to fall back to. Read-only:
 * nothing here writes Linear.
 */

import { splitKey } from "./key.ts";
import type { Ticket, TicketProvider, TicketState, TicketStates } from "./provider.ts";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

const STATES_QUERY = `query TicketStates($team: String!, $numbers: [Float!]!) {
  issues(filter: { team: { key: { eq: $team } }, number: { in: $numbers } }, first: 250) {
    nodes { identifier url completedAt canceledAt state { name type } assignee { id } }
  }
}`;

const GET_QUERY = `query TicketGet($id: String!) {
  issue(id: $id) { identifier url title description completedAt canceledAt state { name type } assignee { id } parent { identifier } }
}`;

type Node = {
  identifier: string;
  url: string;
  completedAt?: string | null;
  canceledAt?: string | null;
  state?: { name?: string; type?: string };
  assignee?: { id: string } | null;
};

type IssueNode = Node & { title: string; description?: string | null; parent?: { identifier: string } | null };

export type LinearOptions = { fetch?: typeof fetch; apiKey?: string | null; now?: Date };

const keyOf = (opts: LinearOptions) => (opts.apiKey === undefined ? process.env.LINEAR_API_KEY?.trim() || null : opts.apiKey);

/** one node → its state; the state's `type` is Linear's own, since a workspace may rename a column */
export function stateOf(n: Node, now: Date): TicketState {
  const name = n.state?.name ?? "";
  const type = n.state?.type ?? "";
  const assignee = n.assignee ? { id: n.assignee.id } : undefined;
  if (type === "completed") return { state: "done", at: n.completedAt ?? now.toISOString(), name, url: n.url, assignee };
  if (type === "canceled") return { state: "canceled", at: n.canceledAt ?? now.toISOString(), name, url: n.url, assignee };
  return { state: "open", name, url: n.url, assignee };
}

/**
 * The state of every key, asked of Linear once per team. Keys Linear does not list, keys
 * that are not ticket keys, and every key when there is no credential answer `unknown`.
 * A failed request answers `unknown` for that team and is reported on stderr, never thrown:
 * the caller still has its other facts.
 */
export async function linearTicketStates(keys: string[], opts: LinearOptions = {}): Promise<TicketStates> {
  const apiKey = keyOf(opts);
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
        body: JSON.stringify({ query: STATES_QUERY, variables: { team, numbers } }),
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

/**
 * One ticket, from Linear's `issue(id:)`, which takes the human identifier as well as the
 * uuid. `null` when Linear has no such issue; throws, naming `LINEAR_API_KEY`, when there is
 * no credential to ask with, and on a failed request or a GraphQL error — a caller asking
 * for one specific ticket has nothing else to show.
 */
export async function linearGet(key: string, opts: LinearOptions = {}): Promise<Ticket | null> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? fetch;
  const res = await f(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query: GET_QUERY, variables: { id: key } }),
  });
  if (!res.ok) throw new Error(`linear: ${res.status}`);
  const body = (await res.json()) as { data?: { issue?: IssueNode | null }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`linear: ${body.errors.map((e) => e.message).join("; ")}`);
  const issue = body.data?.issue;
  if (!issue) return null;
  return {
    key: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description ?? "",
    state: stateOf(issue, now),
    ...(issue.parent ? { parentKey: issue.parent.identifier } : {}),
  };
}

const notImplemented = (verb: string): never => {
  throw new Error(`tickets: Linear's "${verb}" is not implemented yet`);
};

/** the Linear adapter as a `TicketProvider`; only `get` and `states` are implemented (CTD-198) */
export function linearProvider(opts: LinearOptions = {}): TicketProvider {
  return {
    name: "linear",
    get: (key) => linearGet(key, opts),
    states: (keys) => linearTicketStates(keys, opts),
    listOpen: () => notImplemented("listOpen"),
    create: () => notImplemented("create"),
    update: () => notImplemented("update"),
    claim: () => notImplemented("claim"),
    link: () => notImplemented("link"),
  };
}
