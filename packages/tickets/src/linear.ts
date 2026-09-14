/**
 * The Linear adapter (CTD-198, CTD-201). `states` batches keys by team and answers
 * `TicketState`, each one carrying the ticket's assignee (`assignee { id }` in the same
 * query, for ticket 13 to read); `get` answers one ticket by its identifier, with its
 * parent's key when it has one; `listOpen` answers the team's (or, unscoped, the
 * workspace's) open issues, filtered for `--mine`/`--unassigned` against the same query's
 * `viewer { id }` (CTD-200). One GraphQL query per team for `states`, so a run costs as
 * many calls as there are team keys among the tickets asked for. This is argus's old
 * `linear.ts`, moved: the logic is unchanged, so `ticketStates` for `ALD` and `CTD` keys
 * settles exactly as before (spec S-15).
 *
 * `create` (CTD-201) generalises Pensieve's `createIssue`/`createProject`
 * (`apps/pensieve/src/server/linear.ts`) with `parentId` and `blockedBy` relations: one
 * context query for the team's id, states, projects and the viewer, a `projectCreate` when
 * `project` names one the team does not have, one `issueCreate`, then one
 * `issueRelationCreate` per blocker (the blocker `blocks` the new issue). `update` is the
 * same context query scoped to the key's own team, then one `issueUpdate` carrying only the
 * fields given — a `state` name resolves against the team's own workflow states, as
 * `linearClaim`'s started-state lookup already does; blockers are added, never removed.
 *
 * Auth: `LINEAR_API_KEY` from the environment, read fresh per call so a key set after the
 * process started still counts. Without it `states` answers `unknown` for every key — a
 * caller with a batch to read still has its other facts — and every other verb throws
 * `MissingCredentialError`, since a caller asking for one ticket, or writing one, has
 * nothing to fall back to. `claim` (CTD-204, moved from Foundry's `linear-link.ts`
 * unchanged) is assign + move to the team's started state, in one lookup and one mutation.
 * `link` (CTD-205, also moved from `linear-link.ts` unchanged) resolves the issue's uuid
 * then attaches the PR as a URL attachment with `attachmentLinkURL` — the same call Foundry's
 * host used to make directly, now reached through the package like every other write.
 */

import { MissingCredentialError } from "./errors.ts";
import { splitKey } from "./key.ts";
import type { CreateTicketInput, LinkInput, ListOpenOptions, Ticket, TicketProvider, TicketState, TicketStates, UpdateTicketInput } from "./provider.ts";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

const STATES_QUERY = `query TicketStates($team: String!, $numbers: [Float!]!) {
  issues(filter: { team: { key: { eq: $team } }, number: { in: $numbers } }, first: 250) {
    nodes { identifier url completedAt canceledAt state { name type } assignee { id } }
  }
}`;

const GET_QUERY = `query TicketGet($id: String!) {
  issue(id: $id) { identifier url title description completedAt canceledAt state { name type } assignee { id } parent { identifier } }
}`;

const OPEN_QUERY = `query TicketsOpen($filter: IssueFilter) {
  viewer { id }
  issues(filter: $filter, first: 250, orderBy: updatedAt) {
    nodes { identifier url title description state { name type } assignee { id } parent { identifier } }
  }
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

/** one authenticated POST, unwrapped to its `data` — every write shares this, the way `linearClaim`'s did before it moved here. */
async function linearPost<T>(query: string, variables: Record<string, unknown>, apiKey: string, f: typeof fetch): Promise<T> {
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
}

/** one node → its state; the state's `type` is Linear's own, since a workspace may rename a column */
export function stateOf(n: Node, now: Date): TicketState {
  const name = n.state?.name ?? "";
  const type = n.state?.type ?? "";
  const assignee = n.assignee ? { id: n.assignee.id } : undefined;
  if (type === "completed") return { state: "done", at: n.completedAt ?? now.toISOString(), name, url: n.url, provider: "linear", assignee };
  if (type === "canceled") return { state: "canceled", at: n.canceledAt ?? now.toISOString(), name, url: n.url, provider: "linear", assignee };
  return { state: "open", name, url: n.url, provider: "linear", assignee };
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

/**
 * The team's (or, with no `--team`, the workspace's) open issues as `Ticket`s (CTD-200) —
 * `openIssues` in `apps/pensieve/src/server/linear.ts`, generalised with assignee and the
 * viewer's own id, read in the same query so `--mine` and `--unassigned` are filtered
 * client-side rather than costing a second round trip. Throws, naming `LINEAR_API_KEY`,
 * when there is no credential — a caller asking for the open list has nothing else to
 * show.
 */
export async function linearListOpen(opts: LinearOptions & ListOpenOptions = {}): Promise<Ticket[]> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? fetch;
  const filter: Record<string, unknown> = { state: { type: { nin: ["completed", "canceled"] } } };
  if (opts.team) filter.team = { key: { eq: opts.team } };
  const res = await f(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query: OPEN_QUERY, variables: { filter } }),
  });
  if (!res.ok) throw new Error(`linear: ${res.status}`);
  const body = (await res.json()) as { data?: { viewer?: { id: string }; issues?: { nodes: IssueNode[] } }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`linear: ${body.errors.map((e) => e.message).join("; ")}`);
  const viewerId = body.data?.viewer?.id;
  const nodes = body.data?.issues?.nodes ?? [];
  return nodes
    .filter((n) => !opts.unassigned || !n.assignee)
    .filter((n) => !opts.mine || n.assignee?.id === viewerId)
    .map((issue) => ({
      key: issue.identifier,
      title: issue.title,
      url: issue.url,
      description: issue.description ?? "",
      state: stateOf(issue, now),
      ...(issue.parent ? { parentKey: issue.parent.identifier } : {}),
    }));
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
  const context = await linearPost<{
    viewer: { id: string };
    issue: { id: string; team: { states: { nodes: Array<{ id: string; name: string; type: string }> } } } | null;
  }>(VIEWER_AND_STATES_QUERY, { id: key }, apiKey, f);
  if (!context.issue) throw new Error(`linear: no such issue ${key}`);
  const stateId = startedStateId(context.issue.team.states.nodes);
  const done = await linearPost<{ issueUpdate: { success: boolean } }>(CLAIM_MUTATION, { id: context.issue.id, assigneeId: assigneeId ?? context.viewer.id, stateId }, apiKey, f);
  if (!done.issueUpdate.success) throw new Error("linear: issueUpdate declined");
}

type TeamState = { id: string; name: string; type: string };
type TeamProject = { id: string; name: string };

const TEAM_CONTEXT_QUERY = `query TicketTeamContext($team: String!) {
  viewer { id }
  teams(filter: { key: { eq: $team } }, first: 1) {
    nodes { id states { nodes { id name type } } projects(first: 250) { nodes { id name } } }
  }
}`;

/** the team's id, states and projects, plus the viewer — what `create` and `update` both resolve `project`, `state` and `"me"` against */
async function teamContext(team: string, apiKey: string, f: typeof fetch): Promise<{ viewerId: string; teamId: string; states: TeamState[]; projects: TeamProject[] }> {
  const data = await linearPost<{ viewer: { id: string }; teams: { nodes: Array<{ id: string; states: { nodes: TeamState[] }; projects: { nodes: TeamProject[] } }> } }>(TEAM_CONTEXT_QUERY, { team }, apiKey, f);
  const node = data.teams.nodes[0];
  if (!node) throw new Error(`linear: no such team ${team}`);
  return { viewerId: data.viewer.id, teamId: node.id, states: node.states.nodes, projects: node.projects.nodes };
}

const PROJECT_CREATE_MUTATION = `mutation TicketProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) { success project { id name } }
}`;

/** the named project's id, case-insensitively; created on the team when nothing by that name exists yet, as `argus file`'s Linear path does today */
async function projectId(name: string, ctx: { teamId: string; projects: TeamProject[] }, apiKey: string, f: typeof fetch): Promise<string> {
  const existing = ctx.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const created = await linearPost<{ projectCreate: { success: boolean; project: TeamProject | null } }>(PROJECT_CREATE_MUTATION, { input: { name, teamIds: [ctx.teamId] } }, apiKey, f);
  if (!created.projectCreate.success || !created.projectCreate.project) throw new Error("linear: projectCreate declined");
  return created.projectCreate.project.id;
}

/** the named workflow state's id, case-insensitively; an unknown name is refused, listing what the team has */
function stateId(name: string, states: TeamState[]): string {
  const found = states.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`linear: no state named "${name}" — the team has ${states.map((s) => s.name).join(", ")}`);
  return found.id;
}

const TICKET_IDS_QUERY = `query TicketIds($team: String!, $numbers: [Float!]!) {
  issues(filter: { team: { key: { eq: $team } }, number: { in: $numbers } }, first: 250) {
    nodes { id identifier }
  }
}`;

/** every key's uuid, batched by team like `linearTicketStates`; a key Linear does not have is thrown by name, so a parent or blocker is never silently dropped */
async function idsForKeys(keys: string[], apiKey: string, f: typeof fetch): Promise<Map<string, string>> {
  const byTeam = new Map<string, number[]>();
  for (const k of keys) {
    const s = splitKey(k);
    if (s) byTeam.set(s[0], [...(byTeam.get(s[0]) ?? []), s[1]]);
  }
  const found = new Map<string, string>();
  for (const [team, numbers] of byTeam) {
    const data = await linearPost<{ issues: { nodes: Array<{ id: string; identifier: string }> } }>(TICKET_IDS_QUERY, { team, numbers }, apiKey, f);
    for (const n of data.issues.nodes) found.set(n.identifier, n.id);
  }
  for (const k of keys) if (!found.has(k)) throw new Error(`linear: no such issue ${k}`);
  return found;
}

/** `"me"` → the viewer, `undefined`/`null` → left off (create) or cleared (update), anything else passed through as Linear's own user id */
const resolveAssignee = (assigneeId: string | null | undefined, viewerId: string): string | null | undefined => (assigneeId === "me" ? viewerId : assigneeId);

const ISSUE_CREATE_MUTATION = `mutation TicketCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url title description completedAt canceledAt state { name type } assignee { id } parent { identifier } } }
}`;

const ISSUE_UPDATE_MUTATION = `mutation TicketUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { id identifier url title description completedAt canceledAt state { name type } assignee { id } parent { identifier } } }
}`;

/** the blocker `blocks` the new/updated issue — the direction that reads as "blocked by" on the ticket this adds relations to */
const RELATION_CREATE_MUTATION = `mutation TicketBlockedBy($issueId: String!, $relatedIssueId: String!) {
  issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: blocks }) { success }
}`;

const toTicket = (issue: IssueNode, now: Date): Ticket => ({
  key: issue.identifier,
  title: issue.title,
  url: issue.url,
  description: issue.description ?? "",
  state: stateOf(issue, now),
  ...(issue.parent ? { parentKey: issue.parent.identifier } : {}),
});

/** every blocker relation the new/updated issue needs, one mutation each — additive, never removing one a caller did not name */
async function addBlockers(issueId: string, blockedBy: string[] | undefined, apiKey: string, f: typeof fetch): Promise<void> {
  if (!blockedBy?.length) return;
  const ids = await idsForKeys(blockedBy, apiKey, f);
  for (const blockerKey of blockedBy) {
    const done = await linearPost<{ issueRelationCreate: { success: boolean } }>(RELATION_CREATE_MUTATION, { issueId: ids.get(blockerKey), relatedIssueId: issueId }, apiKey, f);
    if (!done.issueRelationCreate.success) throw new Error(`linear: could not record ${blockerKey} as a blocker`);
  }
}

/**
 * One issue, with a project created on the team when `project` names one it does not have,
 * `parentId` resolved from `input.parent`, and one blocker relation per `input.blockedBy`
 * (CTD-201 AC3). Throws `MissingCredentialError` with no key, and by name on an unknown
 * team, project-create failure, or a parent/blocker key Linear does not have.
 */
export async function linearCreate(input: CreateTicketInput, opts: LinearOptions = {}): Promise<Ticket> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new MissingCredentialError("LINEAR_API_KEY");
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? fetch;
  const ctx = await teamContext(input.team, apiKey, f);
  const [projectIdValue, parentAndBlockerIds] = await Promise.all([
    input.project ? projectId(input.project, ctx, apiKey, f) : Promise.resolve(undefined),
    idsForKeys([...(input.parent ? [input.parent] : []), ...(input.blockedBy ?? [])], apiKey, f),
  ]);
  const assigneeId = resolveAssignee(input.assigneeId, ctx.viewerId);
  const created = await linearPost<{ issueCreate: { success: boolean; issue: (IssueNode & { id: string }) | null } }>(
    ISSUE_CREATE_MUTATION,
    {
      input: {
        title: input.title,
        description: input.description,
        teamId: ctx.teamId,
        ...(projectIdValue ? { projectId: projectIdValue } : {}),
        ...(input.parent ? { parentId: parentAndBlockerIds.get(input.parent) } : {}),
        ...(assigneeId ? { assigneeId } : {}),
      },
    },
    apiKey,
    f,
  );
  if (!created.issueCreate.success || !created.issueCreate.issue) throw new Error("linear: issueCreate declined");
  const issue = created.issueCreate.issue;
  await addBlockers(issue.id, input.blockedBy, apiKey, f);
  return toTicket(issue, now);
}

/**
 * One `issueUpdate` carrying only the fields given — `project`/`state` resolved against the
 * key's own team, `assigneeId: null` clears the assignee, a blocker is added (never
 * removed). AC2's title, description, label/project, assignee, parent and state move all
 * go through this one mutation. Throws `MissingCredentialError` with no key, and by name on
 * an unknown state, project-create failure, or a parent/blocker key Linear does not have.
 */
export async function linearUpdate(key: string, input: UpdateTicketInput, opts: LinearOptions = {}): Promise<Ticket> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new MissingCredentialError("LINEAR_API_KEY");
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? fetch;
  const split = splitKey(key);
  if (!split) throw new Error(`linear: ${key} is not a ticket key`);
  const ctx = await teamContext(split[0], apiKey, f);
  const [ids, projectIdValue] = await Promise.all([
    idsForKeys([key, ...(input.parent ? [input.parent] : [])], apiKey, f),
    input.project ? projectId(input.project, ctx, apiKey, f) : Promise.resolve(undefined),
  ]);
  const assigneeId = resolveAssignee(input.assigneeId, ctx.viewerId);
  const updated = await linearPost<{ issueUpdate: { success: boolean; issue: IssueNode | null } }>(
    ISSUE_UPDATE_MUTATION,
    {
      id: ids.get(key),
      input: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(projectIdValue ? { projectId: projectIdValue } : {}),
        ...(input.parent ? { parentId: ids.get(input.parent) } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId } : {}),
        ...(input.state !== undefined ? { stateId: stateId(input.state, ctx.states) } : {}),
      },
    },
    apiKey,
    f,
  );
  if (!updated.issueUpdate.success || !updated.issueUpdate.issue) throw new Error("linear: issueUpdate declined");
  const issue = updated.issueUpdate.issue;
  await addBlockers(ids.get(key)!, input.blockedBy, apiKey, f);
  return toTicket(issue, now);
}

const ISSUE_UUID_QUERY = `query TicketUuid($id: String!) { issue(id: $id) { id } }`;

/** the issue's uuid, from the human identifier; `null` when Linear has no such issue — either a null result or a "not found" GraphQL error, the same answer worded differently */
async function issueUuid(key: string, apiKey: string, f: typeof fetch): Promise<string | null> {
  try {
    const data = await linearPost<{ issue: { id: string } | null }>(ISSUE_UUID_QUERY, { id: key }, apiKey, f);
    return data.issue?.id ?? null;
  } catch (e) {
    if (/not found/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

const ATTACHMENT_LINK_MUTATION = `mutation TicketLink($issueId: String!, $url: String!, $title: String!) {
  attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success }
}`;

/**
 * Resolves the issue's uuid, then `attachmentLinkURL` (CTD-205 AC2) — attachments are keyed
 * on the url, so re-linking the same PR is a no-op and a fresh PR's url adds a second link
 * rather than replacing the first. Throws `MissingCredentialError` with no key, by name on an
 * unknown issue, and on a declined mutation.
 */
export async function linearLink(key: string, input: LinkInput, opts: LinearOptions = {}): Promise<void> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new MissingCredentialError("LINEAR_API_KEY");
  const f = opts.fetch ?? fetch;
  const issueId = await issueUuid(key, apiKey, f);
  if (!issueId) throw new Error(`linear: no such issue ${key}`);
  const done = await linearPost<{ attachmentLinkURL: { success: boolean } }>(ATTACHMENT_LINK_MUTATION, { issueId, url: input.url, title: input.title ?? key }, apiKey, f);
  if (!done.attachmentLinkURL.success) throw new Error("linear: attachmentLinkURL declined");
}

/** the Linear adapter as a `TicketProvider`; every verb is implemented (CTD-198, CTD-200, CTD-201, CTD-204, CTD-205) */
export function linearProvider(opts: LinearOptions = {}): TicketProvider {
  return {
    name: "linear",
    get: (key) => linearGet(key, opts),
    states: (keys) => linearTicketStates(keys, opts),
    listOpen: (listOpts) => linearListOpen({ ...opts, ...listOpts }),
    create: (input) => linearCreate(input, opts),
    update: (key, input) => linearUpdate(key, input, opts),
    claim: (key, assigneeId) => linearClaim(key, assigneeId, opts),
    link: (key, input) => linearLink(key, input, opts),
  };
}
