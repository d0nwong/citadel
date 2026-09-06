/**
 * Server functions — the only bridge between the client and the workspace on disk.
 * Each handler lazy-imports the fs reader so nothing node-only reaches the client bundle.
 *
 * Everything here reads, except the two verdicts at the bottom (`decidePoint`,
 * `sendPoint`): they write one file each under `decisions/` through server/decisions.ts,
 * the app's only writer. Nothing here is a public API — TanStack Start RPC, same as the
 * rest of the app.
 */
import { createServerFn } from '@tanstack/react-start'
import type { Decision } from '#/server/decisions'
import type { FoundryConfig, FoundryJob, JobStatus } from '#/server/foundry'
import type { PointsFile } from '#/server/workspace'
import type { UIMessage } from '@tanstack/ai'

export const getInbox = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  const dec = await import('#/server/decisions')
  const [reports, digests, points] = await Promise.all([ws.listReports(), ws.listDigests(), ws.readPoints()])
  const latestReport = reports[0]
  const latestDigest = digests[0]
  const [report, digest] = await Promise.all([
    latestReport ? ws.readReport(latestReport.day) : null,
    latestDigest ? ws.readDigest(latestDigest.day) : null,
  ])
  // The open count merges the files on disk the same way /points does, so the number
  // the Inbox shows is the number the page lists — even between sweep ticks (AC8).
  const openPoints = points ? dec.mergeDecisions(points.points, await dec.readDecisions()).filter((p) => !p.decision).length : null
  return {
    workspace: ws.WORKSPACE_DIR,
    report: report && latestReport ? { day: latestReport.day, ...report } : null,
    digest: digest && latestDigest ? { day: latestDigest.day, ...digest } : null,
    openPoints,
  }
})

export const listJournal = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  return ws.listJournal()
})

export const getJournalEntry = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const ws = await import('#/server/workspace')
    return ws.readJournalEntry(data)
  })

export const listDigests = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  return ws.listDigests()
})

export const getDigest = createServerFn({ method: 'GET' })
  .validator((day: string) => day)
  .handler(async ({ data }) => {
    const ws = await import('#/server/workspace')
    return ws.readDigest(data)
  })

export const listReports = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  return ws.listReports()
})

export const getReport = createServerFn({ method: 'GET' })
  .validator((day: string) => day)
  .handler(async ({ data }) => {
    const ws = await import('#/server/workspace')
    return ws.readReport(data)
  })

export const listDocs = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  return ws.listDocs()
})

export const getDoc = createServerFn({ method: 'GET' })
  .validator((input: { feature: string; tier: 'product' | 'arch' }) => input)
  .handler(async ({ data }) => {
    const ws = await import('#/server/workspace')
    return ws.readDoc(data.feature, data.tier)
  })

// ── points: the one write path ─────────────────────────────────────────────────

export interface PointsPage {
  file: PointsFile | null
  foundry: FoundryConfig
}

/** `points.json` with `decisions/` laid over it, plus whether Send is available (AC7). */
export const listPoints = createServerFn({ method: 'GET' }).handler(async (): Promise<PointsPage> => {
  const ws = await import('#/server/workspace')
  const dec = await import('#/server/decisions')
  const fd = await import('#/server/foundry')
  const [file, onDisk, foundry] = await Promise.all([ws.readPoints(), dec.readDecisions(), fd.foundryConfig()])
  return {
    file: file ? { ...file, points: dec.mergeDecisions(file.points, onDisk) } : null,
    foundry,
  }
})

export type Verdict = { ok: true; decision: Decision; replay?: boolean } | { ok: false; status?: number; error: string; job?: { id: string; status: JobStatus } }

const trimmed = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Ignore a point with a reason. Writes `decisions/<group>/<slug>.json` with `action: "ignored"`. */
export const decidePoint = createServerFn({ method: 'POST' })
  .validator((input: { point: string; reason: string }) => ({ point: trimmed(input.point), reason: trimmed(input.reason) }))
  .handler(async ({ data }): Promise<Verdict> => {
    const ws = await import('#/server/workspace')
    const dec = await import('#/server/decisions')
    if (!dec.isPointId(data.point)) return { ok: false, error: `"${data.point}" is not a point id` }
    if (!data.reason) return { ok: false, error: 'a reason is required to ignore a point' }
    const file = await ws.readPoints()
    const point = file?.points.find((p) => p.id === data.point)
    if (!point) return { ok: false, error: 'that point is not in reports/points.json' }
    const existing = await dec.readDecision(point.id)
    if (existing) return { ok: false, error: `already ${existing.action} on ${existing.at.slice(0, 16).replace('T', ' ')}` }
    const decision: Decision = { point: point.id, action: 'ignored', reason: data.reason, at: new Date().toISOString(), subject: point.subject }
    await dec.writeDecision(decision)
    return { ok: true, decision }
  })

/**
 * One send at a time per point, in this process: a double click reaches Foundry once and
 * writes once. Across processes the idempotency key (the point id) does the same job.
 */
const inFlight = new Map<string, Promise<Verdict>>()

/**
 * Send a point's ticket to Foundry. Exactly one `POST /api/jobs` with `{ ticketId, repo }`
 * and `Idempotency-Key: <point id>`; on 202 or 200 the decision file is written with the
 * job. A Foundry error writes nothing and comes back with its `error` text (and on 409,
 * the holding job).
 */
export const sendPoint = createServerFn({ method: 'POST' })
  .validator((input: { point: string; repo: string }) => ({ point: trimmed(input.point), repo: trimmed(input.repo) }))
  .handler(async ({ data }): Promise<Verdict> => {
    const dec = await import('#/server/decisions')
    if (!dec.isPointId(data.point)) return { ok: false, error: `"${data.point}" is not a point id` }
    if (!data.repo) return { ok: false, error: 'a repo is required — a path Foundry tracks, or its name' }
    const running = inFlight.get(data.point)
    if (running) return running
    const task = (async (): Promise<Verdict> => {
      const ws = await import('#/server/workspace')
      const fd = await import('#/server/foundry')
      const file = await ws.readPoints()
      const point = file?.points.find((p) => p.id === data.point)
      if (!point) return { ok: false, error: 'that point is not in reports/points.json' }
      if (!point.ticket) return { ok: false, error: 'that point names no ticket — file one first (the sweep\'s ticket pass)' }
      // A file already on disk is the earlier answer — a retry after a timeout that did
      // in fact land must not ask Foundry again, and must never write a second file.
      const existing = await dec.readDecision(point.id)
      if (existing) return { ok: true, decision: existing, replay: true }
      let job: FoundryJob
      let replay: boolean
      try {
        ;({ job, replay } = await fd.createJob({ ticketId: point.ticket, repo: data.repo, idempotencyKey: point.id }))
      } catch (e) {
        if (e instanceof fd.FoundryError) return { ok: false, status: e.status, error: e.message, job: e.job }
        throw e
      }
      const decision: Decision = {
        point: point.id,
        action: 'sent',
        at: new Date().toISOString(),
        subject: point.subject,
        job: { id: job.id, url: fd.jobUrl(job.id) },
      }
      await dec.writeDecision(decision)
      return { ok: true, decision, replay }
    })().finally(() => inFlight.delete(data.point))
    inFlight.set(data.point, task)
    return task
  })

export type JobLookup = { ok: true; job: FoundryJob } | { ok: false; status?: number; error: string }

/** `GET /api/jobs/:id` — the page polls this while the job is queued or running. */
export const jobStatus = createServerFn({ method: 'GET' })
  .validator((id: string) => trimmed(id))
  .handler(async ({ data }): Promise<JobLookup> => {
    const fd = await import('#/server/foundry')
    try {
      return { ok: true, job: await fd.getJob(data) }
    } catch (e) {
      if (e instanceof fd.FoundryError) return { ok: false, status: e.status, error: e.message }
      throw e
    }
  })

// ── ask spike (LIA-100, throwaway) ─────────────────────────────────────────────

/**
 * Run one Claude Code turn over the argus checkout and stream it back as SSE. The
 * handler returns a raw `Response`, which Start hands to the caller untouched, so
 * `useChat({ fetcher })` can parse the event stream itself.
 */
export const askSpike = createServerFn({ method: 'POST' })
  .validator((input: { messages: Array<UIMessage> }) => ({ messages: input.messages }))
  .handler(async ({ data }) => {
    const spike = await import('#/server/ask-spike')
    return spike.askSpikeResponse(data.messages)
  })
