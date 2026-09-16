/**
 * The completion webhook against a real receiver (Bun.serve on an ephemeral
 * port) and the real store. Needs the stack's Postgres: `just up postgres`.
 */
import { expect } from 'bun:test'
import { createHmac, randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { db } from '@/db/client'
import { dbAfterAll, dbTest } from '@/db/test-db'
import { jobs } from '@/db/schema'
import { deleteLogs, readLogs } from './job-logs'
import { createJob, getJob, settleJob } from './job-store'
import { EVENT_HEADER, PR_CLOSED_EVENT, SIGNATURE_HEADER, notifyCallback, notifyPrClosed } from './job-webhook'
import type { PrClosedEvent, SettledEvent, WebhookDeps } from './job-webhook'

const rand = randomUUID().slice(0, 8)
const SECRET = `hook-secret-${rand}`

interface Hit {
  body: string
  headers: Headers
}

/** A receiver that answers with the next status in `script`, 200 once the script runs out. */
function receiver(script: Array<number | 'hang'> = []) {
  const hits: Array<Hit> = []
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      hits.push({ body: await req.text(), headers: req.headers })
      const next = script.shift() ?? 200
      if (next === 'hang') return new Promise<Response>(() => {})
      return new Response('', { status: next })
    },
  })
  return { hits, url: `http://127.0.0.1:${server.port}/hook`, stop: () => server.stop(true) }
}

const deps = (fast = true): WebhookDeps => ({
  fetch: globalThis.fetch,
  secret: async () => SECRET,
  retryDelays: fast ? [10, 10] : [1_000, 5_000],
  timeoutMs: 300,
})

const settledJob = async (callbackUrl: string) => {
  const job = await createJob({
    task: `TEST-${rand}: hook`,
    repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-webhook-test' },
    baseBranch: 'main',
    forge: 'orbstack',
    callbackUrl,
  })
  await settleJob(job.id, { status: 'succeeded', exitCode: 0, prUrl: 'https://example.test/pr/1' })
  return job.id
}

dbAfterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
})

dbTest('delivers one signed job.settled event and logs it', async () => {
  const r = receiver()
  try {
    const id = await settledJob(r.url)
    await notifyCallback(id, deps())

    expect(r.hits).toHaveLength(1)
    const hit = r.hits[0]!
    expect(hit.headers.get(EVENT_HEADER)).toBe('job.settled')
    const expected = `sha256=${createHmac('sha256', SECRET).update(hit.body).digest('hex')}`
    expect(hit.headers.get(SIGNATURE_HEADER)).toBe(expected)

    const event = JSON.parse(hit.body) as SettledEvent
    expect(event.event).toBe('job.settled')
    expect(event.job.id).toBe(id)
    expect(event.job.status).toBe('succeeded')
    expect(event.job.prUrl).toBe('https://example.test/pr/1')
    expect('logs' in event.job).toBe(false)

    const logs = await readLogs(id)
    expect(logs.some((l) => l.stream === 'sys' && /callback delivered/.test(l.text))).toBe(true)
  } finally {
    r.stop()
  }
})

dbTest('retries through failures, succeeds on the third attempt', async () => {
  const r = receiver([500, 503])
  try {
    const id = await settledJob(r.url)
    await notifyCallback(id, deps())
    expect(r.hits).toHaveLength(3)
    const logs = await readLogs(id)
    expect(logs.some((l) => l.stream === 'sys' && /attempt 3/.test(l.text))).toBe(true)
  } finally {
    r.stop()
  }
})

dbTest('a receiver that never answers costs an err line, never the status', async () => {
  const r = receiver(['hang', 'hang', 'hang'])
  try {
    const id = await settledJob(r.url)
    await notifyCallback(id, deps())
    expect(r.hits).toHaveLength(3)
    const logs = await readLogs(id)
    expect(logs.some((l) => l.stream === 'err' && /failed after 3 attempts/.test(l.text))).toBe(true)
    expect((await getJob(id))?.status).toBe('succeeded')
  } finally {
    r.stop()
  }
})

dbTest('a job without a callback is a no-op', async () => {
  const job = await createJob({
    task: `TEST-${rand}: no hook`,
    repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-webhook-test' },
    baseBranch: 'main',
    forge: 'orbstack',
  })
  await settleJob(job.id, { status: 'failed' })
  let calls = 0
  await notifyCallback(job.id, { ...deps(), fetch: async () => (calls++, new Response()) })
  expect(calls).toBe(0)
})

dbTest('notifyPrClosed delivers one signed job.pr_closed event naming the job and the PR state', async () => {
  const r = receiver()
  try {
    const id = await settledJob(r.url)
    await notifyPrClosed(id, 'merged', deps())

    expect(r.hits).toHaveLength(1)
    const hit = r.hits[0]!
    expect(hit.headers.get(EVENT_HEADER)).toBe('job.pr_closed')
    const expected = `sha256=${createHmac('sha256', SECRET).update(hit.body).digest('hex')}`
    expect(hit.headers.get(SIGNATURE_HEADER)).toBe(expected)

    const event = JSON.parse(hit.body) as PrClosedEvent
    expect(event.event).toBe(PR_CLOSED_EVENT)
    expect(event.job.id).toBe(id)
    expect(event.job.status).toBe('succeeded')
    expect(event.prState).toBe('merged')
    expect('logs' in event.job).toBe(false)

    const logs = await readLogs(id)
    expect(logs.some((l) => l.stream === 'sys' && /callback delivered/.test(l.text))).toBe(true)
  } finally {
    r.stop()
  }
})

dbTest('notifyPrClosed retries through failures, succeeds on the third attempt', async () => {
  const r = receiver([500, 503])
  try {
    const id = await settledJob(r.url)
    await notifyPrClosed(id, 'closed', deps())
    expect(r.hits).toHaveLength(3)
    const logs = await readLogs(id)
    expect(logs.some((l) => l.stream === 'sys' && /attempt 3/.test(l.text))).toBe(true)
  } finally {
    r.stop()
  }
})

dbTest('notifyPrClosed on a job without a callback is a no-op', async () => {
  const job = await createJob({
    task: `TEST-${rand}: no hook pr_closed`,
    repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-webhook-test' },
    baseBranch: 'main',
    forge: 'orbstack',
  })
  await settleJob(job.id, { status: 'succeeded' })
  let calls = 0
  await notifyPrClosed(job.id, 'merged', { ...deps(), fetch: async () => (calls++, new Response()) })
  expect(calls).toBe(0)
})
