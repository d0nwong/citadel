/**
 * The trigger API against the real store and database, with the three edges
 * that would touch the world stubbed: the token (no env file), Linear (no
 * key, no network) and ignition (no docker). Needs the local Postgres from
 * `bun run infra:up`. Rows are keyed TEST-… / a TEST repo path and swept below.
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
import { ticketBrief } from './linear-link'
import type { ApiDeps } from './job-api'
import type { LinearIssue } from './linear-link'
import type { Job, LogLine } from '../types'

const rand = randomUUID().slice(0, 8)
const REPO_PATH = `/tmp/foundry-test-${rand}/api-repo`
const REPO_NAME = 'api-repo'
const SECRET = `test-secret-${rand}`
const LINEAR_KEY = `lin_api_test_${rand}`

/**
 * The stubbed Linear: every TEST- id is a known issue except the two suffixes
 * below, which stand in for an id Linear does not know and a Linear that is
 * down. `claimFails` flips the claim mutation into a throw for AC6.
 */
const UNKNOWN = `TEST-${rand}-UNKNOWN`
const DOWN = `TEST-${rand}-DOWN`
const issueFor = (identifier: string): LinearIssue => ({
  id: `uuid-${identifier}`,
  identifier,
  title: 'do the thing',
  url: `https://linear.app/liamai/issue/${identifier}/slug`,
  description: '## Summary\n\nEvery detail here.',
  teamId: 'team-1',
})
let claimFails = false
/** Claims and ignitions in the order they happened — the claim must come first. */
const trace: Array<string> = []
const claimed: Array<{ key: string; id: string; teamId: string }> = []

const ignited: Array<string> = []
const deps: ApiDeps = {
  token: async () => SECRET,
  linearKey: async () => LINEAR_KEY,
  linear: {
    fetchIssue: async (_key, identifier) => {
      if (identifier === UNKNOWN) return null
      if (identifier === DOWN) throw new Error('fetch failed')
      return issueFor(identifier)
    },
    claimTicket: async (key, issue) => {
      if (claimFails) throw new Error('issueUpdate refused')
      claimed.push({ key, id: issue.id, teamId: issue.teamId })
      trace.push(`claim ${issue.id}`)
    },
  },
  ignite: async (id) => {
    ignited.push(id)
    trace.push(`ignite ${id}`)
  },
}
/** The same deps with no LINEAR_API_KEY configured. */
const noLinear: ApiDeps = { ...deps, linearKey: async () => undefined }

const logsOf = async (id: string) =>
  ((await (await handleGetJob(id, get(id, '?logs=1'), deps)).json()) as { logs: Array<LogLine> }).logs

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
    [{ repo: REPO_NAME }, /instructions is required/], // AC7 — neither instructions nor ticketId
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
  // The seeded default applies unless the row is gone.
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

test('ticketId claims once; the second trigger is a 409 naming the holder, and claims nothing in Linear', async () => {
  const ticketId = `TEST-${rand}`
  const first = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(first.status).toBe(202)
  const job = (await first.json()) as Job
  expect(job.ticketId).toBe(ticketId)
  const claimsAfterFirst = claimed.length

  const second = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(second.status).toBe(409)
  const body = (await second.json()) as { job?: { id: string; status: string } }
  expect(body.job).toEqual({ id: job.id, status: 'queued' })
  expect(claimed.length).toBe(claimsAfterFirst)
})

/* ------------------------------------------------------------------ */
/* LIA-92 — the brief and the Linear claim from a ticketId             */
/* ------------------------------------------------------------------ */

test('LIA-92 AC1/AC2 — ticketId without instructions composes the brief, claims the ticket in Linear, then ignites', async () => {
  const ticketId = `TEST-${rand}-A1`
  const res = await handleTriggerJob(post({ repo: REPO_NAME, ticketId, baseBranch: 'main' }), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job

  // The brief is the ticket: `<KEY>: <title>\n<url>\n\n<description>`.
  expect(job.task).toBe(ticketBrief(issueFor(ticketId)))
  expect(job.task).toBe(`${ticketId}: do the thing\nhttps://linear.app/liamai/issue/${ticketId}/slug\n\n## Summary\n\nEvery detail here.`)
  expect(job.ticketId).toBe(ticketId)
  expect(job.status).toBe('queued')

  // The claim used the host key and the issue's uuid/team, and came before ignition.
  expect(claimed).toContainEqual({ key: LINEAR_KEY, id: `uuid-${ticketId}`, teamId: 'team-1' })
  expect(trace.indexOf(`claim uuid-${ticketId}`)).toBeLessThan(trace.indexOf(`ignite ${job.id}`))

  const logs = await logsOf(job.id)
  expect(logs.some((l) => l.stream === 'sys' && /queued on orbstack .* — claim for /.test(l.text))).toBe(true)
  expect(logs.some((l) => l.stream === 'sys' && l.text.includes(`claimed ${ticketId} in Linear`))).toBe(true)
})

test('LIA-92 AC3 — ticketId with instructions keeps the instructions as task and still claims in Linear', async () => {
  const ticketId = `TEST-${rand}-A3`
  const res = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job
  expect(job.task).toBe(valid().instructions)
  expect(claimed).toContainEqual({ key: LINEAR_KEY, id: `uuid-${ticketId}`, teamId: 'team-1' })
  expect((await logsOf(job.id)).some((l) => l.stream === 'sys' && l.text.includes(`claimed ${ticketId} in Linear`))).toBe(true)
})

test('LIA-92 AC4 — no LINEAR_API_KEY: 503 without instructions; 202 with them, the skipped claim logged as err', async () => {
  const before = await rowCount()
  const ignitedBefore = ignited.length

  const refused = await handleTriggerJob(post({ repo: REPO_NAME, ticketId: `TEST-${rand}-A4` }), noLinear)
  expect(refused.status).toBe(503)
  expect(((await refused.json()) as { error: string }).error).toContain('foundry auth --linear')
  expect(await rowCount()).toBe(before)
  expect(ignited.length).toBe(ignitedBefore)

  const ticketId = `TEST-${rand}-A4B`
  const accepted = await handleTriggerJob(post(valid({ ticketId })), noLinear)
  expect(accepted.status).toBe(202)
  const job = (await accepted.json()) as Job
  expect(job.task).toBe(valid().instructions)
  expect(ignited).toContain(job.id)
  expect(claimed.some((c) => c.id === `uuid-${ticketId}`)).toBe(false)
  const logs = await logsOf(job.id)
  expect(logs.some((l) => l.stream === 'err' && l.text.includes(`Linear claim for ${ticketId} skipped`) && l.text.includes('foundry auth --linear'))).toBe(true)
})

test('LIA-92 AC5 — a ticketId Linear does not know is a 400 naming it, and inserts nothing', async () => {
  const before = await rowCount()
  const ignitedBefore = ignited.length
  for (const body of [{ repo: REPO_NAME, ticketId: UNKNOWN }, valid({ ticketId: UNKNOWN })]) {
    const res = await handleTriggerJob(post(body), deps)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain(UNKNOWN)
  }
  expect(await rowCount()).toBe(before)
  expect(ignited.length).toBe(ignitedBefore)
})

test('LIA-92 — Linear unreachable while fetching the ticket is a 502, and inserts nothing', async () => {
  const before = await rowCount()
  const res = await handleTriggerJob(post({ repo: REPO_NAME, ticketId: DOWN }), deps)
  expect(res.status).toBe(502)
  expect(((await res.json()) as { error: string }).error).toMatch(/^Linear: fetch failed/)
  expect(await rowCount()).toBe(before)
})

test('LIA-92 AC6 — a Linear claim that fails after the insert leaves the job queued, answers 202, logs err', async () => {
  const ticketId = `TEST-${rand}-A6`
  claimFails = true
  try {
    const res = await handleTriggerJob(post({ repo: REPO_NAME, ticketId, baseBranch: 'main' }), deps)
    expect(res.status).toBe(202)
    const job = (await res.json()) as Job
    expect(job.status).toBe('queued')
    expect(ignited).toContain(job.id)

    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id))
    expect(row?.status).toBe('queued')
    const logs = await logsOf(job.id)
    expect(logs.some((l) => l.stream === 'err' && l.text.includes(`Linear claim for ${ticketId} failed: issueUpdate refused`))).toBe(true)
  } finally {
    claimFails = false
  }
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
