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
 *
 * An `Idempotency-Key` header (LIA-91) makes the insert safe to retry: the
 * same key with the same body answers the job made the first time, the same
 * key with a different body is refused. Callers are services and a cockpit
 * that retries on timeout, so one intent must never queue two jobs.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { DEFAULT_BLUEPRINT_ID, STEP_EFFORTS, STEP_MODELS } from '@/features/blueprints/types'
import { getBlueprintRow } from '@/features/blueprints/server/blueprint-store'
import { trackedRepos } from '@/features/repos/server/repo-scan'
import { tilde } from '@/features/repos/types'
import { defaultBranchOf } from '@/features/scanner/server/repo-map'
import { apiToken, tokenMatches } from './auth'
import * as store from './job-store'
import type { Job, JobDetail, NewJobInput } from '../types'

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

/** The request header that makes `POST /api/jobs` replay-safe, and how long a key may be. */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key'
export const IDEMPOTENCY_KEY_MAX = 128

/**
 * What a key is compared against on a replay: the raw body bytes, hashed. Raw
 * on purpose — the check runs before the body is parsed, so an equivalent JSON
 * serialised differently counts as a different body. Cheap, and never wrong
 * about "did the caller send the same thing".
 */
const fingerprint = (rawBody: string) => createHash('sha256').update(rawBody).digest('hex')

/** A 400 with a message the caller can act on, thrown from the parse/resolve steps. */
class BadRequest extends Error {}

/** Null when the request may proceed; otherwise the response to send instead. */
export async function authorize(request: Request, deps: ApiDeps): Promise<Response | null> {
  const expected = await deps.token()
  if (!expected) return json(503, { error: 'trigger API not configured — run: foundry auth --api' })
  if (!tokenMatches(expected, request.headers.get('authorization'))) return json(401, { error: 'unauthorized' })
  return null
}

/* ------------------------------------------------------------------ */
/* Schemas                                                            */
/* ------------------------------------------------------------------ */
/*
 * The wire shapes live here as zod schemas because they do double duty: the
 * handlers parse with them, and openapi.ts turns the same objects into the
 * published document's component schemas. One source, so the spec can never
 * promise a field the parser rejects (LIA-90). Descriptions are written for
 * the reference page; error messages are written for the caller's terminal.
 */

/**
 * A string field that is optional, where blank or null means "not given".
 * `refine` narrows the string before it is trimmed away, so a length cap
 * lands in the JSON Schema as `maxLength` rather than being lost.
 */
const optionalString = (name: string, refine: (s: z.ZodString) => z.ZodString = (s) => s) =>
  refine(z.string({ error: `${name} must be a string` }).trim())
    .transform((s) => (s === '' ? undefined : s))
    .nullish()
    .transform((s) => s ?? undefined)

const requiredString = (name: string, hint: string) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? hint : `${name} must be a string`) })
    .trim()
    .min(1, hint)

/** The request body of `POST /api/jobs`. */
export const TriggerPayloadSchema = z.object(
  {
    repo: requiredString('repo', 'repo is required — a tracked repo path or name').describe(
      'A tracked repo (Repos page): its path (`~` allowed) or its basename when that is unique.',
    ),
    instructions: requiredString('instructions', 'instructions is required').describe(
      "The job's task, verbatim. The first line is the fallback commit subject and PR title, and its first three words name the branch.",
    ),
    baseBranch: optionalString('baseBranch').describe(
      "Default: the base of this repo's last job, else origin's default branch.",
    ),
    blueprintId: optionalString('blueprintId').describe(
      'A blueprint id, or `"none"` for one bare step. Default: the seeded "Plan → Execute" (a bare job if that row is gone).',
    ),
    ticketId: optionalString('ticketId', (s) => s.max(64, 'ticketId is too long')).describe(
      'Claims the ticket the way the scanner does — a second trigger for it is a `409` naming the holder.',
    ),
    callbackUrl: z
      .url({
        protocol: /^https?$/,
        error: (issue) =>
          typeof issue.input === 'string' && URL.canParse(issue.input)
            ? 'callbackUrl must be http or https'
            : 'callbackUrl must be an absolute URL',
      })
      .optional()
      .describe('Where to POST the signed `job.settled` event. http(s) only.'),
  },
  { error: 'body must be a JSON object' },
)

export type TriggerPayload = z.output<typeof TriggerPayloadSchema>

const RepoRefSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('local'), name: z.string(), path: z.string() }),
    z.object({ kind: z.literal('git'), name: z.string(), url: z.string(), ref: z.string() }),
  ])
  .describe('What the job points at: a local checkout (bind-mounted) or a remote git repo (cloned).')

const BlueprintStepSchema = z.object({
  name: z.string(),
  model: z.enum(STEP_MODELS),
  effort: z.enum(STEP_EFFORTS).optional(),
  prompt: z.string().describe("May contain `{{task}}`, substituted with the job's task in the container."),
})

const BlueprintSnapshotSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.number().int().positive().optional().describe('Which revision ran. Absent on jobs queued before blueprints were versioned.'),
    steps: z.array(BlueprintStepSchema),
  })
  .describe('What a job keeps of the blueprint it ran — immune to later edits or deletion of the blueprint row.')

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
const JobStepSchema = z
  .enum(['prepare', 'agent', 'commit', 'push', 'pr', 'done'])
  .describe('Where the pipeline is. The container owns agent+commit; the host owns the rest.')

const epochMs = (what: string) => z.number().int().nonnegative().describe(`${what}, epoch milliseconds.`)

/** A job as the API returns it. Timestamps are epoch milliseconds everywhere. */
export const JobSchema = z.object({
  id: z.uuid(),
  task: z.string(),
  repo: RepoRefSchema,
  baseBranch: z.string(),
  branch: z.string().describe('The branch the job pushes: `foundry/<slug>-<short id>`.'),
  forge: z.string(),
  blueprint: BlueprintSnapshotSchema.optional().describe('The blueprint that ran, snapshotted — absent for a plain single-step job.'),
  sourceJobId: z.string().optional().describe("Set when this job addresses review comments on the source job's PR."),
  ticketId: z.string().optional().describe('Linear issue identifier (e.g. LIA-52) when a ticket was claimed for this job.'),
  callbackUrl: z.string().optional().describe('Where the host POSTs the signed `job.settled` event — set by the trigger API only.'),
  status: JobStatusSchema,
  step: JobStepSchema.optional(),
  createdAt: epochMs('When the row was inserted'),
  startedAt: epochMs('When the container started').optional(),
  finishedAt: epochMs('When the job settled').optional(),
  diff: z.object({ files: z.number().int().nonnegative(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() }).optional(),
  exitCode: z.number().int().nonnegative().optional().describe("The agent's exit code, once the container has reported."),
  prUrl: z.string().optional(),
})

export const LogLineSchema = z.object({
  t: epochMs('When the line was logged'),
  stream: z.enum(['sys', 'out', 'tool', 'err']),
  text: z.string(),
})

/** `GET /api/jobs/{id}?logs=1` — the job plus its log lines. */
export const JobDetailSchema = JobSchema.extend({ logs: z.array(LogLineSchema) })

export const ErrorSchema = z.object({ error: z.string().describe('What went wrong, written for the caller.') })

/** The `409` from a `ticketId` that already has a job. */
export const ConflictSchema = ErrorSchema.extend({
  job: z.object({ id: z.uuid(), status: JobStatusSchema }).optional().describe('The job holding the ticket, when it still exists.'),
})

/*
 * The schemas must describe exactly the domain types the store returns. This
 * is the strict identity check (optional and extra keys count), so a field
 * added to either side without the other fails `tsc` rather than drifting
 * the published spec.
 */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const _jobParity: Same<z.output<typeof JobSchema>, Job> = true
const _detailParity: Same<z.output<typeof JobDetailSchema>, JobDetail> = true
void _jobParity
void _detailParity

/** The parsed body, or a `BadRequest` carrying the schema's first message. */
function parsePayload(body: unknown): TriggerPayload {
  const parsed = TriggerPayloadSchema.safeParse(body)
  if (!parsed.success) throw new BadRequest(parsed.error.issues[0]?.message ?? 'invalid payload')
  return parsed.data
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
async function toInput(p: TriggerPayload, idempotency?: NewJobInput['idempotency']): Promise<NewJobInput> {
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
    idempotency,
  }
}

/**
 * The answer for a key that already has a job: the job itself when the body
 * is the one that made it (a replay), a 422 when it is not (a reused key).
 * Null when the key has no job yet.
 */
async function replayResponse(key: string, bodyFingerprint: string): Promise<Response | null> {
  const found = await store.findJobByIdempotencyKey(key)
  if (!found) return null
  if (found.fingerprint !== bodyFingerprint) {
    return json(422, { error: `${IDEMPOTENCY_HEADER} ${key} was already used with a different body` })
  }
  return json(200, found.job)
}

/** `POST /api/jobs` */
export async function handleTriggerJob(request: Request, deps: ApiDeps = realDeps()): Promise<Response> {
  const denied = await authorize(request, deps)
  if (denied) return denied

  // `Headers.get` already strips surrounding whitespace, so '' is an empty header.
  const key = request.headers.get(IDEMPOTENCY_HEADER)
  if (key !== null && (key === '' || key.length > IDEMPOTENCY_KEY_MAX)) {
    return json(400, { error: `${IDEMPOTENCY_HEADER} must be 1 to ${IDEMPOTENCY_KEY_MAX} characters` })
  }

  // The body is read as text so the fingerprint covers the bytes as sent, and
  // the key is checked before anything in the body is parsed or resolved: a
  // replay must answer the job it already made even if, say, its blueprint
  // has since been deleted or its repo untracked.
  const raw = await request.text()
  const idempotency = key === null ? undefined : { key, fingerprint: fingerprint(raw) }
  if (idempotency) {
    const replay = await replayResponse(idempotency.key, idempotency.fingerprint)
    if (replay) return replay
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'invalid json' })
  }

  let payload: TriggerPayload
  let input: NewJobInput
  try {
    payload = parsePayload(body)
    input = await toInput(payload, idempotency)
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: e.message })
    throw e
  }

  const job = await store.createJobIdempotent(input, payload.ticketId)
  if (job === null) {
    // A unique index refused the row. The key's, if a concurrent first request
    // with this key won the race — then the winner is this request's answer,
    // exactly as a replay would be. Otherwise the ticket's.
    if (idempotency) {
      const replay = await replayResponse(idempotency.key, idempotency.fingerprint)
      if (replay) return replay
    }
    if (!payload.ticketId) throw new Error('unreachable: a row without a ticket can only lose on its key')
    const holder = await store.getJobByTicketId(payload.ticketId)
    return json(409, {
      error: `ticket ${payload.ticketId} already has a job`,
      job: holder ? { id: holder.id, status: holder.status } : undefined,
    })
  }

  // Fire and forget, exactly as the ignite dialog does: the row is the
  // answer, and the runner's cap/pump take it from here. Only the request
  // that inserted the row ignites — a replay or a race loser never does.
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
