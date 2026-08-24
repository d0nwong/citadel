import { createServerFn } from '@tanstack/react-start'
import type { Job, JobDetail, NewJobInput } from './types'

/**
 * Real data — jobs live in Postgres (see src/db). The node-only store is
 * imported inside each handler so it never reaches the client bundle.
 */

export const listJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<Job>> => {
  const store = await import('./server/job-store')
  const runner = await import('./server/job-runner')
  // Lazy reconciliation: the ledger polls every second, so a restarted server
  // re-adopts (or fails over) in-flight jobs on its first breath.
  void runner.ensureReconciled()
  return store.listJobs()
})

export const getJob = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<JobDetail | undefined> => {
    const store = await import('./server/job-store')
    return store.getJob(data)
  })

export const createJob = createServerFn({ method: 'POST' })
  .validator((input: NewJobInput) => input)
  .handler(async ({ data }): Promise<Job> => {
    const store = await import('./server/job-store')
    const runner = await import('./server/job-runner')
    const job = await store.createJob(data)
    // Fire and forget: Ignite returns as soon as the row exists, and the
    // ledger's 1s poll watches the pipeline advance from there.
    void runner.startJob(job.id)
    return job
  })

export const rerunJob = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data }): Promise<Job> => {
    const store = await import('./server/job-store')
    const runner = await import('./server/job-runner')
    const job = await store.rerunJob(data)
    // Same fire-and-forget as createJob — the ledger's poll picks it up.
    void runner.startJob(job.id)
    return job
  })

export const cancelJob = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    // The runner kills the container first, then the store's guarded
    // transition records the cancel.
    const runner = await import('./server/job-runner')
    await runner.cancelJob(data)
  })

export const purgeJobs = createServerFn({ method: 'POST' }).handler(async (): Promise<{ count: number }> => {
  const store = await import('./server/job-store')
  const count = await store.purgeJobs()
  return { count }
})
