/**
 * Node-only. The trigger API — the second door into the job pipeline after the
 * ignite dialog, and like it it ends in the same two calls: insert the queued
 * row, fire-and-forget the runner. Anything that can make an HTTP request (CI,
 * a Slack bot, another agent, a shell script) can queue a job here with the
 * instructions in the body. `GET /api/repos` (LIA-119) is the read half of
 * its `repo` field: the tracked set, as the names and paths `resolveRepo`
 * accepts, so a caller can offer a picker instead of guessing.
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
 *
 * A `ticketId` alone is enough (LIA-92): the host fetches the ticket through
 * the tickets package (CTD-204), composes the brief from its body, and —
 * once the row exists — claims it there (assignee + started). The order is
 * the invariant: row insert (the unique `ticket_id` index IS the claim), then
 * the provider write, then ignition. A provider write that fails costs an
 * `err` line, never the job. Foundry only fetches and composes here; it
 * never judges whether the ticket is ready — the caller decided that by
 * sending it.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { MissingCredentialError } from '@citadel/tickets'
import type { Ticket } from '@citadel/tickets'
import { z } from 'zod'
import { DEFAULT_BLUEPRINT_ID, STEP_EFFORTS, STEP_MODELS, stepsSummary } from '@/features/blueprints/types'
import { getBlueprintRow, listBlueprints } from '@/features/blueprints/server/blueprint-store'
import { defaultBranchOf, trackedRepos } from '@/features/repos/server/repo-scan'
import { tilde } from '@/features/repos/types'
import { apiToken, tokenMatches } from './auth'
import { appendLogs } from './job-logs'
import * as store from './job-store'
import { hostTickets } from './tickets'
import type { HostTickets } from './tickets'
import { FOLLOW_UPS } from '../types'
import type { Job, JobDetail, NewJobInput } from '../types'

/** Injectable edges, so the tests need neither ~/.foundry/env, docker nor the network. */
export interface ApiDeps {
  token: () => Promise<string | undefined>
  tickets: HostTickets
  ignite: (jobId: string) => Promise<void>
}

const realDeps = (): ApiDeps => ({
  token: apiToken,
  tickets: hostTickets,
  ignite: async (id) => {
    const { startJob } = await import('./job-runner')
    return startJob(id)
  },
})

/**
 * The ticket IS the job brief: every section, behind the key, title and URL.
 * `branchSlug` and the PR↔ticket linker both key off the leading identifier
 * for free.
 */
export function ticketBrief(ticket: Pick<Ticket, 'key' | 'title' | 'url' | 'description'>): string {
  return `${ticket.key}: ${ticket.title}\n${ticket.url}\n\n${ticket.description}`
}

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

/** The message for a body with neither `instructions` nor a `ticketId` to compose them from. */
const INSTRUCTIONS_REQUIRED = 'instructions is required — or a ticketId to compose them from'

/**
 * The request body of `POST /api/jobs`. `instructions` and `ticketId` are
 * each optional but one must be present: with only a `ticketId`, the brief is
 * composed from the Linear issue. The either-or is a check on the object, so
 * it cannot be expressed in the generated JSON Schema — openapi.ts adds it by
 * hand as an `anyOf` of the two `required` lists.
 */
export const TriggerPayloadSchema = z
  .object(
    {
      repo: requiredString('repo', 'repo is required — a tracked repo path or name').describe(
        'A tracked repo (Repos page): its path (`~` allowed) or its basename when that is unique.',
      ),
      instructions: optionalString('instructions').describe(
        "The job's task, verbatim. The first line is the fallback commit subject and PR title, and its first three words name the branch. May be omitted with a `ticketId`: the brief is then `<KEY>: <title>`, the issue URL, and its description.",
      ),
      baseBranch: optionalString('baseBranch').describe(
        "Default: the base of this repo's last job, else origin's default branch.",
      ),
      blueprintId: optionalString('blueprintId').describe(
        'A blueprint id, or `"none"` for one bare step. Default: the seeded "Plan → Execute" (a bare job if that row is gone).',
      ),
      ticketId: optionalString('ticketId', (s) => s.max(64, 'ticketId is too long')).describe(
        'A Linear issue identifier (`LIA-52`). Claims the ticket: the row is the claim (a second trigger for it is a `409` naming the holder, unless that holder was cancelled — a cancelled job releases the ticket), and once it exists the issue is assigned to the host key\'s user and moved to In Progress. Without `instructions`, the brief is composed from the issue.',
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
  .check((ctx) => {
    if (ctx.value.instructions === undefined && ctx.value.ticketId === undefined) {
      ctx.issues.push({ code: 'custom', input: ctx.value, path: ['instructions'], message: INSTRUCTIONS_REQUIRED })
    }
  })

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

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'pr_ready'])
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
  sourceJobId: z.string().optional().describe("Set when this job continues the source job's PR — a follow-up; `followUp` says what it answers."),
  followUp: z
    .enum(FOLLOW_UPS)
    .optional()
    .describe("What a follow-up answers: `review` — the PR's review comments are its task; `check` — a failed check's log is. Absent on a job that is not a follow-up."),
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

/** The `409` from a `ticketId` whose job still holds the claim — never a cancelled one. */
export const ConflictSchema = ErrorSchema.extend({
  job: z.object({ id: z.uuid(), status: JobStatusSchema }).optional().describe('The job holding the ticket, when it still exists.'),
})

/**
 * One row of `GET /api/repos` — a tracked repo as `POST /api/jobs` accepts
 * it. Deliberately nothing live (branch, dirty) and nothing of the host's
 * (row id, notes): the path is the real one, not `tilde()`'s display form.
 */
export const TrackedRepoSchema = z.object({
  name: z.string().describe("The repo's basename — accepted as `repo` by `POST /api/jobs` when no other tracked repo shares it."),
  path: z.string().describe('The absolute path of the checkout on the host — always accepted as `repo`.'),
})

/**
 * One row of `GET /api/blueprints` — a blueprint as `POST /api/jobs` accepts
 * it, so `id` is what travels as `blueprintId`. The steps come as `summary`
 * rather than as themselves: a caller picks a blueprint, it does not
 * re-implement one, and the prompts are long enough to drown a picker.
 */
export const ApiBlueprintSchema = z.object({
  id: z.uuid().describe('What `POST /api/jobs` takes as `blueprintId`.'),
  name: z.string().describe("The blueprint's name, as the Blueprints page shows it."),
  description: z.string().optional().describe('What it is for, when whoever wrote it said.'),
  version: z.number().int().positive().describe('The revision a job started now would run — every save bumps it.'),
  summary: z.string().describe('The step list in one line — `plan · fable → execute · sonnet`.'),
})

export type ApiBlueprint = z.output<typeof ApiBlueprintSchema>

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

/**
 * The payload turned into what the store takes, defaults filled the way the
 * ignite dialog fills them — everything but `task`, which the handler fills
 * in after this: the instructions when the caller sent them, the composed
 * ticket brief otherwise. Resolving here first means an untracked repo or a
 * bad blueprint is a 400 before any Linear round trip.
 */
async function toInput(p: TriggerPayload, idempotency?: NewJobInput['idempotency']): Promise<Omit<NewJobInput, 'task'>> {
  const repo = await resolveRepo(p.repo)

  const baseBranch = p.baseBranch ?? (await store.lastBaseBranchByRepo()).get(repo.id) ?? (await defaultBranchOf(repo.path))

  let blueprintId: string | undefined
  if (p.blueprintId === 'none') blueprintId = undefined
  else if (p.blueprintId) {
    if (!(await getBlueprintRow(p.blueprintId))) throw new BadRequest(`blueprint ${p.blueprintId} does not exist`)
    blueprintId = p.blueprintId
  } else {
    // A deleted default degrades to a bare job rather than a 400.
    blueprintId = (await getBlueprintRow(DEFAULT_BLUEPRINT_ID)) ? DEFAULT_BLUEPRINT_ID : undefined
  }

  return {
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
  let base: Omit<NewJobInput, 'task'>
  try {
    payload = parsePayload(body)
    base = await toInput(payload, idempotency)
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: e.message })
    throw e
  }

  // The ticket is fetched BEFORE the insert, so an id no provider knows (or
  // one that cannot be reached) inserts nothing — there would be no brief to
  // run and no ticket to claim. The claim itself waits until after.
  let ticket: Ticket | undefined
  // Set only on the missing-credential path with instructions in hand — the
  // one way `ticket` stays undefined without already having returned.
  let missingCredential: string | undefined
  if (payload.ticketId) {
    try {
      const found = await deps.tickets.get(payload.ticketId)
      if (!found) return json(400, { error: `ticket ${payload.ticketId} is not a known ticket` })
      ticket = found
    } catch (e) {
      if (e instanceof MissingCredentialError) {
        if (payload.instructions === undefined) {
          return json(503, { error: `no ${e.variable} in the citadel .env or the environment, or send instructions` })
        }
        // Instructions in hand, the job can run; the claim is logged as skipped below.
        missingCredential = e.variable
      } else {
        return json(502, { error: `ticket ${payload.ticketId} could not be fetched: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
  }

  // The schema guarantees instructions or a ticketId; without instructions,
  // the 503 above guarantees the ticket was fetched.
  const task = payload.instructions ?? (ticket ? ticketBrief(ticket) : undefined)
  if (task === undefined) throw new Error('unreachable: no instructions and no fetched ticket to compose them from')

  const job = await store.createJobIdempotent({ ...base, task }, payload.ticketId)
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

  // Only now — the row is the claim — mirror it to the provider, before
  // ignition and awaited, so the 202 tells the truth about the ticket. A
  // failed write leaves the queued row standing with an `err` line: the job
  // is what the caller asked for, the provider's state is a courtesy they
  // can fix by hand.
  if (payload.ticketId) await mirrorClaim(deps, job.id, payload.ticketId, ticket !== undefined, missingCredential)

  // Fire and forget, exactly as the ignite dialog does: the row is the
  // answer, and the runner's cap/pump take it from here. Only the request
  // that inserted the row ignites — a replay or a race loser never does.
  void deps.ignite(job.id)
  return json(202, job)
}

/** Assign + start, on the provider the key names, for a ticket the row just claimed, or a log line saying why not. */
async function mirrorClaim(
  deps: ApiDeps,
  jobId: string,
  ticketId: string,
  claimable: boolean,
  missingCredential: string | undefined,
): Promise<void> {
  if (!claimable) {
    await appendLogs(jobId, [
      { stream: 'err', text: `claim for ${ticketId} skipped — no ${missingCredential} in the citadel .env or the environment` },
    ])
    return
  }
  try {
    await deps.tickets.claim(ticketId)
    await appendLogs(jobId, [{ stream: 'sys', text: `claimed ${ticketId} — assigned to you, started` }])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await appendLogs(jobId, [{ stream: 'err', text: `claim for ${ticketId} failed: ${msg} — job stays queued` }])
  }
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

/**
 * `GET /api/repos` — the tracked repos, ordered by name (path breaks a tie,
 * so two checkouts with one basename come back in a stable order). The same
 * rows `resolveRepo` reads, so every `name` here is one it accepts; an empty
 * table is `[]`, not an error.
 */
export async function handleListRepos(request: Request, deps: ApiDeps = realDeps()): Promise<Response> {
  const denied = await authorize(request, deps)
  if (denied) return denied

  const rows = (await trackedRepos())
    .map(({ name, path: repoPath }) => ({ name, path: repoPath }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  return json(200, rows)
}

/**
 * `GET /api/blueprints` — the blueprints a job may run, ordered by name, as
 * the read half of `blueprintId` (what `/api/repos` is to `repo`). A caller
 * can offer the same picker the ignite dialog does instead of hard-coding a
 * uuid; `"none"` — one bare step — is not a row here, since it is the absence
 * of one. An empty table is `[]`, not an error.
 */
export async function handleListBlueprints(request: Request, deps: ApiDeps = realDeps()): Promise<Response> {
  const denied = await authorize(request, deps)
  if (denied) return denied

  const rows: Array<ApiBlueprint> = (await listBlueprints()).map((bp) => ({
    id: bp.id,
    name: bp.name,
    ...(bp.description ? { description: bp.description } : {}),
    version: bp.version,
    summary: stepsSummary(bp.steps),
  }))
  return json(200, rows)
}
