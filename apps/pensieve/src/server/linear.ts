/**
 * Node-only. The Linear client — Pensieve's second outbound call, and the only one that
 * writes anywhere but the blackboard. Two operations of Linear's GraphQL API:
 *
 *   query    teams(key) { projects }, viewer { id }   → what `propose_ticket` validates against
 *   query    issues(team, state not done)             → what `propose_arc`'s ticket seeds are
 *   mutation issueCreate(input)                       → what File on the ticket card does
 *
 * The write is `createIssue` and nothing else: no labels (the `linear-ticket` skill's
 * "no labels at filing, ever"), no parent, no relations. One plain issue per call, which
 * is what LIA-113 files and all it files.
 *
 * Config: `LINEAR_API_KEY`, from the environment and nowhere else, exactly as
 * `FOUNDRY_API_TOKEN` is read (LIA-142) — `.env` fills it on a Mac, the compose file's
 * `environment:` in the container. Read per call, so a value set after this module was
 * pulled in still counts.
 *
 * The team's projects are cached under `PENSIEVE_HOME` because the check that a project is
 * the team's must survive the credential being absent: with no key there is no way to ask
 * Linear, and `propose_ticket` still has to refuse a project that is not Liamai's
 * (LIA-113 AC4 holds under AC5). The cache is refreshed on every successful fetch.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

/** The one team Pensieve files into. Everything else about the destination is the project. */
export const TEAM_KEY = "LIA";
export const TEAM_NAME = "Liamai";

/**
 * Where the last successful project list is kept, so AC4 survives a missing key.
 *
 * `PENSIEVE_HOME` is re-derived from the environment rather than imported from `ask.ts`:
 * that module reads the argus checkout and builds the adapter at load time, and the write
 * path has no business pulling it in. Resolved per call, like the key itself, so the
 * value belongs to whoever set the variable rather than to whoever imported this first.
 */
export const projectsCacheFile = (teamKey: string = TEAM_KEY) =>
  join(
    resolve(process.env.PENSIEVE_HOME || join(homedir(), ".pensieve")),
    teamKey === TEAM_KEY
      ? "linear-projects.json"
      : `linear-projects-${teamKey}.json`
  );

/** How long one request may take before it is a `LinearError(0)`. */
const TIMEOUT_MS = 20_000;

/** How long a fetched project list is reused within this process. */
const CACHE_TTL_MS = 5 * 60_000;

export interface LinearProject {
  id: string;
  name: string;
}

/** The team's projects and the ids a create needs, however they were come by. */
export interface ProjectLookup {
  projects: LinearProject[];
  /** `'live'` from Linear, `'cache'` from the file, `'none'` when neither could answer. */
  source: "live" | "cache" | "none";
  teamId?: string;
  /** Liam — every ticket this files is assigned to the key's owner. */
  viewerId?: string;
}

export interface LinearConfig {
  configured: boolean;
  /** Why File is unavailable, when it is. */
  reason?: string;
  team: string;
}

/** A non-2xx from Linear, or a GraphQL `errors[]`, with its first message. */
export class LinearError extends Error {
  status: number;
  constructor(status: number, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "LinearError";
    this.status = status;
  }
}

export const linearKey = (): string | undefined =>
  process.env.LINEAR_API_KEY?.trim() || undefined;

export function linearConfig(): LinearConfig {
  return linearKey()
    ? { configured: true, team: TEAM_NAME }
    : {
        configured: false,
        reason:
          "LINEAR_API_KEY is not set — it lives in argus's .env, which `bun run dev` and `bun run start` read it from (scripts/argus-env.sh); Pensieve's own .env also works (mint one at linear.app → Settings → Security & access → Personal API keys)",
        team: TEAM_NAME,
      };
}

export type Fetch = typeof fetch;

const firstErrorOf = (body: unknown): string | undefined => {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) {
    return;
  }
  const [first] = errors;
  const message = (first as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
};

/**
 * One GraphQL round trip. Linear answers 200 with an `errors` array for a query it
 * understood but could not run, so a failure is read off the body as well as the status.
 * A personal API key goes in `authorization` unprefixed — that is Linear's contract for
 * `lin_api_…` keys, unlike an OAuth token.
 */
async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: Fetch = fetch
): Promise<T> {
  const key = linearKey();
  if (!key) {
    throw new LinearError(
      503,
      linearConfig().reason ?? "LINEAR_API_KEY is not set"
    );
  }
  let res: Response;
  try {
    res = await fetchImpl(LINEAR_API_URL, {
      body: JSON.stringify({ query, variables }),
      headers: { authorization: key, "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const why =
      e instanceof Error && e.name === "TimeoutError"
        ? `no answer within ${TIMEOUT_MS / 1000}s`
        : e instanceof Error
          ? e.message
          : String(e);
    // biome-ignore lint/style/useErrorCause: the cause is in the third argument; the rule only knows Error's own shape
    throw new LinearError(0, `Linear unreachable — ${why}`, { cause: e });
  }
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { errors: [{ message: text.slice(0, 200) }] };
    }
  }
  const failed = firstErrorOf(body);
  if (failed) {
    throw new LinearError(res.status, `Linear refused it — ${failed}`);
  }
  if (!res.ok) {
    throw new LinearError(res.status, `Linear answered ${res.status}`);
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (!data) {
    throw new LinearError(res.status, "Linear answered without data");
  }
  return data as T;
}

// ── the team's projects ────────────────────────────────────────────────────────

const TEAM_PROJECTS_QUERY = `query TeamProjects($key: String!) {
  viewer { id }
  teams(filter: { key: { eq: $key } }, first: 1) {
    nodes { id name projects(first: 250) { nodes { id name } } }
  }
}`;

interface TeamProjectsData {
  teams: {
    nodes: {
      id: string;
      name: string;
      projects: { nodes: { id: string; name: string }[] };
    }[];
  };
  viewer: { id: string };
}

interface CacheFile {
  at: string;
  projects: LinearProject[];
  teamId: string;
  viewerId: string;
}

const parseCache = (text: string): CacheFile | null => {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const f = v as Partial<CacheFile> | null;
  if (!f || typeof f.teamId !== "string" || !Array.isArray(f.projects)) {
    return null;
  }
  const projects = f.projects.filter(
    (p): p is LinearProject =>
      typeof p?.id === "string" && typeof p?.name === "string"
  );
  return {
    at: typeof f.at === "string" ? f.at : "",
    projects,
    teamId: f.teamId,
    viewerId: typeof f.viewerId === "string" ? f.viewerId : "",
  };
};

async function readCache(
  teamKey: string = TEAM_KEY
): Promise<CacheFile | null> {
  try {
    return parseCache(await readFile(projectsCacheFile(teamKey), "utf8"));
  } catch {
    return null;
  }
}

/** Written whole through a temp file and a rename, as the conversation store is. */
async function writeCache(
  file: CacheFile,
  teamKey: string = TEAM_KEY
): Promise<void> {
  const target = projectsCacheFile(teamKey);
  await mkdir(dirname(target), { recursive: true });
  const tmp = join(
    dirname(target),
    `.linear-projects.${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch {
    await unlink(tmp).catch(() => undefined);
    // A cache that cannot be written is not a failed lookup — the live answer still stands.
  }
}

const memos = new Map<string, { at: number; lookup: ProjectLookup }>();

/** Drops the in-process memo. Tests call it; nothing else needs to. */
export const forgetProjects = () => {
  memos.clear();
};

/**
 * The team's projects, live when a key is available and from the cache when it is not.
 * Never throws: a lookup that cannot be made is `source: 'none'`, which the draft check
 * treats as "cannot verify this project" rather than as a refusal.
 */
export async function knownProjects(
  fetchImpl: Fetch = fetch,
  teamKey: string = TEAM_KEY
): Promise<ProjectLookup> {
  const memo = memos.get(teamKey);
  if (memo && Date.now() - memo.at < CACHE_TTL_MS) {
    return memo.lookup;
  }
  if (linearKey()) {
    try {
      const data = await graphql<TeamProjectsData>(
        TEAM_PROJECTS_QUERY,
        { key: teamKey },
        fetchImpl
      );
      const [team] = data.teams.nodes;
      if (team) {
        const lookup: ProjectLookup = {
          projects: team.projects.nodes.map((p) => ({
            id: p.id,
            name: p.name,
          })),
          source: "live",
          teamId: team.id,
          viewerId: data.viewer.id,
        };
        await writeCache(
          {
            at: new Date().toISOString(),
            projects: lookup.projects,
            teamId: team.id,
            viewerId: data.viewer.id,
          },
          teamKey
        );
        memos.set(teamKey, { at: Date.now(), lookup });
        return lookup;
      }
    } catch (e) {
      // Fall through to the cache: an outage must not turn every draft into a refusal.
      console.warn(
        `[linear] the project list could not be refreshed — ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  const cached = await readCache(teamKey);
  const lookup: ProjectLookup = cached
    ? {
        projects: cached.projects,
        source: "cache",
        teamId: cached.teamId,
        ...(cached.viewerId ? { viewerId: cached.viewerId } : {}),
      }
    : { projects: [], source: "none" };
  memos.set(teamKey, { at: Date.now(), lookup });
  return lookup;
}

// ── the team's open issues ─────────────────────────────────────────────────────

const OPEN_ISSUES_QUERY = `query OpenIssues($key: String!) {
  issues(
    filter: { team: { key: { eq: $key } }, state: { type: { nin: ["completed", "canceled"] } } }
    first: 250
    orderBy: updatedAt
  ) { nodes { id identifier title state { name type } } }
}`;

/**
 * One issue on the team that is neither done nor cancelled. The state comes with it
 * because Send is offered only on a ticket nobody has started (LIA-162 AC2), and its
 * `type` — Linear's own `backlog` / `unstarted` / `started` — is what that is read off,
 * since a workspace may rename the column.
 */
export interface TeamIssue {
  id: string;
  identifier: string;
  /** The state's display name, for the sentence a refusal is given in. */
  state: string;
  stateType: string;
  title: string;
}

export interface OpenIssues {
  issues: TeamIssue[];
  /** `'live'` from Linear, `'none'` when the key is absent or Linear could not answer. */
  source: "live" | "none";
}

let openMemo: { at: number; issues: OpenIssues } | undefined;

/** Drops the in-process memo. Tests call it; nothing else needs to. */
export const forgetOpenIssues = () => {
  openMemo = undefined;
};

/**
 * The team's issues that are neither done nor cancelled — what Send reads a ticket's state
 * off (LIA-162 AC2). Never throws, and unlike `knownProjects` it is not cached to disk: a
 * stale list would refuse a ticket filed since, which is worse than saying the list could
 * not be read. `source: 'none'` is exactly that, and the caller then treats the state as
 * unknown rather than as a refusal.
 */
export async function openIssues(
  fetchImpl: Fetch = fetch
): Promise<OpenIssues> {
  if (openMemo && Date.now() - openMemo.at < CACHE_TTL_MS) {
    return openMemo.issues;
  }
  let issues: OpenIssues = { issues: [], source: "none" };
  if (linearKey()) {
    try {
      const data = await graphql<{
        issues: {
          nodes: Array<{
            id: string;
            identifier: string;
            state?: { name?: string; type?: string };
            title: string;
          }>;
        };
      }>(OPEN_ISSUES_QUERY, { key: TEAM_KEY }, fetchImpl);
      issues = {
        issues: data.issues.nodes.map((i) => ({
          id: i.id,
          identifier: i.identifier,
          state: i.state?.name ?? "",
          stateType: i.state?.type ?? "",
          title: i.title,
        })),
        source: "live",
      };
    } catch (e) {
      console.warn(
        `[linear] the open-issue list could not be read — ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  openMemo = { at: Date.now(), issues };
  return issues;
}

// ── the one mutation ───────────────────────────────────────────────────────────

const ISSUE_CREATE = `mutation FileTicket($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier url }
  }
}`;

/** The filed issue, as the card shows it and the conversation file records it. */
export interface FiledIssue {
  id: string;
  identifier: string;
  url: string;
}

/**
 * Create one issue. `labelIds` is deliberately absent — filing queues a ticket, it never
 * signals readiness (the `linear-ticket` skill's step 4) — and so are `parentId` and every
 * relation: a split into sub-issues is a terminal's job.
 */
export async function createIssue(
  input: {
    assigneeId?: string;
    description: string;
    projectId?: string;
    teamId: string;
    title: string;
  },
  fetchImpl: Fetch = fetch
): Promise<FiledIssue> {
  const data = await graphql<{
    issueCreate: { issue: FiledIssue | null; success: boolean };
  }>(
    ISSUE_CREATE,
    {
      input: {
        description: input.description,
        teamId: input.teamId,
        title: input.title,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
      },
    },
    fetchImpl
  );
  const { issue, success } = data.issueCreate;
  if (!(success && issue)) {
    throw new LinearError(0, "Linear did not create the issue");
  }
  return { id: issue.id, identifier: issue.identifier, url: issue.url };
}
