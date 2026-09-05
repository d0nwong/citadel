/**
 * Node-only. The Foundry client — the only outbound call Pensieve makes. Two endpoints of
 * the trigger API (foundry `web/README.md` "Trigger a job over HTTP"):
 *
 *   POST /api/jobs        { ticketId, repo }, `Idempotency-Key: <point id>` → 202 Job (created) | 200 Job (replay)
 *   GET  /api/jobs/:id    → Job, polled while status is queued | running
 *
 * Sending a point never carries `instructions`: Foundry composes the brief from the ticket
 * (LIA-92). The idempotency key is the point id (LIA-91), so a double click or a retry
 * after a timeout answers the job the first call made rather than queueing a second.
 *
 * Config: `FOUNDRY_URL` (default the dev server's `http://localhost:3777`) and
 * `FOUNDRY_API_TOKEN`, read fresh per request — from the environment first, else from the
 * shared credentials file `~/.config/liamai/env` (`LIAMAI_ENV` overrides the path) that
 * `foundry auth --api` writes (LIA-98). In the container only the environment exists.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

export const FOUNDRY_URL = (process.env.FOUNDRY_URL || 'http://localhost:3777').replace(/\/+$/, '')
export const SHARED_ENV_FILE = process.env.LIAMAI_ENV || join(homedir(), '.config', 'liamai', 'env')

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** The slice of Foundry's `Job` the page shows. Timestamps are epoch milliseconds. */
export interface FoundryJob {
  id: string
  status: JobStatus
  step?: string
  branch?: string
  ticketId?: string
  createdAt?: number
  finishedAt?: number
  prUrl?: string
  exitCode?: number
}

/** `KEY=value` lines, the shape `foundry auth` writes. No file is an empty map. */
export async function readSharedEnv(file = SHARED_ENV_FILE): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* absent — the caller reports "not configured" */
  }
  return out
}

export async function apiToken(): Promise<string | undefined> {
  const fromEnv = process.env.FOUNDRY_API_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const shared = (await readSharedEnv()).FOUNDRY_API_TOKEN?.trim()
  return shared || undefined
}

export interface FoundryConfig {
  url: string
  configured: boolean
  /** Why Send is unavailable, when it is. */
  reason?: string
}

export async function foundryConfig(): Promise<FoundryConfig> {
  const token = await apiToken()
  return token
    ? { url: FOUNDRY_URL, configured: true }
    : {
        url: FOUNDRY_URL,
        configured: false,
        reason: `FOUNDRY_API_TOKEN is not set — run \`foundry auth --api\` (writes ${SHARED_ENV_FILE}) or set it in the environment`,
      }
}

/** A non-2xx from Foundry, with the body's `error` and, on 409, the job holding the ticket. */
export class FoundryError extends Error {
  constructor(
    public status: number,
    message: string,
    public job?: { id: string; status: JobStatus },
  ) {
    super(message)
    this.name = 'FoundryError'
  }
}

export type Fetch = typeof fetch

/** How long one request may take before it is a `FoundryError(0)`; a replay is the caller's retry. */
const TIMEOUT_MS = 20_000

async function call(fetchImpl: Fetch, path: string, init: RequestInit, token: string): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetchImpl(`${FOUNDRY_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const why = e instanceof Error && e.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000}s` : e instanceof Error ? e.message : String(e)
    throw new FoundryError(0, `Foundry at ${FOUNDRY_URL} unreachable — ${why}`)
  }
  let body: unknown = null
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { error: text.slice(0, 200) }
    }
  }
  return { status: res.status, body }
}

const errorOf = (body: unknown, status: number) =>
  body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `Foundry answered ${status}`

function asJob(body: unknown): FoundryJob {
  const j = (body ?? {}) as Record<string, unknown>
  if (typeof j.id !== 'string' || typeof j.status !== 'string') throw new FoundryError(0, 'Foundry answered without a job')
  return {
    id: j.id,
    status: j.status as JobStatus,
    step: typeof j.step === 'string' ? j.step : undefined,
    branch: typeof j.branch === 'string' ? j.branch : undefined,
    ticketId: typeof j.ticketId === 'string' ? j.ticketId : undefined,
    createdAt: typeof j.createdAt === 'number' ? j.createdAt : undefined,
    finishedAt: typeof j.finishedAt === 'number' ? j.finishedAt : undefined,
    prUrl: typeof j.prUrl === 'string' ? j.prUrl : undefined,
    exitCode: typeof j.exitCode === 'number' ? j.exitCode : undefined,
  }
}

/**
 * `POST /api/jobs` for a ticket. `replay` is true when Foundry answered 200 — the key
 * already had a job — so the caller knows nothing new was queued.
 */
export async function createJob(
  input: { ticketId: string; repo: string; idempotencyKey: string },
  fetchImpl: Fetch = fetch,
): Promise<{ job: FoundryJob; replay: boolean }> {
  const token = await apiToken()
  if (!token) throw new FoundryError(503, (await foundryConfig()).reason ?? 'FOUNDRY_API_TOKEN is not set')
  // Key order and spacing are fixed here on purpose: Foundry fingerprints the raw bytes,
  // so the same point must always serialise to the same body for a replay to match.
  const body = JSON.stringify({ ticketId: input.ticketId, repo: input.repo })
  const { status, body: res } = await call(
    fetchImpl,
    '/api/jobs',
    { method: 'POST', body, headers: { 'content-type': 'application/json', 'Idempotency-Key': input.idempotencyKey } },
    token,
  )
  if (status === 202 || status === 200) return { job: asJob(res), replay: status === 200 }
  const holder = (res as { job?: { id?: unknown; status?: unknown } } | null)?.job
  throw new FoundryError(
    status,
    errorOf(res, status),
    holder && typeof holder.id === 'string' ? { id: holder.id, status: String(holder.status) as JobStatus } : undefined,
  )
}

/** `GET /api/jobs/:id`. */
export async function getJob(id: string, fetchImpl: Fetch = fetch): Promise<FoundryJob> {
  if (!/^[0-9a-f-]{8,64}$/i.test(id)) throw new FoundryError(400, `"${id}" is not a job id`)
  const token = await apiToken()
  if (!token) throw new FoundryError(503, (await foundryConfig()).reason ?? 'FOUNDRY_API_TOKEN is not set')
  const { status, body } = await call(fetchImpl, `/api/jobs/${id}`, { method: 'GET' }, token)
  if (status === 200) return asJob(body)
  throw new FoundryError(status, errorOf(body, status))
}

/** Where a job is looked at: Foundry's ledger, which opens the job sheet by id. */
export const jobUrl = (_id: string) => `${FOUNDRY_URL}/`

export const isOpen = (status: JobStatus) => status === 'queued' || status === 'running'
