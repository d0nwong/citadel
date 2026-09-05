/**
 * The trigger API against the real store and database, with the two edges
 * that would touch the world stubbed: the token (no env file) and
 * ignition (no docker). Needs the local Postgres from `bun run infra:up`.
 * Rows are keyed TEST-… / a TEST repo path and swept below.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs, repos } from '@/db/schema'
import { DEFAULT_BLUEPRINT_ID } from '@/features/blueprints/types'
import { getBlueprintRow } from '@/features/blueprints/server/blueprint-store'
import { deleteLogs } from './job-logs'
import { handleGetJob, handleTriggerJob, IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_MAX } from './job-api'
import type { ApiDeps } from './job-api'
import type { Job } from '../types'

const rand = randomUUID().slice(0, 8)
const REPO_PATH = `/tmp/foundry-test-${rand}/api-repo`
const REPO_NAME = 'api-repo'
const SECRET = `test-secret-${rand}`

const ignited: Array<string> = []
const deps: ApiDeps = {
  token: async () => SECRET,
  ignite: async (id) => void ignited.push(id),
}

const post = (body: unknown, token: string | null = SECRET, headers: Record<string, string> = {}) =>
  new Request('http://foundry.test/api/jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

/** `post` with an `Idempotency-Key`; the body is a string so two calls send byte-identical bytes. */
const postKeyed = (key: string, body: unknown) => post(body, SECRET, { [IDEMPOTENCY_HEADER]: key })

/** How many TEST- rows exist right now — the "inserted nothing" assertions diff this. */
const rowCount = async () => (await db.select({ id: jobs.id }).from(jobs).where(like(jobs.task, `TEST-${rand}%`))).length

const get = (id: string, query = '', token: string | null = SECRET) =>
  new Request(`http://foundry.test/api/jobs/${id}${query}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  })

/** A trigger payload that is valid by construction; tests override one field at a time. */
const valid = (extra: Record<string, unknown> = {}) => ({
  repo: REPO_NAME,
  instructions: `TEST-${rand}: do the thing\n\nEvery detail here.`,
  baseBranch: 'main',
  ...extra,
})

beforeAll(async () => {
  await db.insert(repos).values({ path: REPO_PATH, name: REPO_NAME }).onConflictDoNothing()
})

afterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
  await db.delete(repos).where(eq(repos.path, REPO_PATH))
})

test('no token configured → 503, and nothing is queued', async () => {
  const res = await handleTriggerJob(post(valid()), { ...deps, token: async () => undefined })
  expect(res.status).toBe(503)
  expect(ignited).toHaveLength(0)
})

test('missing or wrong bearer → 401', async () => {
  expect((await handleTriggerJob(post(valid(), null), deps)).status).toBe(401)
  expect((await handleTriggerJob(post(valid(), 'nope'), deps)).status).toBe(401)
  expect(ignited).toHaveLength(0)
})

test('bad payloads → 400 with a reason', async () => {
  const cases: Array<[unknown, RegExp]> = [
    ['not json', /invalid json/],
    [[], /JSON object/],
    [valid({ instructions: '   ' }), /instructions is required/],
    [{ instructions: 'x' }, /repo is required/],
    [valid({ repo: 42 }), /repo must be a string/],
    [valid({ ticketId: 'T'.repeat(65) }), /ticketId is too long/],
    [valid({ repo: 'no-such-repo' }), /not tracked/],
    [valid({ blueprintId: randomUUID() }), /blueprint .* does not exist/],
    [valid({ callbackUrl: 'ftp://x' }), /http or https/],
    [valid({ callbackUrl: 'not a url' }), /absolute URL/],
  ]
  for (const [body, reason] of cases) {
    const res = await handleTriggerJob(post(body), deps)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(reason)
  }
  expect(ignited).toHaveLength(0)
})

test('valid trigger → 202, a queued row on the default blueprint, ignited once', async () => {
  const res = await handleTriggerJob(post(valid({ callbackUrl: 'https://example.test/hook' })), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job

  expect(job.status).toBe('queued')
  expect(job.task).toBe(valid().instructions)
  expect(job.repo).toEqual({ kind: 'local', name: REPO_NAME, path: REPO_PATH })
  expect(job.baseBranch).toBe('main')
  expect(job.branch).toMatch(new RegExp(`^foundry/test-${rand}-do-${job.id.slice(0, 8)}$`))
  expect(job.callbackUrl).toBe('https://example.test/hook')
  // The seeded default applies unless the row is gone — the scanner's rule.
  const seeded = await getBlueprintRow(DEFAULT_BLUEPRINT_ID)
  expect(job.blueprint?.name).toBe(seeded?.name)
  expect(ignited).toEqual([job.id])

  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id))
  expect(row?.callbackUrl).toBe('https://example.test/hook')
})

test('repo by ~ path and blueprintId "none" → a bare job', async () => {
  const res = await handleTriggerJob(post(valid({ repo: REPO_PATH, blueprintId: 'none' })), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job
  expect(job.blueprint).toBeUndefined()
  expect(job.repo).toMatchObject({ path: REPO_PATH })
})

test('ticketId claims once; the second trigger is a 409 naming the holder', async () => {
  const ticketId = `TEST-${rand}`
  const first = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(first.status).toBe(202)
  const job = (await first.json()) as Job
  expect(job.ticketId).toBe(ticketId)

  const second = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(second.status).toBe(409)
  const body = (await second.json()) as { job?: { id: string; status: string } }
  expect(body.job).toEqual({ id: job.id, status: 'queued' })
})

test('AC1 — a replay with the same key and body answers 200 with the first job, ignited once', async () => {
  const key = `k1-${rand}`
  const body = JSON.stringify(valid())
  const before = await rowCount()
  const ignitedBefore = ignited.length

  const first = await handleTriggerJob(postKeyed(key, body), deps)
  expect(first.status).toBe(202)
  const job = (await first.json()) as Job

  const second = await handleTriggerJob(postKeyed(key, body), deps)
  expect(second.status).toBe(200)
  const replayed = (await second.json()) as Job
  expect(replayed.id).toBe(job.id)
  // The bare Job, as GET returns it — no log lines.
  expect('logs' in replayed).toBe(false)

  expect(await rowCount()).toBe(before + 1)
  expect(ignited.slice(ignitedBefore)).toEqual([job.id])

  const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id))
  expect(row?.idempotencyKey).toBe(key)
  expect(row?.idempotencyFingerprint).toMatch(/^[0-9a-f]{64}$/)
})

test('AC2 — the same key with a different body is a 422 naming the header, and inserts nothing', async () => {
  const key = `k2-${rand}`
  expect((await handleTriggerJob(postKeyed(key, JSON.stringify(valid())), deps)).status).toBe(202)
  const before = await rowCount()
  const ignitedBefore = ignited.length

  const other = await handleTriggerJob(postKeyed(key, JSON.stringify(valid({ baseBranch: 'develop' }))), deps)
  expect(other.status).toBe(422)
  expect(((await other.json()) as { error: string }).error).toContain(IDEMPOTENCY_HEADER)

  // Raw bytes, not parsed shape: the same object serialised differently is a different body.
  const reordered = JSON.stringify({ instructions: valid().instructions, repo: valid().repo, baseBranch: 'main' })
  expect((await handleTriggerJob(postKeyed(key, reordered), deps)).status).toBe(422)

  expect(await rowCount()).toBe(before)
  expect(ignited.length).toBe(ignitedBefore)
})

test('AC4 — an empty or over-long key is a 400 before the body is looked at', async () => {
  const before = await rowCount()
  for (const key of ['', 'k'.repeat(IDEMPOTENCY_KEY_MAX + 1)]) {
    const res = await handleTriggerJob(postKeyed(key, valid()), deps)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain(IDEMPOTENCY_HEADER)
  }
  // Exactly the cap is fine.
  expect((await handleTriggerJob(postKeyed('k'.repeat(IDEMPOTENCY_KEY_MAX), valid()), deps)).status).toBe(202)
  expect(await rowCount()).toBe(before + 1)
})

test('AC5 — a ticket job replayed with its key is 200; a different key for the ticket is still 409', async () => {
  const ticketId = `TEST-${rand}-K5`
  const key = `k5-${rand}`
  const body = JSON.stringify(valid({ ticketId }))

  const first = await handleTriggerJob(postKeyed(key, body), deps)
  expect(first.status).toBe(202)
  const job = (await first.json()) as Job
  expect(job.ticketId).toBe(ticketId)

  const replay = await handleTriggerJob(postKeyed(key, body), deps)
  expect(replay.status).toBe(200)
  expect(((await replay.json()) as Job).id).toBe(job.id)

  const other = await handleTriggerJob(postKeyed(`${key}-other`, body), deps)
  expect(other.status).toBe(409)
  expect(((await other.json()) as { job?: { id: string } }).job?.id).toBe(job.id)

  const bare = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(bare.status).toBe(409)
})

test('AC6 — two concurrent first requests with one key make one job; the loser gets 200 with the winner', async () => {
  const key = `k6-${rand}`
  const body = JSON.stringify(valid())
  const before = await rowCount()
  const ignitedBefore = ignited.length

  const [a, b] = await Promise.all([
    handleTriggerJob(postKeyed(key, body), deps),
    handleTriggerJob(postKeyed(key, body), deps),
  ])
  expect([a.status, b.status].sort()).toEqual([200, 202])
  const [ja, jb] = (await Promise.all([a.json(), b.json()])) as [Job, Job]
  expect(ja.id).toBe(jb.id)

  expect(await rowCount()).toBe(before + 1)
  expect(ignited.slice(ignitedBefore)).toEqual([ja.id])
})

test('GET returns the job, with logs only when asked', async () => {
  const created = (await (await handleTriggerJob(post(valid()), deps)).json()) as Job

  expect((await handleGetJob(created.id, get(created.id, '', null), deps)).status).toBe(401)
  expect((await handleGetJob(randomUUID(), get(randomUUID()), deps)).status).toBe(404)
  expect((await handleGetJob('not-a-uuid', get('not-a-uuid'), deps)).status).toBe(404)

  const bare = (await (await handleGetJob(created.id, get(created.id), deps)).json()) as Record<string, unknown>
  expect(bare.id).toBe(created.id)
  expect(bare.logs).toBeUndefined()

  const full = (await (await handleGetJob(created.id, get(created.id, '?logs=1'), deps)).json()) as {
    logs: Array<{ text: string }>
  }
  expect(full.logs.some((l) => l.text.startsWith('queued on orbstack'))).toBe(true)
})
