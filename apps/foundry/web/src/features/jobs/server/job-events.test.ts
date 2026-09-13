/**
 * The events endpoint's baseline path (CTD-187) against the real store: a
 * container's `baseline` payload lands in the cache under the job's repo and
 * base sha and the log says so; a job with no base sha keeps its file and
 * caches nothing. Needs the stack's Postgres: `just up postgres`. Rows are
 * keyed TEST-… and swept below.
 */
import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { db } from '@/db/client'
import { baselines, jobs } from '@/db/schema'
import { getBaseline } from './baseline-store'
import { handleJobEvent } from './job-events'
import { deleteLogs, readLogs } from './job-logs'
import { createJob, getJobRow, patchJob } from './job-store'

const rand = randomUUID().slice(0, 8)
const sha = 'c'.repeat(40)

const newJob = (repoName: string) =>
  createJob({
    baseBranch: 'main',
    forge: 'orbstack',
    repo: { kind: 'local', name: repoName, path: `/tmp/foundry-test-${rand}` },
    task: `TEST-${rand}: baseline`,
  })

const post = async (id: string, body: unknown) => {
  const row = await getJobRow(id)
  if (!row) {
    throw new Error('job vanished')
  }
  return handleJobEvent(
    id,
    new Request(`http://localhost/api/jobs/${id}/events`, {
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${row.token}`, 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

afterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
  await db.delete(baselines).where(like(baselines.repo, `TEST-${rand}%`))
})

test("a baseline event is cached under the job's repo and base sha, and the log says so", async () => {
  const repoName = `TEST-${rand}-repo`
  const job = await newJob(repoName)
  await patchJob(job.id, { baseSha: sha })
  const body = `# Base state: ${sha}\n\n## test\n\`pnpm run test\` — exit 0 — 77s\n`
  const res = await post(job.id, { baseline: body, step: { index: 1, name: 'spec' } })
  expect(res.status).toBe(200)
  const row = await getBaseline(repoName, sha)
  expect(row?.body).toBe(body)
  expect(row?.jobId).toBe(job.id)
  const log = await readLogs(job.id)
  expect(log.some((l) => l.stream === 'sys' && l.text.includes(`cached for ${repoName} @ ${sha.slice(0, 7)}`))).toBe(true)
})

test('a baseline for a job with no base sha is logged and not cached', async () => {
  const repoName = `TEST-${rand}-nosha`
  const job = await newJob(repoName)
  const res = await post(job.id, { baseline: '# Base state: none\n' })
  expect(res.status).toBe(200)
  expect(await db.select().from(baselines).where(like(baselines.repo, repoName))).toHaveLength(0)
  const log = await readLogs(job.id)
  expect(log.some((l) => l.stream === 'sys' && l.text.includes('not cached'))).toBe(true)
})
