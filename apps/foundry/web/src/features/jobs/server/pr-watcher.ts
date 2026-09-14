/**
 * Node-only. The PR watcher (CTD-170): once a job has opened a pull request,
 * the host keeps an eye on it and launches the follow-up job itself — on a
 * submitted review, with the review's comments as the task (the same job the
 * detail sheet's "Address PR comments" queues); on a failed check, with the
 * failing steps' log as the task and `forge-debug` as the one step.
 *
 * Polling, not a webhook: the Mac has no public endpoint, and a poll every
 * minute against the PRs of the last fortnight's jobs is a handful of `gh`
 * calls. Each PR is read with the host's own credentials (`forge-pr.ts`), the
 * way its comments already are; the container still holds none.
 *
 * Two rules make it safe to leave running. The same review or the same
 * commit's failed checks never launch two jobs: `pr_watches` remembers the
 * newest review answered and the head commit whose checks were, and the
 * watermark moves in the same transaction that inserts the follow-up — with
 * an optimistic guard on the launch count, so two server processes cannot
 * both launch. And a red check cannot launch forever: after
 * `FOUNDRY_PR_RETRIES` automatic follow-ups the watch stops and the root
 * job's log says so; queuing a follow-up by hand starts it over.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq, gt, inArray, isNotNull, isNull, notExists, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, prWatches } from '@/db/schema'
import { fetchPrState } from './forge-pr'
import type { PrState } from './forge-pr'
import { appendLogs } from './job-logs'
import { insertFollowUp } from './job-store'
import type { JobRow } from './job-store'
import { shortId } from '../types'
import type { Job } from '../types'

const exec = promisify(execFile)

export type WatchRow = typeof prWatches.$inferSelect

/** Automatic follow-ups per PR before the watch stops, unless FOUNDRY_PR_RETRIES says otherwise. */
export const DEFAULT_RETRIES = 3
/** Jobs settled longer ago than this are no longer watched; their PRs are somebody's by then. */
export const LOOKBACK_DAYS = 14
const POLL_SECONDS = Number(process.env.FOUNDRY_PR_POLL ?? 60)
/** The first pass runs shortly after boot, so a restart catches up without waiting a whole interval. */
const FIRST_PASS_MS = 5_000

/** Injectable edges, so the tests need neither `gh`, git nor docker. */
export interface WatcherDeps {
  /** The PR as it stands — `fetchPrState`, or a stub. */
  fetchPr: (originUrl: string, prUrl: string) => Promise<PrState>
  /** `git remote get-url origin` of the root job's checkout. */
  originUrl: (repoPath: string) => Promise<string>
  /** `startJob`, fire-and-forget. */
  ignite: (jobId: string) => Promise<void>
  maxFollowUps: number
  lookbackDays: number
  now: () => Date
  /** Which PRs this watcher may touch — every one, except in the tests, which share the dev database. */
  scope?: (prUrl: string) => boolean
}

const realDeps = (): WatcherDeps => ({
  fetchPr: fetchPrState,
  originUrl: async (repoPath) =>
    (await exec('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { timeout: 15_000 })).stdout.trim(),
  ignite: async (id) => {
    const { startJob } = await import('./job-runner')
    return startJob(id)
  },
  maxFollowUps: Number(process.env.FOUNDRY_PR_RETRIES ?? DEFAULT_RETRIES),
  lookbackDays: LOOKBACK_DAYS,
  now: () => new Date(),
})

const sys = (id: string, text: string) => appendLogs(id, [{ stream: 'sys', text }])
const err = (id: string, text: string) => appendLogs(id, [{ stream: 'err', text }])

/* ------------------------------------------------------------------ */
/* Deciding                                                           */
/* ------------------------------------------------------------------ */

export type Trigger =
  | { kind: 'review'; reason: string; reviewedAt: Date }
  | { kind: 'check'; reason: string; checkedSha: string }

/** The review states that carry feedback. An approval has nothing to address; a dismissal is withdrawn. */
const ACTIONABLE = new Set(['COMMENTED', 'CHANGES_REQUESTED'])

const stateWord = (s: string) => s.toLowerCase().replace('_', ' ')

/**
 * What the PR's state calls for, against what the watch has already answered.
 * A review first: it is a person asking. Then the checks, once every one of
 * them has finished — a forge lit on the first red check while others still
 * run would fix half the failures — and only for a head commit whose checks
 * have not launched a job yet. Pure, for the tests.
 */
export function decide(pr: PrState, watch: Pick<WatchRow, 'reviewedAt' | 'checkedSha'>): Trigger | null {
  const since = watch.reviewedAt.getTime()
  const fresh = pr.reviews.filter((r) => ACTIONABLE.has(r.state) && r.submittedAt > since)
  if (fresh.length > 0) {
    const newest = fresh.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a))
    const who = [...new Set(fresh.map((r) => `@${r.author}`))].join(', ')
    return {
      kind: 'review',
      reason: `review by ${who} (${stateWord(newest.state)}) submitted ${new Date(newest.submittedAt).toISOString()}`,
      reviewedAt: new Date(newest.submittedAt),
    }
  }

  if (pr.headSha === '' || pr.headSha === watch.checkedSha) return null
  if (pr.checks.length === 0 || pr.checks.some((c) => c.outcome === 'pending')) return null
  const failed = pr.checks.filter((c) => c.outcome === 'failed')
  if (failed.length === 0) return null
  return {
    kind: 'check',
    reason: `check ${failed.map((c) => `"${c.name}"`).join(', ')} failed on ${pr.headSha.slice(0, 7)}`,
    checkedSha: pr.headSha,
  }
}

/* ------------------------------------------------------------------ */
/* The watch rows                                                     */
/* ------------------------------------------------------------------ */

/**
 * The PRs worth a look this tick: each root job (never a follow-up — those
 * share their root's PR) that settled with a PR within the lookback, whose
 * watch has not stopped, and which has no follow-up queued or running right
 * now — a forge already on the branch will change everything the watcher
 * would otherwise act on. Oldest first, so a slow `gh` never starves one.
 */
async function watchedPrs(deps: WatcherDeps): Promise<Array<{ job: JobRow; watch: WatchRow | undefined }>> {
  const since = new Date(deps.now().getTime() - deps.lookbackDays * 86_400_000)
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        isNotNull(jobs.prUrl),
        isNull(jobs.sourceJobId),
        inArray(jobs.status, ['succeeded', 'failed']),
        gt(jobs.finishedAt, since),
        notExists(
          db
            .select({ prUrl: prWatches.prUrl })
            .from(prWatches)
            .where(and(eq(prWatches.prUrl, jobs.prUrl), isNotNull(prWatches.stopped))),
        ),
        notExists(
          db
            .select({ id: sql`o.id` })
            .from(sql`${jobs} as o`)
            .where(sql`o.pr_url = ${jobs.prUrl} and o.status in ('queued', 'running')`),
        ),
      ),
    )
    .orderBy(jobs.finishedAt)

  // One root per PR — a rerun of a root opens a PR of its own, but a
  // hand-edited row could share one; the newest root speaks for the PR then.
  const byPr = new Map<string, JobRow>()
  for (const row of rows) byPr.set(row.prUrl!, row)
  const urls = [...byPr.keys()]
  const watches = urls.length > 0 ? await db.select().from(prWatches).where(inArray(prWatches.prUrl, urls)) : []
  const watchByPr = new Map(watches.map((w) => [w.prUrl, w]))
  return [...byPr.values()].map((job) => ({ job, watch: watchByPr.get(job.prUrl!) }))
}

/**
 * First sight of a PR: its review mark starts at the root job's settle — the
 * moment the PR was opened — so a review from before the watcher existed is
 * not answered twice, and one from while the server was down is.
 */
async function ensureWatch(job: JobRow): Promise<WatchRow> {
  const [row] = await db
    .insert(prWatches)
    .values({ prUrl: job.prUrl!, jobId: job.id, reviewedAt: job.finishedAt ?? job.createdAt })
    .onConflictDoNothing()
    .returning()
  if (row) return row
  const [existing] = await db.select().from(prWatches).where(eq(prWatches.prUrl, job.prUrl!))
  return existing!
}

async function stopWatch(prUrl: string, reason: string): Promise<void> {
  await db.update(prWatches).set({ stopped: reason, updatedAt: new Date() }).where(eq(prWatches.prUrl, prUrl))
}

/**
 * The launch, in one transaction: move the watermark and spend one retry,
 * then insert the follow-up. The guard on `follow_ups` is what keeps two
 * processes from both launching — the second finds the count moved and
 * inserts nothing. Null means exactly that.
 *
 * The count alone is not enough when the other process has already
 * committed: this one listed the PR with no follow-up open, but the watch it
 * then read is the moved one, so the same commit's red check looks like a
 * fresh trigger and the count it guards on is the fresh count. So the launch
 * looks for an open follow-up on the PR first — the listing's own rule, now
 * inside the transaction. Sound without a lock: a follow-up inserted after
 * that look moved the count past the one this process read.
 */
async function launch(job: JobRow, watch: WatchRow, trigger: Trigger, now: Date): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [open] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.prUrl, watch.prUrl), inArray(jobs.status, ['queued', 'running'])))
      .limit(1)
    if (open) return null
    const mark = trigger.kind === 'review' ? { reviewedAt: trigger.reviewedAt } : { checkedSha: trigger.checkedSha }
    const [claimed] = await tx
      .update(prWatches)
      .set({ ...mark, followUps: sql`${prWatches.followUps} + 1`, updatedAt: now })
      .where(and(eq(prWatches.prUrl, watch.prUrl), eq(prWatches.followUps, watch.followUps), isNull(prWatches.stopped)))
      .returning({ prUrl: prWatches.prUrl })
    if (!claimed) return null
    return insertFollowUp(tx, job, trigger.kind, `${trigger.reason} on ${job.prUrl} — watcher follow-up of ${shortId(job.id)}`)
  })
}

/* ------------------------------------------------------------------ */
/* The tick                                                           */
/* ------------------------------------------------------------------ */

async function inspect(job: JobRow, existing: WatchRow | undefined, deps: WatcherDeps): Promise<void> {
  if (job.repo.kind !== 'local' || !job.prUrl) return
  const prUrl = job.prUrl
  const pr = await deps.fetchPr(await deps.originUrl(job.repo.path), prUrl)
  const watch = existing ?? (await ensureWatch(job))

  if (pr.state !== 'open') {
    await stopWatch(prUrl, pr.state)
    await sys(job.id, `watcher: PR ${pr.state} — no longer watching ${prUrl}`)
    return
  }

  const trigger = decide(pr, watch)
  if (!trigger) return

  if (watch.followUps >= deps.maxFollowUps) {
    await stopWatch(prUrl, 'retries')
    await err(
      job.id,
      `watcher: ${trigger.reason} — but ${deps.maxFollowUps} automatic follow-up(s) are already spent on ${prUrl} (FOUNDRY_PR_RETRIES); no longer watching it. Address it by hand, or queue "Address PR comments" to start the count over.`,
    )
    return
  }

  const follow = await launch(job, watch, trigger, deps.now())
  if (!follow) return // another process launched for this very state
  await sys(job.id, `watcher: ${trigger.reason} → follow-up ${shortId(follow.id)} (${watch.followUps + 1}/${deps.maxFollowUps})`)
  void deps.ignite(follow.id)
}

/**
 * One pass over every watched PR. A PR that cannot be read (gh down, a
 * credential gone) is skipped this tick with a console line, not a job line:
 * it would repeat every minute, and the ledger is for what happened to the
 * job, not to the poll. Nothing here throws.
 */
export async function tick(deps: WatcherDeps = realDeps()): Promise<void> {
  let targets: Array<{ job: JobRow; watch: WatchRow | undefined }>
  try {
    targets = await watchedPrs(deps)
  } catch (e) {
    console.warn(`[pr-watcher] cannot list PRs: ${e instanceof Error ? e.message : String(e)}`)
    return
  }
  for (const { job, watch } of targets) {
    if (deps.scope && !deps.scope(job.prUrl!)) continue
    try {
      await inspect(job, watch, deps)
    } catch (e) {
      console.warn(`[pr-watcher] ${job.prUrl}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/* ------------------------------------------------------------------ */
/* The loop                                                           */
/* ------------------------------------------------------------------ */

/**
 * Held on `globalThis`: vite re-evaluates this module on edit, and a second
 * interval beside the first would poll twice and race itself. The newest
 * module's `tick` replaces the old one's; `unref` keeps the timer from
 * holding a process open that has nothing else to do.
 */
const LOOP = Symbol.for('foundry.prWatcher')
type Loop = { timer: ReturnType<typeof setInterval>; busy: boolean }
const slot = globalThis as unknown as Record<symbol, Loop | undefined>

/** Start (or restart) the poll. Called from the runner's once-per-process reconcile. FOUNDRY_PR_WATCH=0 leaves it off. */
export function startPrWatcher(): void {
  if (process.env.FOUNDRY_PR_WATCH === '0') return
  const previous = slot[LOOP]
  if (previous) clearInterval(previous.timer)
  const loop: Loop = { timer: setInterval(run, POLL_SECONDS * 1000), busy: false }
  slot[LOOP] = loop
  loop.timer.unref?.()
  setTimeout(run, FIRST_PASS_MS).unref?.()

  // A tick that outlasts the interval (many PRs, a slow `gh`) is simply not
  // overlapped — the next one starts on the following beat.
  function run() {
    if (loop.busy) return
    loop.busy = true
    void tick().finally(() => {
      loop.busy = false
    })
  }
}
