/**
 * The PR watcher (CTD-170): the pure parts — gh/Bitbucket parsing, the
 * decision — and the tick against the real store, with the PR, git and
 * ignition stubbed. Needs the local Postgres from `just up postgres`,
 * migrated. Rows are keyed TEST-… and their PRs live on example.test, which
 * the tick's scope confines it to; both are swept below.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, prWatches } from '@/db/schema'
import { CHECK_BLUEPRINT_ID } from '@/features/blueprints/types'
import { parseBitbucketPr, parseGitHubPr, stripGhLog, tailOf } from './forge-pr'
import type { PrCheck, PrReview, PrState } from './forge-pr'
import { deleteLogs, readLogs } from './job-logs'
import { createJob, followUpJob, getJobRow, settleJob } from './job-store'
import { decide, tick } from './pr-watcher'
import type { WatcherDeps } from './pr-watcher'

const rand = randomUUID().slice(0, 8)
const PR_HOST = `https://github.com/example-test-${rand}/repo/pull/`

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

describe('parseGitHubPr', () => {
  const view = {
    state: 'OPEN',
    headRefOid: 'abc1234def',
    reviews: [
      { author: { login: 'ana' }, state: 'COMMENTED', body: 'nit', submittedAt: '2026-09-12T10:00:00Z' },
      { author: { login: 'bo' }, state: 'PENDING', body: 'draft', submittedAt: '' },
    ],
    statusCheckRollup: [
      {
        __typename: 'CheckRun',
        name: 'check',
        workflowName: 'ci',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'https://github.com/o/r/actions/runs/1/job/42',
      },
      { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'CheckRun', name: 'skip', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { __typename: 'StatusContext', context: 'deploy', state: 'ERROR', targetUrl: 'https://x.test' },
    ],
  }

  test('keeps submitted reviews and drops pending ones', () => {
    const pr = parseGitHubPr(view, 'o/r')
    expect(pr.state).toBe('open')
    expect(pr.headSha).toBe('abc1234def')
    expect(pr.reviews.map((r) => r.author)).toEqual(['ana'])
  })

  test('maps check runs and statuses, with a log ref for Actions jobs', () => {
    const pr = parseGitHubPr(view, 'o/r')
    expect(pr.checks.map((c) => [c.name, c.outcome])).toEqual([
      ['ci / check', 'failed'],
      ['lint', 'pending'],
      ['skip', 'skipped'],
      ['deploy', 'failed'],
    ])
    expect(pr.checks[0]?.log).toEqual({ kind: 'gh-job', repo: 'o/r', jobId: '42' })
    expect(pr.checks[3]?.log).toBeUndefined()
  })
})

test('parseBitbucketPr: comments are reviews, pending ones are not; statuses map to checks', () => {
  const pr = parseBitbucketPr(
    { state: 'OPEN', source: { commit: { hash: 'fff000' } } },
    [
      { created_on: '2026-09-12T10:00:00Z', user: { nickname: 'ana' }, content: { raw: 'fix this' } },
      { created_on: '2026-09-12T11:00:00Z', pending: true, content: { raw: 'draft' } },
      { created_on: '2026-09-12T12:00:00Z', deleted: true },
    ],
    [
      { state: 'FAILED', name: 'Pipeline #7', url: 'https://bitbucket.org/w/r/pipelines/results/7' },
      { state: 'INPROGRESS', name: 'other' },
      { state: 'FAILED', name: 'Pipeline - pullrequests: **', url: 'https://bitbucket.org/w/r/addon/pipelines/home#!/results/1234' },
    ],
    'w/r',
  )
  expect(pr.reviews).toHaveLength(1)
  expect(pr.reviews[0]?.state).toBe('COMMENTED')
  expect(pr.checks.map((c) => c.outcome)).toEqual(['failed', 'pending', 'failed'])
  expect(pr.checks[0]?.log).toEqual({ kind: 'bb-pipeline', repo: 'w/r', build: '7' })
  // The link shape Pipelines actually posts (alden-portal-fe #442).
  expect(pr.checks[2]?.log).toEqual({ kind: 'bb-pipeline', repo: 'w/r', build: '1234' })
})

test('stripGhLog drops the job/step columns and timestamps; tailOf keeps the end', () => {
  const raw = 'check\tRun tests\t2026-09-12T07:30:11.5806220Z error: boom\ncheck\tRun tests\t2026-09-12T07:30:12.0Z done'
  expect(stripGhLog(raw)).toBe('error: boom\ndone')
  const long = `${'x'.repeat(50)}THE END`
  expect(tailOf(long, 7)).toBe('[earlier log lines omitted]\nTHE END')
})

/* ------------------------------------------------------------------ */
/* Deciding                                                           */
/* ------------------------------------------------------------------ */

const review = (at: number, state: PrReview['state'] = 'COMMENTED', author = 'ana'): PrReview => ({
  author,
  state,
  body: 'please change',
  submittedAt: at,
})
const check = (outcome: PrCheck['outcome'], name = 'ci / check'): PrCheck => ({ name, outcome, url: '' })
const state = (over: Partial<PrState> = {}): PrState => ({ state: 'open', headSha: 'sha1', reviews: [], checks: [], ...over })
const T0 = Date.parse('2026-09-12T10:00:00Z')
const fresh = { reviewedAt: new Date(T0), checkedSha: null }

describe('decide', () => {
  test('a review submitted after the mark triggers, naming the reviewer', () => {
    const t = decide(state({ reviews: [review(T0 + 1000, 'CHANGES_REQUESTED')] }), fresh)
    expect(t?.kind).toBe('review')
    expect(t?.reason).toMatch(/@ana \(changes requested\)/)
    if (t?.kind === 'review') expect(t.reviewedAt.getTime()).toBe(T0 + 1000)
  })

  test('reviews at or before the mark, and approvals, do not', () => {
    expect(decide(state({ reviews: [review(T0)] }), fresh)).toBeNull()
    expect(decide(state({ reviews: [review(T0 + 1000, 'APPROVED')] }), fresh)).toBeNull()
  })

  test('failed checks trigger only once every check has finished', () => {
    expect(decide(state({ checks: [check('failed'), check('pending', 'lint')] }), fresh)).toBeNull()
    const t = decide(state({ checks: [check('failed'), check('passed', 'lint')] }), fresh)
    expect(t?.kind).toBe('check')
    expect(t?.reason).toMatch(/"ci \/ check" failed on sha1/)
  })

  test('a head commit whose checks already launched a job does not trigger again', () => {
    expect(decide(state({ checks: [check('failed')] }), { ...fresh, checkedSha: 'sha1' })).toBeNull()
  })

  test('green checks and no reviews: nothing to do', () => {
    expect(decide(state({ checks: [check('passed')] }), fresh)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* The tick, against the store                                        */
/* ------------------------------------------------------------------ */

let prNo = 0
/** A settled root job with a PR of its own; the PR's state is whatever `prs` holds for its URL. */
async function rootJob(): Promise<{ id: string; prUrl: string }> {
  prNo++
  const prUrl = `${PR_HOST}${prNo}`
  const job = await createJob({
    task: `TEST-${rand}: watched ${prNo}`,
    repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-watcher-test' },
    baseBranch: 'main',
    forge: 'orbstack',
  })
  await settleJob(job.id, { status: 'succeeded', exitCode: 0, prUrl })
  return { id: job.id, prUrl }
}

const prs = new Map<string, PrState>()
const ignited: Array<string> = []
const deps = (over: Partial<WatcherDeps> = {}): WatcherDeps => ({
  fetchPr: async (_origin, prUrl) => prs.get(prUrl) ?? state(),
  originUrl: async () => 'git@github.com:example/repo.git',
  ignite: async (id) => {
    ignited.push(id)
  },
  maxFollowUps: 3,
  lookbackDays: 14,
  now: () => new Date(),
  scope: (prUrl) => prUrl.startsWith(PR_HOST),
  ...over,
})

/** Follow-ups queued for a PR, oldest first. */
const followUpsOf = async (prUrl: string) =>
  (await db.select().from(jobs).where(eq(jobs.prUrl, prUrl))).filter((j) => j.sourceJobId !== null).sort((a, b) => +a.createdAt - +b.createdAt)

/** Settle every open follow-up of a PR, the way a finished forge would — the watcher skips a PR while one is open. */
async function settleFollowUps(prUrl: string) {
  for (const f of await followUpsOf(prUrl)) await settleJob(f.id, { status: 'succeeded', exitCode: 0 })
}

afterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `%TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
  await db.delete(prWatches).where(like(prWatches.prUrl, `${PR_HOST}%`))
})

test('AC1 — a submitted review launches one review follow-up on the same branch, and the ledger says why', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ reviews: [review(Date.now() + 1000, 'CHANGES_REQUESTED', 'rev')] }))
  await tick(deps())

  const [f] = await followUpsOf(root.prUrl)
  expect(f?.followUp).toBe('review')
  expect(f?.sourceJobId).toBe(root.id)
  const rootRow = await getJobRow(root.id)
  expect(f?.branch).toBe(rootRow?.branch ?? 'root job missing')
  expect(f?.blueprint).toBeNull()
  expect(f?.task).toMatch(/^Address PR comments — TEST-/)
  expect(ignited).toContain(f!.id)
  expect((await readLogs(f!.id)).some((l) => /review by @rev \(changes requested\)/.test(l.text))).toBe(true)
  expect((await readLogs(root.id)).some((l) => /watcher: review by @rev .*→ follow-up/.test(l.text))).toBe(true)
})

test('AC2 — a failed check launches one check follow-up running the "Fix failing check" blueprint', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ headSha: 'deadbeef', checks: [check('failed'), check('passed', 'lint')] }))
  await tick(deps())

  const [f] = await followUpsOf(root.prUrl)
  expect(f?.followUp).toBe('check')
  expect(f?.task).toMatch(/^Fix failing check — TEST-/)
  expect(f?.blueprint?.id).toBe(CHECK_BLUEPRINT_ID)
  expect(f?.blueprint?.steps.map((s) => s.prompt)).toEqual(['/forge-debug {{task}}'])
  expect((await readLogs(f!.id)).some((l) => /check "ci \/ check" failed on deadbee/.test(l.text))).toBe(true)
})

test('AC3 — the same review or check failure never launches two jobs', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ headSha: 'cafe01', reviews: [review(Date.now() + 1000)], checks: [check('failed')] }))

  // Two ticks at once — two server processes, say — then more after the follow-up settles.
  await Promise.all([tick(deps()), tick(deps())])
  expect(await followUpsOf(root.prUrl)).toHaveLength(1)
  await settleFollowUps(root.prUrl)
  await tick(deps())
  // The review is answered; the check on the same commit is the one thing left.
  const after = await followUpsOf(root.prUrl)
  expect(after.map((f) => f.followUp)).toEqual(['review', 'check'])
  await settleFollowUps(root.prUrl)
  await tick(deps())
  await tick(deps())
  expect(await followUpsOf(root.prUrl)).toHaveLength(2)
})

test('no second launch while a follow-up is still open on the PR', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ reviews: [review(Date.now() + 1000)] }))
  await tick(deps())
  prs.set(root.prUrl, state({ reviews: [review(Date.now() + 1000), review(Date.now() + 5000, 'COMMENTED', 'late')] }))
  await tick(deps())
  expect(await followUpsOf(root.prUrl)).toHaveLength(1)
})

test('AC4 — retries stop at the configured count and the root job\'s ledger says so', async () => {
  const root = await rootJob()
  const limited = deps({ maxFollowUps: 2 })
  for (const sha of ['s1', 's2', 's3']) {
    prs.set(root.prUrl, state({ headSha: sha, checks: [check('failed')] }))
    await tick(limited)
    await settleFollowUps(root.prUrl)
  }
  expect(await followUpsOf(root.prUrl)).toHaveLength(2)
  const [watch] = await db.select().from(prWatches).where(eq(prWatches.prUrl, root.prUrl))
  expect(watch?.stopped).toBe('retries')
  expect((await readLogs(root.id)).some((l) => l.stream === 'err' && /2 automatic follow-up\(s\) are already spent/.test(l.text))).toBe(true)

  // Stopped means stopped: a new failure launches nothing.
  prs.set(root.prUrl, state({ headSha: 's4', checks: [check('failed')] }))
  await tick(limited)
  expect(await followUpsOf(root.prUrl)).toHaveLength(2)

  // A follow-up queued by hand starts the count over.
  const manual = await followUpJob(root.id)
  await settleJob(manual.id, { status: 'succeeded', exitCode: 0 })
  prs.set(root.prUrl, state({ headSha: 's5', checks: [check('failed')] }))
  await tick(limited)
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['check', 'check', 'review', 'check'])
})

test('a merged PR stops the watch and launches nothing', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ state: 'merged', reviews: [review(Date.now() + 1000)] }))
  await tick(deps())
  expect(await followUpsOf(root.prUrl)).toHaveLength(0)
  const [watch] = await db.select().from(prWatches).where(eq(prWatches.prUrl, root.prUrl))
  expect(watch?.stopped).toBe('merged')
})

test('a review from before the PR was watched is not answered', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ reviews: [review(Date.now() - 60_000)] }))
  await tick(deps())
  expect(await followUpsOf(root.prUrl)).toHaveLength(0)
})

test('a PR that cannot be read is skipped, not fatal to the rest', async () => {
  const bad = await rootJob()
  const good = await rootJob()
  prs.set(good.prUrl, state({ reviews: [review(Date.now() + 1000)] }))
  await tick(
    deps({
      fetchPr: async (_origin, url) => {
        if (url === bad.prUrl) throw new Error('gh: HTTP 502')
        return prs.get(url) ?? state()
      },
    }),
  )
  expect(await followUpsOf(bad.prUrl)).toHaveLength(0)
  expect(await followUpsOf(good.prUrl)).toHaveLength(1)
})
