/**
 * The trigger API against the real store and database, with the three edges
 * that would touch the world stubbed: the token (no env file), the tickets
 * package (no key, no network) and ignition (no docker). Needs the local
 * Postgres from `just up postgres`. Rows are keyed TEST-… / a TEST repo path
 * and swept below.
 */
import { expect } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { MissingCredentialError } from '@citadel/tickets'
import type { Ticket } from '@citadel/tickets'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db/client'
import { dbAfterAll, dbBeforeAll, dbTest } from '@/db/test-db'
import { jobs, repos } from '@/db/schema'
import { DEFAULT_BLUEPRINT_ID } from '@/features/blueprints/types'
import { getBlueprintRow } from '@/features/blueprints/server/blueprint-store'
import { deleteLogs } from './job-logs'
import { handleGetJob, handleListBlueprints, handleListRepos, handleTriggerJob, IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_MAX, ticketBrief } from './job-api'
import { cancelJob, closePrReadyJob, getJob } from './job-store'
import type { ApiDeps } from './job-api'
import type { Job, LogLine } from '../types'

const rand = randomUUID().slice(0, 8)
const REPO_PATH = `/tmp/foundry-test-${rand}/api-repo`
const REPO_NAME = 'api-repo'
/** A second tracked repo, for CTD-254 C2 — a key must be reusable against a different repo. */
const REPO2_PATH = `/tmp/foundry-test-${rand}/api-repo-2`
const REPO2_NAME = 'api-repo-2'
const SECRET = `test-secret-${rand}`

/**
 * The stubbed tickets package: every TEST- id is a known ticket except the
 * two suffixes below, which stand in for an id no provider knows and a
 * provider that is unreachable. `claimFails` flips the claim into a throw
 * for AC6.
 */
const UNKNOWN = `TEST-${rand}-UNKNOWN`
const DOWN = `TEST-${rand}-DOWN`
const issueFor = (identifier: string): Ticket => ({
  key: identifier,
  title: 'do the thing',
  url: `https://linear.app/liamai/issue/${identifier}/slug`,
  description: '## Summary\n\nEvery detail here.',
  state: { state: 'open', name: 'In Progress', provider: 'linear', url: `https://linear.app/liamai/issue/${identifier}/slug` },
})
let claimFails = false
/** Claims and ignitions in the order they happened — the claim must come first. */
const trace: Array<string> = []
const claimed: Array<string> = []

const ignited: Array<string> = []
const deps: ApiDeps = {
  token: async () => SECRET,
  tickets: {
    get: async (identifier) => {
      if (identifier === UNKNOWN) return null
      if (identifier === DOWN) throw new Error('fetch failed')
      return issueFor(identifier)
    },
    claim: async (key) => {
      if (claimFails) throw new Error('issueUpdate refused')
      claimed.push(key)
      trace.push(`claim ${key}`)
    },
    link: async () => {
      throw new Error('not used in these tests')
    },
  },
  ignite: async (id) => {
    ignited.push(id)
    trace.push(`ignite ${id}`)
  },
}
/** The same deps with no LINEAR_API_KEY configured. */
const noLinear: ApiDeps = {
  ...deps,
  tickets: { ...deps.tickets, get: async () => { throw new MissingCredentialError('LINEAR_API_KEY') } },
}

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

const listRepos = (token: string | null = SECRET) =>
  new Request('http://foundry.test/api/repos', { headers: token === null ? {} : { authorization: `Bearer ${token}` } })

const listBlueprints = (token: string | null = SECRET) =>
  new Request('http://foundry.test/api/blueprints', { headers: token === null ? {} : { authorization: `Bearer ${token}` } })

/** A trigger payload that is valid by construction; tests override one field at a time. */
const valid = (extra: Record<string, unknown> = {}) => ({
  repo: REPO_NAME,
  instructions: `TEST-${rand}: do the thing\n\nEvery detail here.`,
  baseBranch: 'main',
  ...extra,
})

dbBeforeAll(async () => {
  await db
    .insert(repos)
    .values([
      { path: REPO_PATH, name: REPO_NAME },
      { path: REPO2_PATH, name: REPO2_NAME },
    ])
    .onConflictDoNothing()
})

dbAfterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.task, `TEST-${rand}%`)).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
  await db.delete(repos).where(eq(repos.path, REPO_PATH))
  await db.delete(repos).where(eq(repos.path, REPO2_PATH))
})

dbTest('no token configured → 503, and nothing is queued', async () => {
  const res = await handleTriggerJob(post(valid()), { ...deps, token: async () => undefined })
  expect(res.status).toBe(503)
  expect(ignited).toHaveLength(0)
})

dbTest('missing or wrong bearer → 401', async () => {
  expect((await handleTriggerJob(post(valid(), null), deps)).status).toBe(401)
  expect((await handleTriggerJob(post(valid(), 'nope'), deps)).status).toBe(401)
  expect(ignited).toHaveLength(0)
})

dbTest('bad payloads → 400 with a reason', async () => {
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

dbTest('valid trigger → 202, a queued row on the default blueprint, ignited once', async () => {
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

dbTest('repo by ~ path and blueprintId "none" → a bare job', async () => {
  const res = await handleTriggerJob(post(valid({ repo: REPO_PATH, blueprintId: 'none' })), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job
  expect(job.blueprint).toBeUndefined()
  expect(job.repo).toMatchObject({ path: REPO_PATH })
})

dbTest('ticketId claims once; the second trigger is a 409 naming the holder, and claims nothing in Linear', async () => {
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
/* CTD-176 — a cancelled job releases its ticket claim                 */
/* ------------------------------------------------------------------ */

dbTest('CTD-176 C1: a cancelled job releases its ticket claim — the next trigger is 202 with a new job', async () => {
  const ticketId = `TEST-${rand}-C1`
  const first = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(first.status).toBe(202)
  const jobA = (await first.json()) as Job

  expect(await cancelJob(jobA.id)).toBe(true)

  const second = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(second.status).toBe(202)
  const jobB = (await second.json()) as Job
  expect(jobB.id).not.toBe(jobA.id)
  expect(jobB.ticketId).toBe(ticketId)
})

dbTest('CTD-176 C2: after the ticket is retriggered, the cancelled job stays cancelled with its ticketId intact', async () => {
  const ticketId = `TEST-${rand}-C2`
  const first = await handleTriggerJob(post(valid({ ticketId })), deps)
  const jobA = (await first.json()) as Job
  expect(await cancelJob(jobA.id)).toBe(true)

  const second = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(second.status).toBe(202)

  const rowA = await getJob(jobA.id)
  expect(rowA?.id).toBe(jobA.id)
  expect(rowA?.status).toBe('cancelled')
  expect(rowA?.ticketId).toBe(ticketId)
})

dbTest('CTD-176 C3: two concurrent first triggers for one ticketId still insert exactly one job', async () => {
  const ticketId = `TEST-${rand}-C3`
  const before = await rowCount()

  const [a, b] = await Promise.all([
    handleTriggerJob(post(valid({ ticketId })), deps),
    handleTriggerJob(post(valid({ ticketId })), deps),
  ])
  expect([a.status, b.status].sort()).toEqual([202, 409])
  const winner = a.status === 202 ? a : b
  const loser = a.status === 202 ? b : a
  const job = (await winner.json()) as Job
  const conflict = (await loser.json()) as { job?: { id: string; status: string } }
  expect(conflict.job?.id).toBe(job.id)

  expect(await rowCount()).toBe(before + 1)
})

/* ------------------------------------------------------------------ */
/* LIA-92 — the brief and the Linear claim from a ticketId             */
/* ------------------------------------------------------------------ */

dbTest('LIA-92 AC1/AC2 — ticketId without instructions composes the brief, claims the ticket, then ignites', async () => {
  const ticketId = `TEST-${rand}-A1`
  const res = await handleTriggerJob(post({ repo: REPO_NAME, ticketId, baseBranch: 'main' }), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job

  // The brief is the ticket: `<KEY>: <title>\n<url>\n\n<description>`.
  expect(job.task).toBe(ticketBrief(issueFor(ticketId)))
  expect(job.task).toBe(`${ticketId}: do the thing\nhttps://linear.app/liamai/issue/${ticketId}/slug\n\n## Summary\n\nEvery detail here.`)
  expect(job.ticketId).toBe(ticketId)
  expect(job.status).toBe('queued')

  // The claim came before ignition.
  expect(claimed).toContain(ticketId)
  expect(trace.indexOf(`claim ${ticketId}`)).toBeLessThan(trace.indexOf(`ignite ${job.id}`))

  const logs = await logsOf(job.id)
  expect(logs.some((l) => l.stream === 'sys' && /queued on orbstack .* — claim for /.test(l.text))).toBe(true)
  expect(logs.some((l) => l.stream === 'sys' && l.text.includes(`claimed ${ticketId} —`))).toBe(true)
})

dbTest('LIA-92 AC3 — ticketId with instructions keeps the instructions as task and still claims the ticket', async () => {
  const ticketId = `TEST-${rand}-A3`
  const res = await handleTriggerJob(post(valid({ ticketId })), deps)
  expect(res.status).toBe(202)
  const job = (await res.json()) as Job
  expect(job.task).toBe(valid().instructions)
  expect(claimed).toContain(ticketId)
  expect((await logsOf(job.id)).some((l) => l.stream === 'sys' && l.text.includes(`claimed ${ticketId} —`))).toBe(true)
})

dbTest('LIA-92 AC4 — no LINEAR_API_KEY: 503 without instructions; 202 with them, the skipped claim logged as err', async () => {
  const before = await rowCount()
  const ignitedBefore = ignited.length

  const refused = await handleTriggerJob(post({ repo: REPO_NAME, ticketId: `TEST-${rand}-A4` }), noLinear)
  expect(refused.status).toBe(503)
  expect(((await refused.json()) as { error: string }).error).toContain('no LINEAR_API_KEY in the citadel .env')
  expect(await rowCount()).toBe(before)
  expect(ignited.length).toBe(ignitedBefore)

  const ticketId = `TEST-${rand}-A4B`
  const accepted = await handleTriggerJob(post(valid({ ticketId })), noLinear)
  expect(accepted.status).toBe(202)
  const job = (await accepted.json()) as Job
  expect(job.task).toBe(valid().instructions)
  expect(ignited).toContain(job.id)
  expect(claimed).not.toContain(ticketId)
  const logs = await logsOf(job.id)
  expect(logs.some((l) => l.stream === 'err' && l.text.includes(`claim for ${ticketId} skipped`) && l.text.includes('no LINEAR_API_KEY in the citadel .env'))).toBe(true)
})

dbTest('LIA-92 AC5 — a ticketId Linear does not know is a 400 naming it, and inserts nothing', async () => {
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

dbTest('LIA-92 — the provider unreachable while fetching the ticket is a 502, and inserts nothing', async () => {
  const before = await rowCount()
  const res = await handleTriggerJob(post({ repo: REPO_NAME, ticketId: DOWN }), deps)
  expect(res.status).toBe(502)
  expect(((await res.json()) as { error: string }).error).toBe(`ticket ${DOWN} could not be fetched: fetch failed`)
  expect(await rowCount()).toBe(before)
})

dbTest('LIA-92 AC6 — a claim that fails after the insert leaves the job queued, answers 202, logs err', async () => {
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
    expect(logs.some((l) => l.stream === 'err' && l.text.includes(`claim for ${ticketId} failed: issueUpdate refused`))).toBe(true)
  } finally {
    claimFails = false
  }
})

dbTest('AC1 — a replay with the same key and body answers 200 with the first job, ignited once', async () => {
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

dbTest('AC2 — the same key with a different body is a 422 naming the header, and inserts nothing', async () => {
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

dbTest('AC4 — an empty or over-long key is a 400 before the body is looked at', async () => {
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

dbTest('AC5 — a ticket job replayed with its key is 200; a different key for the ticket is still 409', async () => {
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

dbTest('AC6 — two concurrent first requests with one key make one job; the loser gets 200 with the winner', async () => {
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

/* ------------------------------------------------------------------ */
/* CTD-254 — a cancelled job releases its idempotency key              */
/* ------------------------------------------------------------------ */

dbTest('CTD-254 AC1/AC5 — a cancelled job releases its key: re-triggering with it is 202 with a new job, and the first stays cancelled', async () => {
  const key = `k254-1-${rand}`
  const ticketId = `TEST-${rand}-K254-1`
  const body = JSON.stringify(valid({ ticketId }))

  const first = await handleTriggerJob(postKeyed(key, body), deps)
  expect(first.status).toBe(202)
  const jobA = (await first.json()) as Job

  expect(await cancelJob(jobA.id)).toBe(true)

  const second = await handleTriggerJob(postKeyed(key, body), deps)
  expect(second.status).toBe(202)
  const jobB = (await second.json()) as Job
  expect(jobB.id).not.toBe(jobA.id)
  expect(ignited).toContain(jobB.id)

  // AC5 — the first job is untouched: still cancelled, its ticketId and logs intact.
  const rowA = await getJob(jobA.id)
  expect(rowA?.status).toBe('cancelled')
  expect(rowA?.ticketId).toBe(ticketId)
  expect((await logsOf(jobA.id)).some((l) => l.text.startsWith('queued on orbstack'))).toBe(true)
})

dbTest('CTD-254 AC2 — after a cancel, the same key with a different repo is 202 with a new job, not a 422', async () => {
  const key = `k254-2-${rand}`
  const first = await handleTriggerJob(postKeyed(key, JSON.stringify(valid({ repo: REPO_NAME }))), deps)
  expect(first.status).toBe(202)
  const jobA = (await first.json()) as Job
  expect(await cancelJob(jobA.id)).toBe(true)

  const second = await handleTriggerJob(postKeyed(key, JSON.stringify(valid({ repo: REPO2_NAME }))), deps)
  expect(second.status).toBe(202)
  const jobB = (await second.json()) as Job
  expect(jobB.id).not.toBe(jobA.id)
  expect(jobB.repo).toMatchObject({ path: REPO2_PATH })
})

dbTest('CTD-254 AC3 — a job cancelled by the PR watcher closing its PR unmerged also releases its key', async () => {
  const key = `k254-3-${rand}`
  const body = JSON.stringify(valid())
  const first = await handleTriggerJob(postKeyed(key, body), deps)
  expect(first.status).toBe(202)
  const jobA = (await first.json()) as Job

  // Stand in for the watcher's own path to `cancelled`: a settled `pr_ready`
  // root whose PR closed unmerged (pr-watcher.ts calls closePrReadyJob the
  // same way once it sees the PR's state).
  await db.update(jobs).set({ status: 'pr_ready' }).where(eq(jobs.id, jobA.id))
  expect(await closePrReadyJob(jobA.id, 'closed')).toBe(true)

  const second = await handleTriggerJob(postKeyed(key, body), deps)
  expect(second.status).toBe(202)
  const jobB = (await second.json()) as Job
  expect(jobB.id).not.toBe(jobA.id)

  const rowA = await getJob(jobA.id)
  expect(rowA?.status).toBe('cancelled')
})

dbTest('CTD-254: a pr_ready job that merges keeps its key — a re-trigger with it still replays', async () => {
  const key = `k254-3m-${rand}`
  const body = JSON.stringify(valid())
  const first = await handleTriggerJob(postKeyed(key, body), deps)
  const jobA = (await first.json()) as Job

  await db.update(jobs).set({ status: 'pr_ready' }).where(eq(jobs.id, jobA.id))
  expect(await closePrReadyJob(jobA.id, 'merged')).toBe(true)

  const replay = await handleTriggerJob(postKeyed(key, body), deps)
  expect(replay.status).toBe(200)
  expect(((await replay.json()) as Job).id).toBe(jobA.id)
})

dbTest('CTD-254 AC4 — while a job is queued, running or pr_ready, re-triggering its key is still a replay', async () => {
  const key = `k254-4-${rand}`
  const body = JSON.stringify(valid())
  const before = await rowCount()

  const first = await handleTriggerJob(postKeyed(key, body), deps)
  expect(first.status).toBe(202)
  const job = (await first.json()) as Job

  // queued
  expect((await handleTriggerJob(postKeyed(key, body), deps)).status).toBe(200)

  // running
  await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job.id))
  expect((await handleTriggerJob(postKeyed(key, body), deps)).status).toBe(200)

  // pr_ready
  await db.update(jobs).set({ status: 'pr_ready' }).where(eq(jobs.id, job.id))
  const replay = await handleTriggerJob(postKeyed(key, body), deps)
  expect(replay.status).toBe(200)
  expect(((await replay.json()) as Job).id).toBe(job.id)

  expect(await rowCount()).toBe(before + 1)
})

/* ------------------------------------------------------------------ */
/* LIA-119 — GET /api/repos                                           */
/* ------------------------------------------------------------------ */

dbTest('LIA-119 AC1/AC2/AC4/AC6 — GET /api/repos lists name+path ordered by name, and every name triggers a job', async () => {
  // AC4 — the same gate as the job routes, with the same bodies.
  const noToken = await handleListRepos(listRepos(), { ...deps, token: async () => undefined })
  expect(noToken.status).toBe(503)
  expect(((await noToken.json()) as { error: string }).error).toMatch(/foundry auth --api/)
  expect((await handleListRepos(listRepos(null), deps)).status).toBe(401)
  const wrong = await handleListRepos(listRepos('nope'), deps)
  expect(wrong.status).toBe(401)
  expect(await wrong.json()).toEqual({ error: 'unauthorized' })

  // AC1 — 200, an array, each row exactly `name` and `path`, ordered by name.
  const res = await handleListRepos(listRepos(), deps)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/json')
  const rows = (await res.json()) as Array<Record<string, unknown>>
  expect(Array.isArray(rows)).toBe(true)
  expect(rows).toContainEqual({ name: REPO_NAME, path: REPO_PATH })
  // AC6 — nothing of the host's leaks: no id, notes, branch or dirty flag on any row.
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(['name', 'path'])
  const names = rows.map((r) => r.name as string)
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

  // AC2 — every returned name is one `POST /api/jobs` accepts as `repo`: no `is not tracked` 400.
  // A shared basename resolves ambiguous (a 400 the caller must answer with the
  // path, which the list also carries); only the `not tracked` refusal is the bug.
  for (const name of names) {
    const trigger = await handleTriggerJob(post(valid({ repo: name, blueprintId: 'none' })), deps)
    const body = (await trigger.json()) as { error?: string }
    expect(body.error ?? '').not.toMatch(/not tracked/)
    expect([202, 400]).toContain(trigger.status)
    if (trigger.status === 400) expect(body.error).toMatch(/ambiguous/)
  }
})

/* ------------------------------------------------------------------ */
/* GET /api/blueprints                                                */
/* ------------------------------------------------------------------ */

dbTest('GET /api/blueprints lists the blueprints ordered by name, and every id triggers a job', async () => {
  // The same gate as every other api route, with the same bodies.
  const noToken = await handleListBlueprints(listBlueprints(), { ...deps, token: async () => undefined })
  expect(noToken.status).toBe(503)
  expect((await handleListBlueprints(listBlueprints(null), deps)).status).toBe(401)
  expect(await (await handleListBlueprints(listBlueprints('nope'), deps)).json()).toEqual({ error: 'unauthorized' })

  const res = await handleListBlueprints(listBlueprints(), deps)
  expect(res.status).toBe(200)
  const rows = (await res.json()) as Array<Record<string, unknown>>
  expect(Array.isArray(rows)).toBe(true)

  const seeded = rows.find((r) => r.id === DEFAULT_BLUEPRINT_ID)
  expect(seeded).toBeDefined()
  // The steps come as one line, never as their prompts.
  expect(seeded?.summary).toMatch(/ · /)
  for (const row of rows) {
    expect(Object.keys(row).every((k) => ['id', 'name', 'description', 'version', 'summary'].includes(k))).toBe(true)
    expect(JSON.stringify(row)).not.toMatch(/\{\{task\}\}/)
  }

  const names = rows.map((r) => r.name as string)
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

  // Every id the list offers is one `POST /api/jobs` accepts as `blueprintId`.
  for (const row of rows) {
    const trigger = await handleTriggerJob(post(valid({ blueprintId: row.id })), deps)
    expect(trigger.status).toBe(202)
  }
})

dbTest('GET returns the job, with logs only when asked', async () => {
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
