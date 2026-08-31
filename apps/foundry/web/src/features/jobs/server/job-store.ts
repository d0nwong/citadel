/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 *
 * Row -> domain mapping lives here so the rest of the app keeps seeing epoch
 * milliseconds and optional fields rather than nullable timestamptz columns.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, lt, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, repos } from '@/db/schema'
import { getBlueprintRow, toSnapshot } from '@/features/blueprints/server/blueprint-store'
import { appendLogs, deleteLogs, readLogs } from './job-logs'
import { shortId } from '../types'
import type { Job, JobCursor, JobDetail, JobPage, JobStatus, JobStep, NewJobInput } from '../types'

export type JobRow = typeof jobs.$inferSelect

/** Statuses a job can still move out of. Every settle is guarded on these. */
const OPEN: Array<JobStatus> = ['queued', 'running']

const ms = (d: Date | null) => (d === null ? undefined : d.getTime())

/**
 * Ids come in from URLs and client payloads; a malformed one must read as
 * "no such job", not as a postgres cast error surfacing as a 500.
 */
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

// `token` is deliberately absent: it is the callback secret, and this mapping
// is the only door out of the server. Add a field here only if the UI may see it.
function toJob(row: JobRow): Job {
  return {
    id: row.id,
    task: row.task,
    repo: row.repo,
    baseBranch: row.baseBranch,
    branch: row.branch,
    forge: row.forge,
    blueprint: row.blueprint ?? undefined,
    sourceJobId: row.sourceJobId ?? undefined,
    ticketId: row.ticketId ?? undefined,
    status: row.status,
    step: (row.step as JobStep | null) ?? undefined,
    prUrl: row.prUrl ?? undefined,
    createdAt: row.createdAt.getTime(),
    startedAt: ms(row.startedAt),
    finishedAt: ms(row.finishedAt),
    exitCode: row.exitCode ?? undefined,
    // The three diff columns are written as a set, so one non-null implies all.
    diff:
      row.diffFiles === null
        ? undefined
        : { files: row.diffFiles, additions: row.diffAdditions ?? 0, deletions: row.diffDeletions ?? 0 },
  }
}

/** `Migrate the test runner from jest` -> `migrate-the-test`. Unchanged from the mock. */
function branchSlug(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .slice(0, 3)
    .join('-')
  return slug || 'task'
}

/**
 * Keyset-paginated, newest first. Offset pagination would skip or duplicate
 * rows as new jobs land at the top between polls, so the cursor is the last
 * row's `(createdAt, id)` — `id` tie-breaks same-millisecond inserts.
 */
export async function listJobs(opts: {
  cursor?: JobCursor
  limit: number
  status?: JobStatus
}): Promise<JobPage> {
  const { cursor, limit, status } = opts
  const cursorDate = cursor ? new Date(cursor.createdAt) : undefined

  const where = and(
    status ? eq(jobs.status, status) : undefined,
    cursorDate
      ? or(lt(jobs.createdAt, cursorDate), and(eq(jobs.createdAt, cursorDate), lt(jobs.id, cursor!.id)))
      : undefined,
  )

  const rows = await db
    .select()
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    jobs: page.map(toJob),
    nextCursor: hasMore && last ? { createdAt: last.createdAt.getTime(), id: last.id } : null,
  }
}

/** Group counts for the filter tabs and the purge dialog — cheaper than hauling every row. */
export async function countJobsByStatus(): Promise<Record<JobStatus, number>> {
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status)

  const counts: Record<JobStatus, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 }
  for (const row of rows) counts[row.status] = row.n
  return counts
}

export async function getJob(id: string): Promise<JobDetail | undefined> {
  if (!isUuid(id)) return undefined
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
  if (!row) return undefined
  return { ...toJob(row), logs: await readLogs(id) }
}

/**
 * The base branch each repo was last ignited on — `repo_id` -> branch. The
 * ledger already records every job's base, so "what did I branch from last
 * time" needs no separate store: `distinct on` takes the newest row per repo.
 */
export async function lastBaseBranchByRepo(): Promise<Map<string, string>> {
  const rows = await db.execute<{ repo_id: string; base_branch: string }>(sql`
    select distinct on (${jobs.repoId}) ${jobs.repoId} as repo_id, ${jobs.baseBranch} as base_branch
    from ${jobs}
    where ${jobs.repoId} is not null
    order by ${jobs.repoId}, ${jobs.createdAt} desc
  `)
  return new Map(rows.map((r) => [r.repo_id, r.base_branch]))
}

/**
 * Shared insert behind `createJob` and `claimTicketJob`. With a `ticketId` the
 * insert doubles as the scanner's claim on the ticket: `jobs_ticket_id_unique`
 * is the arbiter, and losing the race comes back as null rather than an error.
 */
async function insertJob(input: NewJobInput, ticketId?: string): Promise<Job | null> {
  const task = input.task.trim()

  // Link to the repo row when the target is one the user imported, so the job
  // can be found from the repo side. `repo` keeps the snapshot either way.
  const repoId =
    input.repo.kind === 'local'
      ? ((await db.select({ id: repos.id }).from(repos).where(eq(repos.path, input.repo.path)))[0]?.id ?? null)
      : null

  // Snapshot the blueprint now: the job must run (and later read) exactly the
  // steps the user picked, however the blueprint is edited afterwards.
  const bp = input.blueprintId ? await getBlueprintRow(input.blueprintId) : undefined
  if (input.blueprintId && !bp) throw new Error('that blueprint no longer exists')

  // The id is generated here rather than by the column default, because the
  // branch name is built from it: `branchSlug` keeps only the first three words
  // of the task, so two jobs on one repo routinely derive the same slug, and
  // the runner's `ls-remote` check cannot separate them — neither has pushed
  // yet when both look. Suffixing the job's own short id makes the branch unique
  // by construction, and readable back to the row in the ledger.
  const id = randomUUID()

  const insert = db.insert(jobs).values({
    id,
    task,
    repo: input.repo,
    repoId,
    baseBranch: input.baseBranch,
    branch: `foundry/${branchSlug(task)}-${shortId(id)}`,
    forge: input.forge,
    blueprintId: bp?.id ?? null,
    blueprint: bp ? toSnapshot(bp) : null,
    ticketId: ticketId ?? null,
  })
  const [row] = ticketId
    ? await insert.onConflictDoNothing({ target: jobs.ticketId }).returning()
    : await insert.returning()
  if (!row) return null

  // Logs are a file now, so this line cannot ride in the insert's transaction —
  // it is written once the row is real. Losing it on a failed insert is right:
  // there would be no job for it to describe.
  const via = bp ? ` via blueprint "${bp.name}" (${bp.steps.length} steps)` : ''
  const claim = ticketId ? ` — scanner claim for ${ticketId}` : ''
  await appendLogs(row.id, [{ stream: 'sys', text: `queued on ${row.forge}${via}${claim}` }])
  return toJob(row)
}

export async function createJob(input: NewJobInput): Promise<Job> {
  const job = await insertJob(input)
  if (!job) throw new Error('unreachable: a plain insert has no conflict to lose')
  return job
}

/**
 * The ticket scanner's atomic claim (LIA-52): inserting the row under the
 * unique index IS the claim on the ticket, taken before any Linear write.
 * `null` means another tick — or an earlier run — already holds it.
 */
export async function claimTicketJob(input: NewJobInput, ticketId: string): Promise<Job | null> {
  return insertJob(input, ticketId)
}

export async function getJobByTicketId(ticketId: string): Promise<JobRow | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.ticketId, ticketId))
  return row
}

/**
 * Copies a job's inputs into a brand-new queued row — same task, repo,
 * base branch, forge, and blueprint *snapshot* (not a re-resolve of
 * `blueprintId`, which may now point at an edited or deleted blueprint).
 * `branchSlug` is re-derived; `prepareWorkspace` already uniquifies it
 * against origin if the original branch is still around. A follow-up job
 * (LIA-40) is the exception: rerunning one must stay a follow-up — same
 * branch, same PR — or it would mint a fresh branch with no comments to
 * address.
 */
export async function rerunJob(sourceId: string): Promise<Job> {
  const src = await getJobRow(sourceId)
  if (!src) throw new Error('that job no longer exists')

  const [row] = await db
    .insert(jobs)
    .values({
      task: src.task,
      repo: src.repo,
      repoId: src.repoId,
      baseBranch: src.baseBranch,
      branch: src.sourceJobId ? src.branch : `foundry/${branchSlug(src.task)}`,
      forge: src.forge,
      blueprintId: src.blueprintId,
      blueprint: src.blueprint,
      sourceJobId: src.sourceJobId,
      prUrl: src.sourceJobId ? src.prUrl : null,
    })
    .returning()

  const via = src.blueprint ? ` via blueprint "${src.blueprint.name}" (${src.blueprint.steps.length} steps)` : ''
  await appendLogs(row.id, [
    { stream: 'sys', text: `queued on ${row.forge}${via} — rerun of ${shortId(src.id)}` },
  ])
  return toJob(row)
}

/**
 * Queue a follow-up that addresses review comments on a settled job's PR
 * (LIA-40). The row copies the source's branch *exactly* — updating a PR means
 * pushing to the branch it was opened from — and its `prUrl`, so the follow-up
 * stays runnable after the source is purged. The comments themselves are not
 * stored: the runner fetches them fresh at launch, the way repo notes are read.
 * No blueprint — addressing feedback is a single bare step.
 */
export async function followUpJob(sourceId: string): Promise<Job> {
  const src = await getJobRow(sourceId)
  if (!src) throw new Error('that job no longer exists')
  if (OPEN.includes(src.status)) throw new Error('that job is still running — wait for its PR first')
  if (!src.prUrl) throw new Error('that job has no pull request to address comments on')

  const [row] = await db
    .insert(jobs)
    .values({
      // Following up on a follow-up keeps its label — no stacked prefixes.
      task: src.sourceJobId ? src.task : `Address PR comments — ${src.task}`,
      repo: src.repo,
      repoId: src.repoId,
      baseBranch: src.baseBranch,
      branch: src.branch,
      forge: src.forge,
      sourceJobId: src.sourceJobId ?? src.id,
      prUrl: src.prUrl,
    })
    .returning()

  await appendLogs(row.id, [
    { stream: 'sys', text: `queued on ${row.forge} — addressing PR comments of ${shortId(src.id)}` },
  ])
  return toJob(row)
}

/** No-op unless the job is still open — a settled job keeps its outcome. */
export async function cancelJob(id: string): Promise<void> {
  const [row] = await db
    .update(jobs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
    .returning({ id: jobs.id })
  // Only the call that actually made the transition says so in the log.
  if (row) await appendLogs(id, [{ stream: 'sys', text: 'cancelled by user' }])
}

/**
 * Deletes every settled job (never one that is still queued or running, so an
 * active container's row can't vanish from under it), and unlinks each one's
 * log file — the job that the FK cascade on `job_logs` used to do. Returns how
 * many rows were removed.
 */
export async function purgeJobs(): Promise<number> {
  const rows = await db.delete(jobs).where(notInArray(jobs.status, OPEN)).returning({ id: jobs.id })
  await deleteLogs(rows.map((r) => r.id))
  return rows.length
}

/* ------------------------------------------------------------------ */
/* Write paths for the runner and the callback endpoint (LIA-13).     */
/* ------------------------------------------------------------------ */

/** Full row, token included — for the runner and callback auth only. */
export async function getJobRow(id: string): Promise<JobRow | undefined> {
  if (!isUuid(id)) return undefined
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
  return row
}

/**
 * The mutable-during-run fields. `exitCode` is written early — at the commit
 * event, not just at settle — so a finish resumed after a server restart still
 * knows how the agent did.
 */
export async function patchJob(
  id: string,
  fields: Partial<Pick<JobRow, 'step' | 'container' | 'workspace' | 'branch' | 'startedAt' | 'exitCode'>>,
): Promise<void> {
  await db.update(jobs).set(fields).where(eq(jobs.id, id))
}

/**
 * Atomically claim a queued job for execution. False means someone else got
 * there first (or it was cancelled while waiting) — do nothing.
 */
export async function claimJob(id: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: 'running', startedAt: new Date(), step: 'prepare' })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
    .returning({ id: jobs.id })
  return rows.length > 0
}

/**
 * Terminal transition, guarded: only an open job settles, so cancel racing the
 * container watcher cannot overwrite one outcome with another. Returns whether
 * this call was the one that settled it.
 */
export async function settleJob(
  id: string,
  outcome: {
    status: 'succeeded' | 'failed'
    exitCode?: number
    diff?: { files: number; additions: number; deletions: number }
    prUrl?: string
  },
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: outcome.status,
      step: 'done',
      finishedAt: new Date(),
      exitCode: outcome.exitCode ?? null,
      diffFiles: outcome.diff?.files ?? null,
      diffAdditions: outcome.diff?.additions ?? null,
      diffDeletions: outcome.diff?.deletions ?? null,
      // Written only when the caller has one: a follow-up job carries its PR
      // link from insert, and a settle without a URL must not erase it.
      ...(outcome.prUrl !== undefined ? { prUrl: outcome.prUrl } : {}),
    })
    .where(and(eq(jobs.id, id), inArray(jobs.status, OPEN)))
    .returning({ id: jobs.id })
  return rows.length > 0
}

/** Jobs the runner needs to look at on reconcile / queue pumping. */
export async function listOpenJobs(): Promise<Array<JobRow>> {
  return db.select().from(jobs).where(inArray(jobs.status, OPEN)).orderBy(asc(jobs.createdAt))
}

export async function countRunning(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.status, 'running'))
  return row?.n ?? 0
}
