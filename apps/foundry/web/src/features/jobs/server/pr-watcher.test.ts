/**
 * The PR watcher (CTD-170): the pure parts — gh/Bitbucket parsing, the
 * decision — and the tick against the real store, with the PR, git and
 * ignition stubbed. Needs the local Postgres from `just up postgres`,
 * migrated. Rows are keyed TEST-… and their PRs live on example.test, which
 * the tick's scope confines it to; both are swept below.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, prWatches } from '@/db/schema'
import { CHECK_BLUEPRINT_ID, MERGE_BLUEPRINT_ID } from '@/features/blueprints/types'
import { parseBitbucketPr, parseGitHubPr, parseMergeTree, probeMerge, stripGhLog, tailOf } from './forge-pr'
import type { MergeProbe, PrCheck, PrReview, PrState } from './forge-pr'
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

describe('merge probe (CTD-214)', () => {
  test('parseMergeTree reads the conflicted paths after the tree oid', () => {
    expect(parseMergeTree('4b825dc\nsrc/a.ts\nsrc/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(parseMergeTree('4b825dc\nsrc/a.ts\n\nAuto-merging src/a.ts')).toEqual(['src/a.ts'])
    expect(parseMergeTree('4b825dc')).toEqual([])
  })

  // A bare origin and a checkout of it, as any provider's would be: the probe
  // reads git, never the forge (AC9).
  test('probeMerge finds a conflict on origin without touching the checkout', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'probe-'))
    const g = (cwd: string, ...args: Array<string>) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
    try {
      const origin = path.join(dir, 'origin.git')
      const seed = path.join(dir, 'seed')
      g(dir, 'init', '--bare', '-b', 'main', origin)
      g(dir, 'clone', origin, seed)
      writeFileSync(path.join(seed, 'a.txt'), 'one\n')
      g(seed, 'add', '.')
      g(seed, 'commit', '-m', 'base')
      g(seed, 'push', 'origin', 'main')
      const checkout = path.join(dir, 'checkout')
      g(dir, 'clone', origin, checkout)

      g(seed, 'checkout', '-b', 'feat')
      writeFileSync(path.join(seed, 'a.txt'), 'feature\n')
      g(seed, 'commit', '-am', 'feat')
      g(seed, 'push', 'origin', 'feat')
      expect((await probeMerge(checkout, 'main', 'feat')).conflicts).toEqual([])

      g(seed, 'checkout', 'main')
      writeFileSync(path.join(seed, 'a.txt'), 'main\n')
      g(seed, 'commit', '-am', 'main moves')
      g(seed, 'push', 'origin', 'main')
      const head = g(checkout, 'rev-parse', 'HEAD')

      const probe = await probeMerge(checkout, 'main', 'feat')
      expect(probe.conflicts).toEqual(['a.txt'])
      expect(probe.baseSha).toBe(g(seed, 'rev-parse', 'main'))
      expect(probe.headSha).toBe(g(seed, 'rev-parse', 'feat'))
      expect(g(checkout, 'rev-parse', 'HEAD')).toBe(head)
      expect(g(checkout, 'status', '--porcelain')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
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
const fresh = { reviewedAt: new Date(T0), checkedSha: null, mergedBaseSha: null }
const clean = { baseBranch: 'main', baseSha: 'base1', headSha: 'sha1', conflicts: [] }
const conflict = (baseSha = 'base1', headSha = 'sha1') => ({ ...clean, baseSha, headSha, conflicts: ['src/a.ts', 'src/b.ts'] })

describe('decide', () => {
  test('a review submitted after the mark triggers, naming the reviewer', () => {
    const t = decide(state({ reviews: [review(T0 + 1000, 'CHANGES_REQUESTED')] }), fresh, null)
    expect(t?.kind).toBe('review')
    expect(t?.reason).toMatch(/@ana \(changes requested\)/)
    if (t?.kind === 'review') expect(t.reviewedAt.getTime()).toBe(T0 + 1000)
  })

  test('reviews at or before the mark, and approvals, do not', () => {
    expect(decide(state({ reviews: [review(T0)] }), fresh, null)).toBeNull()
    expect(decide(state({ reviews: [review(T0 + 1000, 'APPROVED')] }), fresh, null)).toBeNull()
  })

  test('failed checks trigger only once every check has finished', () => {
    expect(decide(state({ checks: [check('failed'), check('pending', 'lint')] }), fresh, null)).toBeNull()
    const t = decide(state({ checks: [check('failed'), check('passed', 'lint')] }), fresh, null)
    expect(t?.kind).toBe('check')
    expect(t?.reason).toMatch(/"ci \/ check" failed on sha1/)
  })

  test('a head commit whose checks already launched a job does not trigger again', () => {
    expect(decide(state({ checks: [check('failed')] }), { ...fresh, checkedSha: 'sha1' }, null)).toBeNull()
  })

  test('a conflict with the base triggers a merge, naming the base commit and the files', () => {
    const t = decide(state(), fresh, conflict('abcdef123'))
    expect(t?.kind).toBe('merge')
    expect(t?.reason).toBe('branch conflicts with main @ abcdef1 in src/a.ts, src/b.ts')
    expect(decide(state(), fresh, clean)).toBeNull()
  })

  test('a base whose conflict was answered does not trigger again; a moved base does', () => {
    const answered = { ...fresh, mergedBaseSha: 'base1' }
    expect(decide(state(), answered, conflict('base1'))).toBeNull()
    expect(decide(state(), answered, conflict('base2'))?.kind).toBe('merge')
  })

  test('a review comes before a conflict, and a conflict before a red check', () => {
    expect(decide(state({ reviews: [review(T0 + 1000)] }), fresh, conflict())?.kind).toBe('review')
    expect(decide(state({ checks: [check('failed')] }), fresh, conflict())?.kind).toBe('merge')
    expect(decide(state({ checks: [check('pending')] }), fresh, conflict())?.kind).toBe('merge')
  })

  test("after a merge, the pre-merge head's red check does not trigger", () => {
    const merged = { ...fresh, mergedBaseSha: 'base1', checkedSha: 'sha1' }
    expect(decide(state({ checks: [check('failed')] }), merged, conflict())).toBeNull()
    expect(decide(state({ headSha: 'sha2', checks: [check('failed')] }), merged, clean)?.kind).toBe('check')
  })

  test('green checks and no reviews: nothing to do', () => {
    expect(decide(state({ checks: [check('passed')] }), fresh, null)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* The tick, against the store                                        */
/* ------------------------------------------------------------------ */

let prNo = 0
/** A settled root job with a PR of its own; the PR's state is whatever `prs` holds for its URL. */
async function rootJob(status: 'succeeded' | 'failed' | 'pr_ready' = 'succeeded'): Promise<{ id: string; prUrl: string }> {
  prNo++
  const prUrl = `${PR_HOST}${prNo}`
  const job = await createJob({
    task: `TEST-${rand}: watched ${prNo}`,
    repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-watcher-test' },
    baseBranch: 'main',
    forge: 'orbstack',
  })
  await settleJob(job.id, { status, exitCode: 0, prUrl })
  branchPr.set(job.branch, prUrl)
  return { id: job.id, prUrl }
}

const prs = new Map<string, PrState>()
/** The dry-run merge each PR's branch gives, by PR URL; clean when unset. */
const merges = new Map<string, MergeProbe>()
const branchPr = new Map<string, string>()
const ignited: Array<string> = []
const deps = (over: Partial<WatcherDeps> = {}): WatcherDeps => ({
  fetchPr: async (_origin, prUrl) => prs.get(prUrl) ?? state(),
  probeMerge: async (_repo, _base, branch) => merges.get(branchPr.get(branch) ?? '') ?? { baseSha: 'base0', headSha: 'sha1', conflicts: [] },
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

test('AC1 (CTD-229) — a pass that reads the job list before another pass\'s follow-up commits, and the watch after, still launches at most one follow-up', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ headSha: 'cafe01', reviews: [review(Date.now() + 1000)], checks: [check('failed')] }))

  // Force the exact interleaving the flake needs, instead of hoping
  // Promise.all lands on it: this pass reads the job list (the follow-up
  // does not exist yet), then — via the hook, before it reads the watch —
  // a whole separate pass runs to completion and launches the review
  // follow-up. This pass then reads the *moved* watch, decides the check
  // trigger (a different one — the mark that stopped the review does not
  // stop it), and must still be blocked: a follow-up is already queued.
  await tick(deps({ betweenListAndWatches: () => tick(deps()) }))

  const after = await followUpsOf(root.prUrl)
  expect(after).toHaveLength(1)
  expect(after[0]?.followUp).toBe('review')
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

test('CTD-230 — a pr_ready root is watched exactly as a succeeded one is', async () => {
  const root = await rootJob('pr_ready')
  prs.set(root.prUrl, state({ reviews: [review(Date.now() + 1000, 'CHANGES_REQUESTED', 'rev')] }))
  await tick(deps())

  const [f] = await followUpsOf(root.prUrl)
  expect(f?.followUp).toBe('review')
  expect(f?.sourceJobId).toBe(root.id)
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

/* ------------------------------------------------------------------ */
/* Conflicts (CTD-214)                                                */
/* ------------------------------------------------------------------ */

const probe = (baseSha: string, headSha: string, conflicts = ['src/a.ts']): MergeProbe => ({ baseSha, headSha, conflicts })

test('CTD-214 AC1 — a conflict launches one merge follow-up running the seeded blueprint, and the root ledger names the base', async () => {
  const root = await rootJob()
  merges.set(root.prUrl, probe('b4se000111', 'sha1'))
  await tick(deps())

  const [f] = await followUpsOf(root.prUrl)
  expect(f?.followUp).toBe('merge')
  expect(f?.task).toMatch(/^Merge base into branch — TEST-/)
  expect(f?.blueprint?.id).toBe(MERGE_BLUEPRINT_ID)
  expect(f?.blueprint?.steps.map((s) => s.prompt)).toEqual(['/forge-merge {{task}}'])
  expect(ignited).toContain(f!.id)
  expect((await readLogs(root.id)).some((l) => /watcher: branch conflicts with main @ b4se000 in src\/a\.ts → follow-up/.test(l.text))).toBe(true)
})

test('CTD-214 AC4 — the same base launches one merge; a moved base that conflicts again launches another', async () => {
  const root = await rootJob()
  merges.set(root.prUrl, probe('base1', 'sha1'))
  await tick(deps())
  await settleFollowUps(root.prUrl)
  // The merge gave up: head and base are where they were.
  await tick(deps())
  expect(await followUpsOf(root.prUrl)).toHaveLength(1)

  merges.set(root.prUrl, probe('base2', 'sha2'))
  await tick(deps())
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['merge', 'merge'])
})

test('CTD-214 AC5 — a review and a conflict: the review first, the conflict on a later tick', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ reviews: [review(Date.now() + 1000)] }))
  merges.set(root.prUrl, probe('base1', 'sha1'))
  await tick(deps())
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['review'])
  await tick(deps()) // the review follow-up is still open: nothing
  expect(await followUpsOf(root.prUrl)).toHaveLength(1)
  await settleFollowUps(root.prUrl)
  await tick(deps())
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['review', 'merge'])
})

test('CTD-214 AC6 — a conflict and a red check: the merge first, the check only for a head pushed after it', async () => {
  const root = await rootJob()
  prs.set(root.prUrl, state({ headSha: 'sha1', checks: [check('failed')] }))
  merges.set(root.prUrl, probe('base1', 'sha1'))
  await tick(deps())
  await settleFollowUps(root.prUrl)
  await tick(deps()) // the merge gave up: the old head's red check stays unanswered
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['merge'])

  prs.set(root.prUrl, state({ headSha: 'sha2', checks: [check('failed')] }))
  merges.set(root.prUrl, probe('base1', 'sha2', []))
  await tick(deps())
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['merge', 'check'])
})

test('CTD-214 — queuing a follow-up by hand lets a merge that gave up be tried again', async () => {
  const root = await rootJob()
  merges.set(root.prUrl, probe('base1', 'sha1'))
  await tick(deps())
  await settleFollowUps(root.prUrl)
  const manual = await followUpJob(root.id)
  await settleJob(manual.id, { status: 'succeeded', exitCode: 0 })
  await tick(deps())
  expect((await followUpsOf(root.prUrl)).map((f) => f.followUp)).toEqual(['merge', 'review', 'merge'])
})

test('CTD-214 AC7 — merges count against the budget, and the ledger names the conflict at exhaustion', async () => {
  const root = await rootJob()
  const limited = deps({ maxFollowUps: 1 })
  merges.set(root.prUrl, probe('base1', 'sha1'))
  await tick(limited)
  await settleFollowUps(root.prUrl)
  merges.set(root.prUrl, probe('base2', 'sha1'))
  await tick(limited)
  expect(await followUpsOf(root.prUrl)).toHaveLength(1)
  expect(
    (await readLogs(root.id)).some((l) => l.stream === 'err' && /branch conflicts with main @ base2 .*1 automatic follow-up\(s\) are already spent/.test(l.text)),
  ).toBe(true)
})
