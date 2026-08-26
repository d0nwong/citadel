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
import type { BlueprintSnapshot, BlueprintStep } from '../features/blueprints/types'
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
  /**
   * Free-text standing instructions for this repo — conventions, the package
   * manager, what to verify with, anything a job should know before it plans.
   * Handed to the agent as system prompt at launch, never committed anywhere:
   * this is the place for preferences that do not belong in the repo's own
   * CLAUDE.md (which the agent already reads from the checkout).
   */
  notes: text('notes'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Reusable multi-step recipes (LIA-25): an ordered list of `{name, model,
 * effort?, prompt}`. Kept as one jsonb column rather than a steps table —
 * a blueprint is edited and consumed whole, and a job snapshots it anyway.
 */
export const blueprints = foundry.table('blueprints', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull().unique(),
  description: text('description'),
  steps: jsonb('steps').$type<Array<BlueprintStep>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One row per job. A job *is* the run in this domain — one job, one execution —
 * so there is no separate runs table to join through. Ids are uuids; the UI
 * renders the short prefix the way git renders short hashes.
 */
export const jobs = foundry.table(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    task: text('task').notNull(),
    /** Null once the repo is un-imported; `repo` below still says what it was. */
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    /** Snapshot of the RepoRef, so a job stays readable after its repo goes away. */
    repo: jsonb('repo').$type<RepoRef>().notNull(),
    baseBranch: text('base_branch').notNull(),
    branch: text('branch').notNull(),
    forge: text('forge').notNull(),
    /** Null once the blueprint is deleted; `blueprint` below still says what ran. */
    blueprintId: uuid('blueprint_id').references(() => blueprints.id, { onDelete: 'set null' }),
    /** Snapshot of the steps that ran — null for a plain single-step job. */
    blueprint: jsonb('blueprint').$type<BlueprintSnapshot>(),
    /**
     * Set when this job is a follow-up addressing review comments on the source
     * job's PR (LIA-40) — it then reuses that job's `branch` and `prUrl`, copied
     * at insert. Deliberately no FK: `purgeJobs` may delete the source, and the
     * follow-up must stay self-sufficient, like the `repo` snapshot.
     */
    sourceJobId: uuid('source_job_id'),
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
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    t: timestamp('t', { withTimezone: true }).notNull().defaultNow(),
    stream: logStream('stream').notNull(),
    text: text('text').notNull(),
  },
  /** `id` is the tiebreak: two lines can share a millisecond. */
  (t) => [index('job_logs_job_id_idx').on(t.jobId, t.id)],
)
