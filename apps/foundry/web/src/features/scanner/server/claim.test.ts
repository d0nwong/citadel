/**
 * The claim race: two concurrent inserts for one ticket, exactly one winner.
 * Runs against the local Postgres from `bun run infra:up` (same DATABASE_URL
 * the dev server uses, via web/.env) — real database, real unique index,
 * because the arbiter under test IS the index.
 */
import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs } from '@/db/schema'
import { deleteLogs } from '@/features/jobs/server/job-logs'
import { claimTicketJob, getJobByTicketId } from '@/features/jobs/server/job-store'
import type { NewJobInput } from '@/features/jobs/types'

/** TEST- ids can never collide with real LIA-… claims, and are swept below. */
const ticketId = () => `TEST-${randomUUID().slice(0, 8)}`

const input = (task: string): NewJobInput => ({
  task,
  // The insert touches neither disk nor docker, so the path may be fictional.
  repo: { kind: 'local', name: 'nowhere', path: '/tmp/nonexistent-scanner-test' },
  baseBranch: 'main',
  forge: 'orbstack',
})

afterAll(async () => {
  // Rows AND their sys-log files; the LIKE also sweeps leaks from aborted runs.
  const swept = await db.delete(jobs).where(like(jobs.ticketId, 'TEST-%')).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
})

test('two concurrent claims for one ticket → exactly one winner', async () => {
  const id = ticketId()
  const [a, b] = await Promise.all([
    claimTicketJob(input(`${id}: race a`), id),
    claimTicketJob(input(`${id}: race b`), id),
  ])
  const winners = [a, b].filter((j) => j !== null)
  expect(winners).toHaveLength(1)

  const row = await getJobByTicketId(id)
  expect(row?.id).toBe(winners[0]!.id)
  expect(row?.ticketId).toBe(id)
})

test('a settled claim still blocks re-claiming', async () => {
  const id = ticketId()
  const first = await claimTicketJob(input(`${id}: first`), id)
  expect(first).not.toBeNull()

  // The claim is keyed on the ticket, not on the job's liveness: only removing
  // the row (purge) frees the ticket, per the scanner's re-run contract.
  const again = await claimTicketJob(input(`${id}: again`), id)
  expect(again).toBeNull()
})
