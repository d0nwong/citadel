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
 * caller with a batch to read still has its other facts — and `get`/`claim` throw
 * `MissingCredentialError`, since a caller asking for one ticket has nothing to fall back
 * to. `claim` (CTD-204, moved from Foundry's `linear-link.ts` unchanged) is the only write:
 * assign + move to the team's started state, in one lookup and one mutation.
 */

import { MissingCredentialError } from "./errors.ts";
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
 * uuid. `null` when Linear has no such issue — either a null result or, on some lookups, a
 * "not found" GraphQL error, which is the same answer worded differently. Throws
 * `MissingCredentialError` when there is no credential to ask with, and on a failed request
 * or any other GraphQL error — a caller asking for one specific ticket has nothing else to
 * show.
 */
export async function linearGet(key: string, opts: LinearOptions = {}): Promise<Ticket | null> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new MissingCredentialError("LINEAR_API_KEY");
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? fetch;
  const res = await f(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query: GET_QUERY, variables: { id: key } }),
  });
  if (!res.ok) throw new Error(`linear: ${res.status}`);
  const body = (await res.json()) as { data?: { issue?: IssueNode | null }; errors?: { message: string }[] };
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message).join("; ");
    if (/not found/i.test(message)) return null;
    throw new Error(`linear: ${message}`);
  }
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

const VIEWER_AND_STATES_QUERY = `query ClaimContext($id: String!) {
  viewer { id }
  issue(id: $id) { id team { states { nodes { id name type } } } }
}`;

const CLAIM_MUTATION = `mutation Claim($id: String!, $assigneeId: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { assigneeId: $assigneeId, stateId: $stateId }) { success }
}`;

/** The team's started-type state, preferring one named "In Progress" when it has several. */
function startedStateId(states: Array<{ id: string; name: string; type: string }>): string {
  const started = states.find((s) => s.type === "started" && s.name.toLowerCase() === "in progress") ?? states.find((s) => s.type === "started");
  if (!started) throw new Error("team has no started-type state to move the ticket into");
  return started.id;
}

/**
 * Assign + move to the team's started state — one lookup query (the viewer's id and the
 * team's states) and one `issueUpdate`. `assigneeId` omitted assigns the credential's own
 * user, which is what a Foundry claim means. Idempotent — re-applying it is a no-op on
 * Linear's side. Throws `MissingCredentialError` with no credential, and on an unknown
 * issue or a declined update.
 */
export async function linearClaim(key: string, assigneeId?: string, opts: LinearOptions = {}): Promise<void> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new MissingCredentialError("LINEAR_API_KEY");
  const f = opts.fetch ?? fetch;
  const post = async <T>(query: string, variables: Record<string, string>): Promise<T> => {
    const res = await f(LINEAR_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`linear: ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`linear: ${body.errors.map((e) => e.message).join("; ")}`);
    if (!body.data) throw new Error("linear: no data in response");
    return body.data;
  };
  const context = await post<{
    viewer: { id: string };
    issue: { id: string; team: { states: { nodes: Array<{ id: string; name: string; type: string }> } } } | null;
  }>(VIEWER_AND_STATES_QUERY, { id: key });
  if (!context.issue) throw new Error(`linear: no such issue ${key}`);
  const stateId = startedStateId(context.issue.team.states.nodes);
  const done = await post<{ issueUpdate: { success: boolean } }>(CLAIM_MUTATION, {
    id: context.issue.id,
    assigneeId: assigneeId ?? context.viewer.id,
    stateId,
  });
  if (!done.issueUpdate.success) throw new Error("linear: issueUpdate declined");
}

const notImplemented = (verb: string): never => {
  throw new Error(`tickets: Linear's "${verb}" is not implemented yet`);
};

/** the Linear adapter as a `TicketProvider`; `get`, `states` and `claim` are implemented (CTD-198, CTD-204) */
export function linearProvider(opts: LinearOptions = {}): TicketProvider {
  return {
    name: "linear",
    get: (key) => linearGet(key, opts),
    states: (keys) => linearTicketStates(keys, opts),
    listOpen: () => notImplemented("listOpen"),
    create: () => notImplemented("create"),
    update: () => notImplemented("update"),
    claim: (key, assigneeId) => linearClaim(key, assigneeId, opts),
    link: () => notImplemented("link"),
  };
}
