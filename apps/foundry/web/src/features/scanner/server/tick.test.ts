/**
 * One scan tick end-to-end: stubbed Linear and stubbed ignition around the
 * REAL store and database — the middle of the pipeline is exactly what runs
 * in production, so what these tests prove is the claim-before-Linear-write
 * order, the guard/mapping skips, and the conflict-repair path.
 * Needs the local Postgres from `bun run infra:up`.
 */
import { afterAll, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { like } from 'drizzle-orm'
import { db } from '@/db/client'
import { jobs } from '@/db/schema'
import { deleteLogs } from '@/features/jobs/server/job-logs'
import { claimTicketJob, getJobByTicketId, listOpenJobs } from '@/features/jobs/server/job-store'
import { scanTick } from './scanner'
import type { CandidateIssue, LinearPort } from './linear-scan'
import type { TickDeps } from './scanner'

const rand = randomUUID().slice(0, 8)
const READY = `TEST-R${rand}`
const BLOCKED = `TEST-B${rand}`
const UNMAPPED = `TEST-U${rand}`

const candidate = (identifier: string, extra: Partial<CandidateIssue> = {}): CandidateIssue => ({
  id: `uuid-${identifier}`,
  identifier,
  title: 'do the thing',
  url: `https://linear.app/liamai/issue/${identifier}/slug`,
  body: '## Summary\n\nEverything is crystal clear.',
  teamId: 'team-1',
  projectName: 'Proj',
  blockedBy: [],
  ...extra,
})

const candidates = [
  candidate(READY),
  candidate(BLOCKED, { blockedBy: [{ identifier: 'LIA-1', stateType: 'started' }] }),
  candidate(UNMAPPED, { projectName: 'Elsewhere' }),
]

function stubDeps(openSlack: number) {
  const claimed: Array<[string, string, string]> = []
  const ignited: Array<string> = []
  const linear: LinearPort = {
    fetchCandidates: async () => candidates,
    viewerId: async () => 'viewer-1',
    startedStateId: async () => 'state-started',
    claimIssue: async (issueId, assigneeId, stateId) => void claimed.push([issueId, assigneeId, stateId]),
    issueStateType: async () => 'unstarted',
  }
  const deps: TickDeps = {
    linear,
    // cwd exists, so the repoPath sanity check passes; explicit baseBranch
    // keeps the tick out of git entirely.
    readConfig: async () => ({ Proj: { repoPath: process.cwd(), baseBranch: 'main' } }),
    claimTicketJob,
    getJobByTicketId,
    listOpenJobs,
    ignite: async (id) => void ignited.push(id),
    maxJobs: openSlack,
    log: () => {},
  }
  return { deps, claimed, ignited }
}

/** Real ledger may hold real open jobs — budget the tick relative to them. */
const slack = async (n: number) => (await listOpenJobs()).length + n

afterAll(async () => {
  const swept = await db.delete(jobs).where(like(jobs.ticketId, 'TEST-%')).returning({ id: jobs.id })
  await deleteLogs(swept.map((r) => r.id))
})

test('a tick claims the ready ticket, skips blocked and unmapped, ignites the job', async () => {
  const { deps, claimed, ignited } = stubDeps(await slack(3))
  await scanTick(deps)

  const row = await getJobByTicketId(READY)
  expect(row).toBeDefined()
  expect(row!.task).toBe(
    `${READY}: do the thing\nhttps://linear.app/liamai/issue/${READY}/slug\n\n## Summary\n\nEverything is crystal clear.`,
  )
  expect(row!.branch).toStartWith('foundry/')

  // Linear write and ignition happened, exactly once, for the winner only.
  expect(claimed).toEqual([[`uuid-${READY}`, 'viewer-1', 'state-started']])
  expect(ignited).toEqual([row!.id])

  // The guard and the mapping both skipped without claiming anything.
  expect(await getJobByTicketId(BLOCKED)).toBeUndefined()
  expect(await getJobByTicketId(UNMAPPED)).toBeUndefined()
})

test('rescanning while the claim is held repairs it instead of double-claiming', async () => {
  // The claimed row from the previous test is still queued (ignition was a
  // stub) and the stub Linear still reports the ticket unstarted — the exact
  // crashed-between-insert-and-Linear-write shape the repair path covers.
  const before = await getJobByTicketId(READY)
  const { deps, claimed, ignited } = stubDeps(await slack(3))
  await scanTick(deps)

  const after = await getJobByTicketId(READY)
  expect(after!.id).toBe(before!.id) // same row — no second claim
  expect(claimed).toEqual([[`uuid-${READY}`, 'viewer-1', 'state-started']]) // write re-applied
  expect(ignited).toEqual([before!.id]) // still-queued row re-ignited
})

test('at capacity, the tick leaves every ticket alone', async () => {
  const fresh = `TEST-C${randomUUID().slice(0, 8)}`
  const { deps, claimed, ignited } = stubDeps(await slack(0))
  deps.linear.fetchCandidates = async () => [candidate(fresh)]
  await scanTick(deps)

  expect(await getJobByTicketId(fresh)).toBeUndefined()
  expect(claimed).toEqual([])
  expect(ignited).toEqual([])
})
