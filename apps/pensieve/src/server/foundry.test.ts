import { describe, expect, test, beforeAll } from 'bun:test'

// The token is read fresh per call; set it before the module is imported so the shared
// credentials file on this machine plays no part.
process.env.FOUNDRY_API_TOKEN = 'test-token'
process.env.FOUNDRY_URL = 'http://foundry.test'

const { createJob, getJob, FoundryError } = await import('./foundry')
// Destructured from a dynamic import, `FoundryError` is a value; this is its instance type.
type FoundryErr = InstanceType<typeof FoundryError>

type Seen = { url: string; init: RequestInit }
const fake = (status: number, body: unknown, seen: Seen[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} })
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

const job = { id: '0f3a2c1e-1111-4222-8333-444455556666', status: 'queued', createdAt: 1 }

beforeAll(() => {})

describe('AC3 — one POST /api/jobs with ticketId, repo, no instructions, Idempotency-Key = point id', () => {
  test('202 is created, 200 is a replay; body and headers are exactly the contract', async () => {
    const seen: Seen[] = []
    const r = await createJob({ ticketId: 'LIA-86', repo: 'alden-portal-fe', idempotencyKey: 'decide/lia-86' }, fake(202, job, seen))
    expect(r).toEqual({ job: { id: job.id, status: 'queued', createdAt: 1 }, replay: false })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('http://foundry.test/api/jobs')
    expect(seen[0].init.method).toBe('POST')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ ticketId: 'LIA-86', repo: 'alden-portal-fe' })
    const h = seen[0].init.headers as Record<string, string>
    expect(h.authorization).toBe('Bearer test-token')
    expect(h['Idempotency-Key']).toBe('decide/lia-86')

    const again = await createJob({ ticketId: 'LIA-86', repo: 'alden-portal-fe', idempotencyKey: 'decide/lia-86' }, fake(200, { ...job, status: 'running' }))
    expect(again.replay).toBe(true)
    expect(again.job.status).toBe('running')
  })
})

describe('AC6 — a Foundry error carries its `error` text; 409 names the holding job', () => {
  test.each([
    [400, 'repo "x" is not tracked — known: a, b'],
    [401, 'unauthorized'],
    [503, 'trigger API not configured — run: foundry auth --api'],
  ])('%i', async (status, error) => {
    const p = createJob({ ticketId: 'LIA-1', repo: 'x', idempotencyKey: 'decide/x' }, fake(status, { error }))
    await expect(p).rejects.toBeInstanceOf(FoundryError)
    await p.catch((e: FoundryErr) => {
      expect(e.status).toBe(status)
      expect(e.message).toBe(error)
      expect(e.job).toBeUndefined()
    })
  })
  test('409', async () => {
    const p = createJob({ ticketId: 'LIA-1', repo: 'x', idempotencyKey: 'decide/x' }, fake(409, { error: 'ticket LIA-1 already has a job', job: { id: job.id, status: 'running' } }))
    await p.catch((e: FoundryErr) => {
      expect(e.status).toBe(409)
      expect(e.job).toEqual({ id: job.id, status: 'running' })
    })
  })
  test('a network failure is a FoundryError(0) naming the URL', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await createJob({ ticketId: 'LIA-1', repo: 'x', idempotencyKey: 'decide/x' }, down).catch((e: FoundryErr) => {
      expect(e.status).toBe(0)
      expect(e.message).toContain('http://foundry.test')
    })
  })
})

describe('AC4 — GET /api/jobs/:id', () => {
  test('returns the job slice', async () => {
    const seen: Seen[] = []
    const j = await getJob(job.id, fake(200, { ...job, status: 'succeeded', prUrl: 'https://x/pr/1', extra: 'dropped' }, seen))
    expect(seen[0].url).toBe(`http://foundry.test/api/jobs/${job.id}`)
    expect(j).toEqual({ id: job.id, status: 'succeeded', createdAt: 1, prUrl: 'https://x/pr/1' })
  })
  test('refuses an id that is not one before calling out', async () => {
    let called = false
    const spy = (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch
    await expect(getJob('../secrets', spy)).rejects.toBeInstanceOf(FoundryError)
    expect(called).toBe(false)
  })
})
