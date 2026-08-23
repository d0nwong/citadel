import { createServerFn } from '@tanstack/react-start'
import type { Job, JobDetail, NewJobInput } from './types'

/**
 * Real data — jobs live in Postgres (see src/db). The node-only store is
 * imported inside each handler so it never reaches the client bundle.
 */

export const listJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<Job>> => {
  const store = await import('./server/job-store')
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
    return store.createJob(data)
  })

export const cancelJob = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const store = await import('./server/job-store')
    await store.cancelJob(data)
  })
