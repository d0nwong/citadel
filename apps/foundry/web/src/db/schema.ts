/**
 * The database, as Drizzle sees it. `bun run db:generate` turns edits here into
 * SQL under ./migrations, which is what actually gets committed and applied.
 *
 * Everything lives in the `foundry` schema, not `public` — the database is
 * foundry's to grow into, and keeping our objects namespaced leaves `public`
 * for the extensions that infra/postgres/init/00-init.sql installs there.
 */
import { sql } from 'drizzle-orm'
import { bigserial, index, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { RepoRef } from '../features/repos/types'

export const foundry = pgSchema('foundry')

/* Mirrors of the unions in features/jobs/types.ts. Keep them in step. */
export const jobStatus = foundry.enum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export const logStream = foundry.enum('log_stream', ['sys', 'out', 'tool', 'err'])

/**
 * Repos the user has imported — the curated set a job may target. What the
 * scanner reports about a checkout (branch, dirty, last commit) is deliberately
 * not stored: those are facts about the working tree right now, read live.
 */
export const repos = foundry.table('repos', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Feeds job ids, so they stay short and readable rather than a uuid in the UI. */
export const jobSeq = foundry.sequence('job_seq', { startWith: 1 })

/**
 * One row per job. A job *is* the run in this domain — one job, one execution —
 * so there is no separate runs table to join through.
 */
export const jobs = foundry.table(
  'jobs',
  {
    id: text('id')
      .primaryKey()
      .default(sql`'job_' || to_char(nextval('foundry.job_seq'), 'FM000000')`),
    task: text('task').notNull(),
    /** Null once the repo is un-imported; `repo` below still says what it was. */
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    /** Snapshot of the RepoRef, so a job stays readable after its repo goes away. */
    repo: jsonb('repo').$type<RepoRef>().notNull(),
    baseBranch: text('base_branch').notNull(),
    branch: text('branch').notNull(),
    forge: text('forge').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    /** Where the pipeline is: prepare | agent | commit | push | pr | done. */
    step: text('step'),
    /**
     * Per-job callback secret. Handed to the job's own container as env and
     * checked by /api/jobs/$id/events — never mapped into the Job domain type.
     */
    token: text('token')
      .notNull()
      .default(sql`encode(gen_random_bytes(24), 'hex')`),
    /** The ephemeral container (foundry-job-*), so cancel can actually kill it. */
    container: text('container'),
    /** Host path of the job's clone, kept after the job for inspection. */
    workspace: text('workspace'),
    prUrl: text('pr_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    exitCode: integer('exit_code'),
    /* Null together, or set together, when a job settles. */
    diffFiles: integer('diff_files'),
    diffAdditions: integer('diff_additions'),
    diffDeletions: integer('diff_deletions'),
  },
  (t) => [index('jobs_created_at_idx').on(t.createdAt.desc()), index('jobs_status_idx').on(t.status)],
)

/**
 * Append-only. A table rather than a JSONB column on the job because LIA-13
 * streams these in a line at a time while the job runs.
 */
export const jobLogs = foundry.table(
  'job_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    t: timestamp('t', { withTimezone: true }).notNull().defaultNow(),
    stream: logStream('stream').notNull(),
    text: text('text').notNull(),
  },
  /** `id` is the tiebreak: two lines can share a millisecond. */
  (t) => [index('job_logs_job_id_idx').on(t.jobId, t.id)],
)
