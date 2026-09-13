/**
 * The base-state cache (CTD-187) against the real database: found by repo and
 * sha and nothing else, and a second measurement of the same commit replaces
 * the first. Needs the stack's Postgres: `just up postgres`. Rows are keyed
 * TEST-… and swept below.
 */
import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { db } from '@/db/client'
import { baselines } from '@/db/schema'
import { getBaseline, putBaseline } from './baseline-store'

const repo = `TEST-${randomUUID().slice(0, 8)}`
const sha = 'a'.repeat(40)
const jobA = randomUUID()
const jobB = randomUUID()

afterAll(async () => {
  await db.delete(baselines).where(like(baselines.repo, `${repo}%`))
})

test('a baseline is found by its repo and sha, and by nothing else', async () => {
  await putBaseline({ baseSha: sha, body: `# Base state: ${sha}\n`, jobId: jobA, repo })
  const row = await getBaseline(repo, sha)
  expect(row?.body).toBe(`# Base state: ${sha}\n`)
  expect(row?.jobId).toBe(jobA)
  expect(await getBaseline(repo, 'b'.repeat(40))).toBeUndefined()
  expect(await getBaseline(`${repo}-fork`, sha)).toBeUndefined()
})

test('a second measurement of the same commit replaces the first', async () => {
  await putBaseline({ baseSha: sha, body: 'measured again', jobId: jobB, repo })
  const row = await getBaseline(repo, sha)
  expect(row?.body).toBe('measured again')
  expect(row?.jobId).toBe(jobB)
})
