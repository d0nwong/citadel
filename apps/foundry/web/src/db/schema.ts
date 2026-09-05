/**
 * The database, as Drizzle sees it. `bun run db:generate` turns edits here into
 * SQL under ./migrations, which is what actually gets committed and applied.
 *
 * Everything lives in the `foundry` schema, not `public` — the database is
 * foundry's to grow into, and keeping our objects namespaced leaves `public`
 * for the extensions that infra/postgres/init/00-init.sql installs there.
 */
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { BlueprintSnapshot, BlueprintStep } from '../features/blueprints/types'
import type { RepoRef } from '../features/repos/types'

export const foundry = pgSchema('foundry')

/* Mirrors of the unions in features/jobs/types.ts. Keep them in step. */
export const jobStatus = foundry.enum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export const revisionSource = foundry.enum('revision_source', ['seed', 'user'])

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
  /** The revision these columns hold. Bumped on every save; never reused. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Every version a blueprint has ever held, append-only — the columns above are
 * just a cache of the latest row here. Prompts are iterated on, so the point is
 * to be able to read what v3 said, diff it against v4, and put v3 back (which
 * writes v5 rather than rewriting history).
 *
 * `source` is what makes shipped blueprints upgradable: a migration may improve
 * a blueprint in place only while its newest revision is still `seed`. The first
 * `user` revision hands the row over for good.
 */
export const blueprintRevisions = foundry.table(
  'blueprint_revisions',
  {
    blueprintId: uuid('blueprint_id')
      .notNull()
      .references(() => blueprints.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /* The whole editable surface, so restoring a revision restores all of it. */
    name: text('name').notNull(),
    description: text('description'),
    steps: jsonb('steps').$type<Array<BlueprintStep>>().notNull(),
    source: revisionSource('source').notNull(),
    /** One line on what changed, optional — the save dialog asks for it. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blueprintId, t.version] })],
)

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
    /**
     * Linear issue identifier (e.g. LIA-52) when the ticket scanner ignited
     * this job. Unique — the insert IS the scanner's claim on the ticket;
     * NULL for UI-created jobs, and NULLs don't collide.
     */
    ticketId: text('ticket_id'),
    /**
     * Where to POST a signed `job.settled` event once the job leaves the open
     * set — set only by the trigger API (a service that would rather not poll).
     * NULL for UI and scanner jobs.
     */
    callbackUrl: text('callback_url'),
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
  (t) => [
    index('jobs_created_at_idx').on(t.createdAt.desc()),
    index('jobs_status_idx').on(t.status),
    uniqueIndex('jobs_ticket_id_unique').on(t.ticketId),
  ],
)

/*
 * A job's log lines are deliberately not here (LIA-18). They are append-only,
 * per-job, never joined and never updated, so they live as one JSONL file per
 * job under ~/.foundry/logs — see features/jobs/server/job-logs.ts.
 */
