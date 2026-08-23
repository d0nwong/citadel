export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type LogStream = 'sys' | 'out' | 'tool' | 'err'

export interface LogLine {
  t: number
  stream: LogStream
  text: string
}

export interface Job {
  id: string
  task: string
  repoPath: string
  repoName: string
  baseBranch: string
  branch: string
  forge: string
  status: JobStatus
  worktree: boolean
  createdAt: number
  startedAt?: number
  finishedAt?: number
  logs: Array<LogLine>
  diff?: { files: number; additions: number; deletions: number }
  exitCode?: number
}

export interface NewJobInput {
  task: string
  repoPath: string
  baseBranch: string
  forge: string
  worktree: boolean
}
