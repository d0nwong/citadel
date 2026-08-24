/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 *
 * Row -> domain mapping lives here so the rest of the app keeps seeing epoch
 * milliseconds and optional fields rather than nullable timestamptz columns.
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobLogs, jobs, repos } from '@/db/schema'
import { getBlueprintRow, toSnapshot } from '@/features/blueprints/server/blueprint-store'
import type { Job, JobDetail, JobStatus, JobStep, LogLine, LogStream, NewJobInput } from '../types'

export type JobRow = typeof jobs.$inferSelect
type LogRow = typeof jobLogs.$inferSelect

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

const toLogLine = (row: LogRow): LogLine => ({ t: row.t.getTime(), stream: row.stream, text: row.text })

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

export async function listJobs(): Promise<Array<Job>> {
  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt))
  return rows.map(toJob)
}

export async function getJob(id: string): Promise<JobDetail | undefined> {
  if (!isUuid(id)) return undefined
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
  if (!row) return undefined
  const lines = await db.select().from(jobLogs).where(eq(jobLogs.jobId, id)).orderBy(asc(jobLogs.id))
  return { ...toJob(row), logs: lines.map(toLogLine) }
}

export async function createJob(input: NewJobInput): Promise<Job> {
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

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        task,
        repo: input.repo,
        repoId,
        baseBranch: input.baseBranch,
        branch: `foundry/${branchSlug(task)}`,
        forge: input.forge,
        blueprintId: bp?.id ?? null,
        blueprint: bp ? toSnapshot(bp) : null,
      })
      .returning()

    const via = bp ? ` via blueprint "${bp.name}" (${bp.steps.length} steps)` : ''
    await tx.insert(jobLogs).values({ jobId: row.id, stream: 'sys', text: `queued on ${row.forge}${via}` })
    return toJob(row)
  })
}

/** No-op unless the job is still open — a settled job keeps its outcome. */
export async function cancelJob(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
      .returning({ id: jobs.id })
    if (!row) return
    await tx.insert(jobLogs).values({ jobId: id, stream: 'sys', text: 'cancelled by user' })
  })
}

/**
 * Deletes every settled job (never one that is still queued or running, so an
 * active container's row can't vanish from under it). `job_logs` cascades on
 * the FK, so logs go with their job. Returns how many rows were removed.
 */
export async function purgeJobs(): Promise<number> {
  const rows = await db.delete(jobs).where(notInArray(jobs.status, OPEN)).returning({ id: jobs.id })
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

export async function appendLogs(
  jobId: string,
  lines: Array<{ stream: LogStream; text: string }>,
): Promise<void> {
  if (lines.length === 0) return
  await db.insert(jobLogs).values(lines.map((l) => ({ jobId, ...l })))
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
      prUrl: outcome.prUrl ?? null,
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
