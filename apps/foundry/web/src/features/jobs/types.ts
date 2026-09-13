import type { BlueprintSnapshot } from '@/features/blueprints/types'
import type { RepoRef } from '@/features/repos/types'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Where the pipeline is. The container owns agent+commit; the host owns the rest. */
export type JobStep = 'prepare' | 'agent' | 'commit' | 'push' | 'pr' | 'done'

/**
 * What a follow-up job answers (CTD-170): `review` — the PR's review comments
 * are its task; `check` — a failed check's log is, triaged by `forge-debug`.
 */
export type FollowUp = 'review' | 'check'
export const FOLLOW_UPS = ['review', 'check'] as const satisfies ReadonlyArray<FollowUp>

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
  /** The blueprint that ran, snapshotted — absent for a plain single-step job. */
  blueprint?: BlueprintSnapshot
  /** Set when this job continues the source job's PR — see `followUp` for what it answers. */
  sourceJobId?: string
  /** Which trigger a follow-up answers; absent on a job that is not one. */
  followUp?: FollowUp
  /** Linear issue identifier (e.g. LIA-52) when the trigger API queued this job from a ticket. */
  ticketId?: string
  /** Where the host POSTs a signed `job.settled` event — set by the trigger API only. */
  callbackUrl?: string
  status: JobStatus
  step?: JobStep
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

/** Display form of a job's uuid — the short prefix, the way git shows hashes. */
export const shortId = (id: string) => id.slice(0, 8)

/** Keyset cursor for `listJobs` pagination — the last group's sort key: its latest activity (epoch ms), then its root's id. */
export interface JobCursor {
  activity: number
  id: string
}

/**
 * One ledger row (CTD-183): a root job — one that is not a follow-up, or
 * whose root was purged — with the follow-ups that continue its PR, oldest
 * first. Empty for a job nobody has followed up.
 */
export interface JobGroup extends Job {
  followUps: Array<Job>
}

export interface JobPage {
  jobs: Array<JobGroup>
  nextCursor: JobCursor | null
}

export interface NewJobInput {
  task: string
  repo: RepoRef
  baseBranch: string
  forge: string
  /** Run the task through a blueprint's steps instead of one bare `claude -p`. */
  blueprintId?: string
  /** Notify this URL when the job settles (see server/job-webhook.ts). */
  callbackUrl?: string
  /**
   * The trigger API's `Idempotency-Key` and the sha256 of the raw body it
   * arrived with (see server/job-api.ts). Stored on the row, never shown.
   */
  idempotency?: { key: string; fingerprint: string }
}
