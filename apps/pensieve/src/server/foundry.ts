/**
 * Node-only. The Foundry client — the only outbound call Pensieve makes. Three endpoints of
 * the trigger API (foundry `web/README.md` "Trigger a job over HTTP"):
 *
 *   POST /api/jobs        { ticketId, repo }, `Idempotency-Key: <point id>` → 202 Job (created) | 200 Job (replay)
 *   GET  /api/jobs/:id    → Job, polled while status is queued | running
 *   GET  /api/repos       → [{ name, path }], the set `repo` is resolved against (LIA-119)
 *
 * Sending a point never carries `instructions`: Foundry composes the brief from the ticket
 * (LIA-92). The idempotency key is the point id (LIA-91), so a double click or a retry
 * after a timeout answers the job the first call made rather than queueing a second.
 *
 * Config: `FOUNDRY_URL` (default the dev server's `http://localhost:3777`) and
 * `FOUNDRY_API_TOKEN`, read fresh per request — from the environment first, else from the
 * shared credentials file (`shared-env.ts`) that `foundry auth --api` writes (LIA-98). In
 * the container only the environment exists.
 */

import { readSharedEnv, sharedEnvFile } from "./shared-env";

export const FOUNDRY_URL = (
  process.env.FOUNDRY_URL || "http://localhost:3777"
).replace(/\/+$/, "");

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

/** The slice of Foundry's `Job` the page shows. Timestamps are epoch milliseconds. */
export interface FoundryJob {
  branch?: string;
  createdAt?: number;
  exitCode?: number;
  finishedAt?: number;
  id: string;
  prUrl?: string;
  status: JobStatus;
  step?: string;
  ticketId?: string;
}

export async function apiToken(): Promise<string | undefined> {
  const fromEnv = process.env.FOUNDRY_API_TOKEN?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const shared = (await readSharedEnv()).FOUNDRY_API_TOKEN?.trim();
  return shared || undefined;
}

export interface FoundryConfig {
  configured: boolean;
  /** Why Send is unavailable, when it is. */
  reason?: string;
  url: string;
}

export async function foundryConfig(): Promise<FoundryConfig> {
  const token = await apiToken();
  return token
    ? { configured: true, url: FOUNDRY_URL }
    : {
        configured: false,
        reason: `FOUNDRY_API_TOKEN is not set — run \`foundry auth --api\` (writes ${sharedEnvFile()}) or set it in the environment`,
        url: FOUNDRY_URL,
      };
}

/** A non-2xx from Foundry, with the body's `error` and, on 409, the job holding the ticket. */
export class FoundryError extends Error {
  status: number;
  job?: { id: string; status: JobStatus };
  constructor(
    status: number,
    message: string,
    options: ErrorOptions & { job?: { id: string; status: JobStatus } } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "FoundryError";
    this.status = status;
    this.job = options.job;
  }
}

export type Fetch = typeof fetch;

/** How long one request may take before it is a `FoundryError(0)`; a replay is the caller's retry. */
const TIMEOUT_MS = 20_000;

async function call(
  fetchImpl: Fetch,
  path: string,
  init: RequestInit,
  token: string
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetchImpl(`${FOUNDRY_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
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
    throw new FoundryError(
      0,
      `Foundry at ${FOUNDRY_URL} unreachable — ${why}`,
      { cause: e }
    );
  }
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 200) };
    }
  }
  return { body, status: res.status };
}

const errorOf = (body: unknown, status: number) =>
  body &&
  typeof body === "object" &&
  typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : `Foundry answered ${status}`;

function asJob(body: unknown): FoundryJob {
  const j = (body ?? {}) as Record<string, unknown>;
  if (typeof j.id !== "string" || typeof j.status !== "string") {
    throw new FoundryError(0, "Foundry answered without a job");
  }
  return {
    branch: typeof j.branch === "string" ? j.branch : undefined,
    createdAt: typeof j.createdAt === "number" ? j.createdAt : undefined,
    exitCode: typeof j.exitCode === "number" ? j.exitCode : undefined,
    finishedAt: typeof j.finishedAt === "number" ? j.finishedAt : undefined,
    id: j.id,
    prUrl: typeof j.prUrl === "string" ? j.prUrl : undefined,
    status: j.status as JobStatus,
    step: typeof j.step === "string" ? j.step : undefined,
    ticketId: typeof j.ticketId === "string" ? j.ticketId : undefined,
  };
}

/**
 * `POST /api/jobs` for a ticket. `replay` is true when Foundry answered 200 — the key
 * already had a job — so the caller knows nothing new was queued.
 */
export async function createJob(
  input: { ticketId: string; repo: string; idempotencyKey: string },
  fetchImpl: Fetch = fetch
): Promise<{ job: FoundryJob; replay: boolean }> {
  const token = await apiToken();
  if (!token) {
    throw new FoundryError(
      503,
      (await foundryConfig()).reason ?? "FOUNDRY_API_TOKEN is not set"
    );
  }
  // Key order and spacing are fixed here on purpose: Foundry fingerprints the raw bytes,
  // so the same point must always serialise to the same body for a replay to match.
  const body = JSON.stringify({ repo: input.repo, ticketId: input.ticketId });
  const { status, body: res } = await call(
    fetchImpl,
    "/api/jobs",
    {
      body,
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      method: "POST",
    },
    token
  );
  if (status === 202 || status === 200) {
    return { job: asJob(res), replay: status === 200 };
  }
  const holder = (res as { job?: { id?: unknown; status?: unknown } } | null)
    ?.job;
  throw new FoundryError(status, errorOf(res, status), {
    job:
      holder && typeof holder.id === "string"
        ? { id: holder.id, status: String(holder.status) as JobStatus }
        : undefined,
  });
}

/** A repo Foundry tracks, as `GET /api/repos` rows it. `name` is accepted verbatim as `repo`. */
export interface FoundryRepo {
  name: string;
  path: string;
}

/**
 * `GET /api/repos` — what a job may target, so Send can offer a list rather than a typed
 * name (LIA-120). Ordered by name already; the rows carry nothing else.
 *
 * Throws like the job calls do, and the caller is expected to catch: a Foundry from before
 * LIA-119 answers this route with an HTML page rather than an error, so the status is what
 * decides here, never the absence of a throw. Every failure is the same answer to the page
 * — no list — and the free-text field is what stands in for it.
 */
export async function listRepos(
  fetchImpl: Fetch = fetch
): Promise<FoundryRepo[]> {
  const token = await apiToken();
  if (!token) {
    throw new FoundryError(
      503,
      (await foundryConfig()).reason ?? "FOUNDRY_API_TOKEN is not set"
    );
  }
  const { status, body } = await call(
    fetchImpl,
    "/api/repos",
    { method: "GET" },
    token
  );
  if (status !== 200) {
    throw new FoundryError(status, errorOf(body, status));
  }
  if (!Array.isArray(body)) {
    throw new FoundryError(
      status,
      `Foundry at ${FOUNDRY_URL} answered /api/repos without a list`
    );
  }
  return body.flatMap((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    return typeof r.name === "string" && typeof r.path === "string"
      ? [{ name: r.name, path: r.path }]
      : [];
  });
}

/**
 * The list as a page wants it: what Foundry answered, or nothing at all. Every reason there
 * is no list — no token, an unreachable host, a `404` from a Foundry older than LIA-119 —
 * is the same empty answer, because the page does the same thing with all of them: it falls
 * back to the free-text repo field (LIA-120, AC4). A picker is never worth a loader error.
 */
export const trackedRepos = async (
  fetchImpl: Fetch = fetch
): Promise<FoundryRepo[]> =>
  (await apiToken()) ? listRepos(fetchImpl).catch(() => []) : [];

/** `GET /api/jobs/:id`. */
export async function getJob(
  id: string,
  fetchImpl: Fetch = fetch
): Promise<FoundryJob> {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) {
    throw new FoundryError(400, `"${id}" is not a job id`);
  }
  const token = await apiToken();
  if (!token) {
    throw new FoundryError(
      503,
      (await foundryConfig()).reason ?? "FOUNDRY_API_TOKEN is not set"
    );
  }
  const { status, body } = await call(
    fetchImpl,
    `/api/jobs/${id}`,
    { method: "GET" },
    token
  );
  if (status === 200) {
    return asJob(body);
  }
  throw new FoundryError(status, errorOf(body, status));
}

/** Where a job is looked at: Foundry's ledger, which opens the job sheet by id. */
export const jobUrl = (_id: string) => `${FOUNDRY_URL}/`;

export const isOpen = (status: JobStatus) =>
  status === "queued" || status === "running";
