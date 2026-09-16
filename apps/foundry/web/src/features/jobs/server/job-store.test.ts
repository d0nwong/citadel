/**
 * The ledger's grouping (CTD-183): `listJobs` against the real store. Needs
 * the local Postgres from `just up postgres`, migrated. Rows are keyed TEST-…
 * (follow-ups carry it in their task label too) and swept below. The ledger
 * reads the whole table, so each assertion looks for this file's own groups
 * among whatever else is there.
 */
import { expect } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq, like, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { dbAfterAll, dbTest } from '@/db/test-db'
import { jobs } from '@/db/schema'
import { deleteLogs } from './job-logs'
import { createJob, followUpJob, getJobRow, insertFollowUp, listJobs, settleJob } from './job-store'
import type { FollowUp, JobGroup, JobStatus } from '../types'

const rand = randomUUID().slice(0, 8)
let n = 0

/** A settled root job with a PR of its own, as a job that opened one ends up. */
async function root(status: 'succeeded' | 'failed' | 'pr_ready' = 'succeeded') {
  n++
  const job = await createJob({
    task: `TEST-${rand}: root ${n}`,
    repo: { kind: 'local', name: 'nowhere', path: `/tmp/foundry-test-${rand}` },
    baseBranch: 'main',
    forge: 'orbstack',
  })
  await settleJob(job.id, { status, exitCode: 0, prUrl: `https://example.test/${rand}/pull/${n}` })
  // Distinct created_at milliseconds, so the ordering assertions never rest on the id tie-break.
  await Bun.sleep(5)
  return job.id
}

/** A follow-up of `rootId`, settled at once, so no queue pump anywhere picks it up. */
async function followUp(rootId: string, kind: FollowUp = 'review', status: 'succeeded' | 'failed' = 'succeeded') {
  const src = await getJobRow(rootId)
  if (!src) throw new Error('root missing')
  const job = await insertFollowUp(db, src, kind, `TEST-${rand}`)
  await settleJob(job.id, { status, exitCode: 0 })
  await Bun.sleep(5)
  return job.id
}

/** Every group, a small page at a time, the way the ledger scrolls. */
async function allGroups(status?: JobStatus): Promise<Array<JobGroup>> {
  const out: Array<JobGroup> = []
  let cursor: Parameters<typeof listJobs>[0]['cursor']
  do {
    const page = await listJobs({ cursor, limit: 7, status })
    out.push(...page.jobs)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return out
}

dbAfterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `%TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
})

dbTest('a follow-up is listed under its root, oldest first, never beside it', async () => {
  const r = await root()
  const first = await followUp(r, 'review')
  const second = await followUp(r, 'check')

  const all = await allGroups()
  const group = all.find((g) => g.id === r)
  expect(group?.followUps.map((f) => f.id)).toEqual([first, second])
  expect(group?.followUps.map((f) => f.followUp)).toEqual(['review', 'check'])
  expect(all.some((g) => g.id === first || g.id === second)).toBe(false)
})

dbTest('a follow-up whose root was purged stands as its own group', async () => {
  const r = await root()
  const orphan = await followUp(r)
  await db.delete(jobs).where(eq(jobs.id, r))

  const group = (await allGroups()).find((g) => g.id === orphan)
  expect(group?.sourceJobId).toBe(r)
  expect(group?.followUps).toEqual([])
})

dbTest('a status filter keeps a group when only a follow-up has that status', async () => {
  const r = await root('succeeded')
  await followUp(r, 'check', 'failed')

  expect((await allGroups('failed')).some((g) => g.id === r)).toBe(true)
  expect((await allGroups('succeeded')).some((g) => g.id === r)).toBe(true)
  expect((await allGroups('running')).some((g) => g.id === r)).toBe(false)
})

dbTest("a new follow-up brings its group ahead of a newer root's", async () => {
  const older = await root()
  const newer = await root()
  const position = async (id: string) => (await allGroups()).findIndex((g) => g.id === id)

  expect(await position(newer)).toBeLessThan(await position(older))
  await followUp(older)
  expect(await position(older)).toBeLessThan(await position(newer))
})

dbTest('paging a small page at a time repeats and skips no group', async () => {
  const all = await allGroups()
  const ids = all.map((g) => g.id)
  expect(new Set(ids).size).toBe(ids.length)

  const [{ roots }] = await db.execute<{ roots: number }>(sql`
    select count(*)::int as roots from ${jobs} j
     where j.source_job_id is null
        or not exists (select 1 from ${jobs} s where s.id = j.source_job_id)
  `)
  expect(ids.length).toBe(roots)
})

dbTest('CTD-230 — a follow-up can be queued from a pr_ready job, reusing its branch and PR', async () => {
  const waiting = await root('pr_ready')
  const rootRow = await getJobRow(waiting)

  const follow = await followUpJob(waiting)
  expect(follow.sourceJobId).toBe(waiting)
  expect(follow.branch).toBe(rootRow?.branch ?? 'root job missing')
  expect(follow.prUrl).toBe(rootRow?.prUrl ?? 'root job missing')
})
