/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 *
 * Row -> domain mapping lives here so the rest of the app keeps seeing epoch
 * milliseconds and optional fields rather than nullable timestamptz columns.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, ne, notExists, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, prWatches, repos } from '@/db/schema'
import { getBlueprintRow, toSnapshot } from '@/features/blueprints/server/blueprint-store'
import { CHECK_BLUEPRINT_ID, CHECK_BLUEPRINT_STEPS, MERGE_BLUEPRINT_ID, MERGE_BLUEPRINT_STEPS } from '@/features/blueprints/types'
import type { BlueprintStep } from '@/features/blueprints/types'
import { appendLogs, deleteLogs, readLogs } from './job-logs'
import { shortId } from '../types'
import type { FollowUp, Job, JobCursor, JobDetail, JobPage, JobStatus, JobStep, NewJobInput } from '../types'

export type JobRow = typeof jobs.$inferSelect
/** The handle `db.transaction` hands its callback, or `db` itself — for writes a caller may wrap. */
export type Db = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

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
    followUp: row.followUp ?? undefined,
    ticketId: row.ticketId ?? undefined,
    callbackUrl: row.callbackUrl ?? undefined,
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
 * The outer `jobs` row, spelled out, for the correlated subqueries below.
 * Drizzle writes a column without its table in a select list, and inside a
 * subquery over `jobs f` a bare "id" binds to the inner row — which made the
 * selected activity (the next page's cursor) silently fall back to the root's
 * own created_at and skip every group a follow-up had moved up.
 */
const outer = (column: string) => sql.raw(`"foundry"."jobs"."${column}"`)

/**
 * The ledger's page (CTD-183): one group per root job — a job that is not a
 * follow-up, or whose root has been purged (no FK, by design) — carrying the
 * follow-ups that continue its PR, oldest first. Groups come newest activity
 * first, activity being the newest `created_at` in the group, so a follow-up
 * the PR watcher queues on an old job brings that job back to the top.
 *
 * Keyset-paginated on `(activity, id)`: offset pagination would skip or repeat
 * groups as new ones land between polls. Activity is truncated to the
 * millisecond, so the cursor — epoch ms on the wire — compares exactly. A
 * status filter keeps a group when its root *or* any follow-up has that
 * status, so "Forging" finds the old job whose follow-up is running.
 */
export async function listJobs(opts: {
  cursor?: JobCursor
  limit: number
  status?: JobStatus
}): Promise<JobPage> {
  const { cursor, limit, status } = opts
  const activity = sql<Date>`date_trunc('milliseconds', greatest(${outer('created_at')}, (select max(f.created_at) from ${jobs} f where f.source_job_id = ${outer('id')})))`.mapWith(
    jobs.createdAt,
  )

  const where = and(
    or(isNull(jobs.sourceJobId), sql`not exists (select 1 from ${jobs} s where s.id = ${outer('source_job_id')})`),
    status
      ? or(eq(jobs.status, status), sql`exists (select 1 from ${jobs} f where f.source_job_id = ${outer('id')} and f.status = ${status})`)
      : undefined,
    // A malformed cursor reads as "from the top", not as a cast error.
    cursor && isUuid(cursor.id)
      ? sql`(${activity}, ${jobs.id}) < (${new Date(cursor.activity).toISOString()}::timestamptz, ${cursor.id}::uuid)`
      : undefined,
  )

  const rows = await db
    .select({ job: jobs, activity })
    .from(jobs)
    .where(where)
    .orderBy(desc(activity), desc(jobs.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const rootIds = page.map((r) => r.job.id)
  const followRows =
    rootIds.length > 0
      ? await db.select().from(jobs).where(inArray(jobs.sourceJobId, rootIds)).orderBy(asc(jobs.createdAt), asc(jobs.id))
      : []
  const byRoot = new Map<string, Array<Job>>()
  for (const f of followRows) {
    const list = byRoot.get(f.sourceJobId!)
    if (list) list.push(toJob(f))
    else byRoot.set(f.sourceJobId!, [toJob(f)])
  }

  const last = page.at(-1)
  return {
    jobs: page.map(({ job }) => ({ ...toJob(job), followUps: byRoot.get(job.id) ?? [] })),
    nextCursor: hasMore && last ? { activity: last.activity.getTime(), id: last.job.id } : null,
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
 * Shared insert behind `createJob` and `createJobIdempotent`. With a
 * `ticketId` the insert doubles as the trigger API's claim on the ticket:
 * `jobs_ticket_id_unique` is the arbiter among non-cancelled rows (CTD-176),
 * and losing the race comes back as null rather than an error.
 * An idempotency key (LIA-91) rides the same mechanism on
 * `jobs_idempotency_key_unique`: two concurrent first requests with one key
 * insert one row, and the loser is told null so it can re-read the winner.
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
    callbackUrl: input.callbackUrl ?? null,
    idempotencyKey: input.idempotency?.key ?? null,
    idempotencyFingerprint: input.idempotency?.fingerprint ?? null,
  })
  // No conflict target on purpose: a row may lose on either unique index
  // (ticket or key), and null means the same thing for both — someone else
  // won. The caller re-reads by key, then by ticket, to learn which.
  const [row] = ticketId || input.idempotency ? await insert.onConflictDoNothing().returning() : await insert.returning()
  if (!row) return null

  // Logs are a file now, so this line cannot ride in the insert's transaction —
  // it is written once the row is real. Losing it on a failed insert is right:
  // there would be no job for it to describe.
  const via = bp ? ` via blueprint "${bp.name}" (${bp.steps.length} steps)` : ''
  const claim = ticketId ? ` — claim for ${ticketId}` : ''
  await appendLogs(row.id, [{ stream: 'sys', text: `queued on ${row.forge}${via}${claim}` }])
  return toJob(row)
}

export async function createJob(input: NewJobInput): Promise<Job> {
  const job = await insertJob(input)
  if (!job) throw new Error('unreachable: a plain insert has no conflict to lose')
  return job
}

/**
 * The trigger API's insert (LIA-91): a plain create, or a claim on the ticket
 * when the caller named one (LIA-92 mirrors it to Linear afterwards). Null
 * means a unique index refused the row — the key's or the ticket's — and the
 * API decides which by re-reading.
 */
export async function createJobIdempotent(input: NewJobInput, ticketId?: string): Promise<Job | null> {
  return insertJob(input, ticketId)
}

/**
 * The job holding a ticket's claim, if any — how the API answers a 409.
 * Excludes cancelled rows (CTD-176): they no longer hold the claim, so a
 * cancelled job never comes back as the 409's holder, even if a cancelled and
 * an open row for the same ticket exist side by side.
 */
export async function getJobByTicketId(ticketId: string): Promise<JobRow | undefined> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.ticketId, ticketId), ne(jobs.status, 'cancelled')))
  return row
}

/**
 * The job an `Idempotency-Key` already made, with the fingerprint of the body
 * that made it so the API can tell a replay from a reuse of the key.
 */
export async function findJobByIdempotencyKey(key: string): Promise<{ job: Job; fingerprint: string } | undefined> {
  const [row] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, key))
  if (!row) return undefined
  return { job: toJob(row), fingerprint: row.idempotencyFingerprint ?? '' }
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
      followUp: src.sourceJobId ? src.followUp : null,
      prUrl: src.sourceJobId ? src.prUrl : null,
    })
    .returning()

  const via = src.blueprint ? ` via blueprint "${src.blueprint.name}" (${src.blueprint.steps.length} steps)` : ''
  await appendLogs(row.id, [
    { stream: 'sys', text: `queued on ${row.forge}${via} — rerun of ${shortId(src.id)}` },
  ])
  return toJob(row)
}

/** What each follow-up kind's task label opens with; stripped before re-prefixing a follow-up of a follow-up. */
const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  review: 'Address PR comments',
  check: 'Fix failing check',
  merge: 'Merge base into branch',
}
const LABEL_PREFIX = /^(Address PR comments|Fix failing check|Merge base into branch) — /

/** The seeded blueprint each follow-up kind runs, with its steps for when the row is gone. A review is one bare step. */
const FOLLOW_UP_BLUEPRINT: Record<FollowUp, { id: string; name: string; steps: Array<BlueprintStep> } | null> = {
  review: null,
  check: { id: CHECK_BLUEPRINT_ID, name: 'Fix failing check', steps: CHECK_BLUEPRINT_STEPS },
  merge: { id: MERGE_BLUEPRINT_ID, name: 'Merge base into branch', steps: MERGE_BLUEPRINT_STEPS },
}

/**
 * The follow-up row itself (LIA-40, CTD-170), for the detail sheet's action
 * and the PR watcher alike. It copies the source's branch *exactly* — updating
 * a PR means pushing to the branch it was opened from — and its `prUrl`, so
 * the follow-up stays runnable after the source is purged. Neither the
 * comments nor the failing log are stored: the runner fetches them fresh at
 * launch, the way repo notes are read. A `review` follow-up is one bare step;
 * a `check` one runs the seeded "Fix failing check" blueprint — `forge-debug`
 * alone — and a `merge` one "Merge base into branch" — `forge-merge` alone —
 * each snapshotted like any other, or its built-in step list if the row has
 * been deleted. `reason` is the follow-up's first log line: which review
 * or check it answers.
 */
export async function insertFollowUp(tx: Db, src: JobRow, kind: FollowUp, reason: string): Promise<Job> {
  const fallback = FOLLOW_UP_BLUEPRINT[kind]
  const bp = fallback ? await getBlueprintRow(fallback.id) : undefined
  const [row] = await tx
    .insert(jobs)
    .values({
      // One prefix, naming this follow-up's trigger — never stacked on an earlier one's.
      task: `${FOLLOW_UP_LABEL[kind]} — ${src.task.replace(LABEL_PREFIX, '')}`,
      repo: src.repo,
      repoId: src.repoId,
      baseBranch: src.baseBranch,
      branch: src.branch,
      forge: src.forge,
      blueprintId: bp?.id ?? null,
      blueprint: bp ? toSnapshot(bp) : fallback,
      sourceJobId: src.sourceJobId ?? src.id,
      followUp: kind,
      prUrl: src.prUrl,
    })
    .returning()

  const via = row.blueprint ? ` via blueprint "${row.blueprint.name}" (${row.blueprint.steps.length} steps)` : ''
  await appendLogs(row.id, [{ stream: 'sys', text: `queued on ${row.forge}${via} — ${reason}` }])
  return toJob(row)
}

/**
 * Queue a follow-up that addresses review comments on a settled job's PR
 * (LIA-40) — the detail sheet's action. Queuing one by hand also restarts the
 * PR watcher for that PR (CTD-170): its retry count goes back to zero, a
 * stopped watch resumes, a conflict it gave up on may be tried again, and its
 * review mark moves to now — the person has
 * read the reviews there are, so the watcher must not answer them a second
 * time once this job has pushed.
 */
export async function followUpJob(sourceId: string): Promise<Job> {
  const src = await getJobRow(sourceId)
  if (!src) throw new Error('that job no longer exists')
  if (OPEN.includes(src.status)) throw new Error('that job is still running — wait for its PR first')
  if (!src.prUrl) throw new Error('that job has no pull request to address comments on')
  const prUrl = src.prUrl

  return db.transaction(async (tx) => {
    const now = new Date()
    await tx
      .update(prWatches)
      .set({ followUps: 0, stopped: null, mergedBaseSha: null, reviewedAt: now, updatedAt: now })
      .where(eq(prWatches.prUrl, prUrl))
    return insertFollowUp(tx, src, 'review', `addressing PR comments of ${shortId(src.id)}`)
  })
}

/**
 * No-op unless the job is still open — a settled job keeps its outcome.
 * Returns whether this call made the transition, like `settleJob`.
 */
export async function cancelJob(id: string): Promise<boolean> {
  const [row] = await db
    .update(jobs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ['queued', 'running'])))
    .returning({ id: jobs.id })
  // Only the call that actually made the transition says so in the log.
  if (row) await appendLogs(id, [{ stream: 'sys', text: 'cancelled by user' }])
  return row !== undefined
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
  // A watch outlives its jobs only as clutter: with no row left carrying the
  // PR, nothing would ever be launched for it or read it.
  await db.delete(prWatches).where(notExists(db.select({ id: jobs.id }).from(jobs).where(eq(jobs.prUrl, prWatches.prUrl))))
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
  fields: Partial<Pick<JobRow, 'step' | 'container' | 'workspace' | 'branch' | 'baseSha' | 'startedAt' | 'exitCode'>>,
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
