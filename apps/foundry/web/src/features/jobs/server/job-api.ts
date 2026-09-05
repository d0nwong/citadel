/**
 * Node-only. The trigger API — the third door into the job pipeline after the
 * ignite dialog and the ticket scanner, and like them it ends in the same two
 * calls: insert the queued row, fire-and-forget the runner. Anything that can
 * make an HTTP request (CI, a Slack bot, another agent, a shell script) can
 * queue a job here with the instructions in the body.
 *
 * Authenticated with one install-wide bearer token (`foundry auth --api`).
 * The dev server listens on the LAN so containers can call back, and this
 * endpoint runs Claude against your repos and pushes with your credentials —
 * so with no token configured it answers 503 rather than opening up.
 */
import { homedir } from 'node:os'
import path from 'node:path'
import { DEFAULT_BLUEPRINT_ID } from '@/features/blueprints/types'
import { getBlueprintRow } from '@/features/blueprints/server/blueprint-store'
import { trackedRepos } from '@/features/repos/server/repo-scan'
import { tilde } from '@/features/repos/types'
import { defaultBranchOf } from '@/features/scanner/server/repo-map'
import { apiToken, tokenMatches } from './auth'
import * as store from './job-store'
import type { Job, NewJobInput } from '../types'

/** Injectable edges, so the tests need neither ~/.foundry/env nor docker. */
export interface ApiDeps {
  token: () => Promise<string | undefined>
  ignite: (jobId: string) => Promise<void>
}

const realDeps = (): ApiDeps => ({
  token: apiToken,
  ignite: async (id) => {
    const { startJob } = await import('./job-runner')
    return startJob(id)
  },
})

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A 400 with a message the caller can act on, thrown from the parse/resolve steps. */
class BadRequest extends Error {}

/** Null when the request may proceed; otherwise the response to send instead. */
export async function authorize(request: Request, deps: ApiDeps): Promise<Response | null> {
  const expected = await deps.token()
  if (!expected) return json(503, { error: 'trigger API not configured — run: foundry auth --api' })
  if (!tokenMatches(expected, request.headers.get('authorization'))) return json(401, { error: 'unauthorized' })
  return null
}

/** The request body, as documented in web/README.md ("Trigger a job over HTTP"). */
export interface TriggerPayload {
  /** A tracked repo: its path (`~` allowed) or its basename when that is unique. */
  repo: string
  /** The job's task, verbatim. First line = commit subject / PR title fallback. */
  instructions: string
  baseBranch?: string
  /** A blueprint id, or `"none"` for one bare step. Default: the seeded "Plan → Execute". */
  blueprintId?: string
  /** Claims the ticket the way the scanner does — a second trigger for it is a 409. */
  ticketId?: string
  /** Where to POST the signed `job.settled` event. http(s) only. */
  callbackUrl?: string
}

const optionalString = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new BadRequest(`${name} must be a string`)
  const t = v.trim()
  return t === '' ? undefined : t
}

function parsePayload(body: unknown): TriggerPayload {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequest('body must be a JSON object')
  const b = body as Record<string, unknown>
  const repo = optionalString(b.repo, 'repo')
  if (!repo) throw new BadRequest('repo is required — a tracked repo path or name')
  const instructions = optionalString(b.instructions, 'instructions')
  if (!instructions) throw new BadRequest('instructions is required')
  const ticketId = optionalString(b.ticketId, 'ticketId')
  if (ticketId && ticketId.length > 64) throw new BadRequest('ticketId is too long')
  const callbackUrl = optionalString(b.callbackUrl, 'callbackUrl')
  if (callbackUrl) {
    let u: URL
    try {
      u = new URL(callbackUrl)
    } catch {
      throw new BadRequest('callbackUrl must be an absolute URL')
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new BadRequest('callbackUrl must be http or https')
  }
  return {
    repo,
    instructions,
    baseBranch: optionalString(b.baseBranch, 'baseBranch'),
    blueprintId: optionalString(b.blueprintId, 'blueprintId'),
    ticketId,
    callbackUrl,
  }
}

/**
 * Only the curated set is targetable (the web README's invariant): by exact
 * path, `~`-expanded path, or basename when exactly one tracked repo has it.
 */
export async function resolveRepo(ref: string): Promise<{ id: string; path: string; name: string }> {
  const tracked = await trackedRepos()
  const expanded = ref.startsWith('~/') ? path.join(homedir(), ref.slice(2)) : ref
  const byPath = tracked.find((r) => r.path === expanded || r.path === expanded.replace(/\/+$/, ''))
  if (byPath) return byPath
  const byName = tracked.filter((r) => r.name === ref)
  if (byName.length === 1) return byName[0]!
  const known = tracked.map((r) => r.name).sort().join(', ') || '(none — add repos on the Repos page)'
  if (byName.length > 1) {
    throw new BadRequest(`repo "${ref}" is ambiguous — use a path: ${byName.map((r) => tilde(r.path)).join(', ')}`)
  }
  throw new BadRequest(`repo "${ref}" is not tracked — known: ${known}`)
}

/** The payload turned into what the store takes, defaults filled the way the ignite dialog fills them. */
async function toInput(p: TriggerPayload): Promise<NewJobInput> {
  const repo = await resolveRepo(p.repo)

  const baseBranch = p.baseBranch ?? (await store.lastBaseBranchByRepo()).get(repo.id) ?? (await defaultBranchOf(repo.path))

  let blueprintId: string | undefined
  if (p.blueprintId === 'none') blueprintId = undefined
  else if (p.blueprintId) {
    if (!(await getBlueprintRow(p.blueprintId))) throw new BadRequest(`blueprint ${p.blueprintId} does not exist`)
    blueprintId = p.blueprintId
  } else {
    // Same degrade rule as the scanner: a deleted default means a bare job.
    blueprintId = (await getBlueprintRow(DEFAULT_BLUEPRINT_ID)) ? DEFAULT_BLUEPRINT_ID : undefined
  }

  return {
    task: p.instructions,
    repo: { kind: 'local', name: repo.name, path: repo.path },
    baseBranch,
    forge: 'orbstack',
    blueprintId,
    callbackUrl: p.callbackUrl,
  }
}

/** `POST /api/jobs` */
export async function handleTriggerJob(request: Request, deps: ApiDeps = realDeps()): Promise<Response> {
  const denied = await authorize(request, deps)
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid json' })
  }

  let payload: TriggerPayload
  let input: NewJobInput
  try {
    payload = parsePayload(body)
    input = await toInput(payload)
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: e.message })
    throw e
  }

  let job: Job
  if (payload.ticketId) {
    const claimed = await store.claimTicketJob(input, payload.ticketId)
    if (claimed === null) {
      const holder = await store.getJobByTicketId(payload.ticketId)
      return json(409, {
        error: `ticket ${payload.ticketId} already has a job`,
        job: holder ? { id: holder.id, status: holder.status } : undefined,
      })
    }
    job = claimed
  } else {
    job = await store.createJob(input)
  }

  // Fire and forget, exactly as the ignite dialog does: the row is the
  // answer, and the runner's cap/pump take it from here.
  void deps.ignite(job.id)
  return json(202, job)
}

/** `GET /api/jobs/:id` — the `Job`, plus its log lines with `?logs=1`. */
export async function handleGetJob(id: string, request: Request, deps: ApiDeps = realDeps()): Promise<Response> {
  const denied = await authorize(request, deps)
  if (denied) return denied

  const detail = await store.getJob(id)
  if (!detail) return json(404, { error: 'no such job' })
  const withLogs = new URL(request.url).searchParams.get('logs') === '1'
  if (withLogs) return json(200, detail)
  const { logs: _logs, ...job } = detail
  return json(200, job)
}
