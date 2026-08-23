import { JOBS, addJob, clone, latency, stopJob } from '@/mocks/foundry-store'
import type { Job, NewJobInput } from './types'

export async function listJobs(): Promise<Array<Job>> {
  await latency(40)
  return clone([...JOBS].sort((a, b) => b.createdAt - a.createdAt))
}

export async function getJob(id: string): Promise<Job | undefined> {
  await latency(20)
  return clone(JOBS.find((j) => j.id === id))
}

export async function createJob(input: NewJobInput): Promise<Job> {
  await latency(320)
  return clone(addJob(input))
}

export async function cancelJob(id: string): Promise<void> {
  await latency(120)
  stopJob(id)
}
