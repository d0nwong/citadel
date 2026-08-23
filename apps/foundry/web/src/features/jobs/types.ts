import type { RepoRef } from '@/features/repos/types'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Where the pipeline is. The container owns agent+commit; the host owns the rest. */
export type JobStep = 'prepare' | 'agent' | 'commit' | 'push' | 'pr' | 'done'

export type LogStream = 'sys' | 'out' | 'tool' | 'err'

export interface LogLine {
  t: number
  stream: LogStream
  text: string
}

/** Timestamps are epoch milliseconds everywhere, as the rest of the app expects. */
export interface Job {
  id: string
  task: string
  repo: RepoRef
  baseBranch: string
  branch: string
  forge: string
  status: JobStatus
  step?: JobStep
  worktree: boolean
  createdAt: number
  startedAt?: number
  finishedAt?: number
  diff?: { files: number; additions: number; deletions: number }
  exitCode?: number
  prUrl?: string
}

/**
 * A job with its logs. Only the detail sheet needs these, and hauling every
 * line of every job for the ledger would be pointless — so the list returns
 * `Job` and the single fetch returns this.
 */
export interface JobDetail extends Job {
  logs: Array<LogLine>
}

export interface NewJobInput {
  task: string
  repo: RepoRef
  baseBranch: string
  forge: string
  worktree: boolean
}
