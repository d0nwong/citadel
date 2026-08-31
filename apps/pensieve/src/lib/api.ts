/**
 * Server functions — the only bridge between the client and the workspace on disk.
 * Each handler lazy-imports the fs reader so nothing node-only reaches the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'

export const getInbox = createServerFn({ method: 'GET' }).handler(async () => {
  const ws = await import('#/server/workspace')
  const [reports, digests] = await Promise.all([ws.listReports(), ws.listDigests()])
  const latestReport = reports[0]
  const latestDigest = digests[0]
  const [report, digest] = await Promise.all([
    latestReport ? ws.readReport(latestReport.day) : null,
    latestDigest ? ws.readDigest(latestDigest.day) : null,
  ])
  return {
    workspace: ws.WORKSPACE_DIR,
    report: report && latestReport ? { day: latestReport.day, ...report } : null,
    digest: digest && latestDigest ? { day: latestDigest.day, ...digest } : null,
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
