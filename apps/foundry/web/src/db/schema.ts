/**
 * The database, as Drizzle sees it. `just db-generate` turns edits here into
 * SQL under ./migrations, which is what actually gets committed and applied.
 *
 * Everything lives in the `foundry` schema, not `public` — the database is
 * foundry's to grow into, and keeping our objects namespaced leaves `public`
 * for the extensions that infra/postgres/init/00-init.sql installs there.
 */
import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { BlueprintSnapshot, BlueprintStep } from '../features/blueprints/types'
import type { FollowUp } from '../features/jobs/types'
import type { RepoRef } from '../features/repos/types'

export const foundry = pgSchema('foundry')

/* Mirrors of the unions in features/jobs/types.ts. Keep them in step. */
export const jobStatus = foundry.enum('job_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'pr_ready'])
export const revisionSource = foundry.enum('revision_source', ['seed', 'user'])

/**
 * Repos the user has imported — the curated set a job may target. What the
 * repo scan reports about a checkout (branch, dirty, last commit) is deliberately
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
     * What a follow-up answers (CTD-170): `review` — the PR's review comments
     * are its task; `check` — a failed check's log is. Null on a job that is
     * not a follow-up. The detail sheet's action queues a `review` one; the
     * PR watcher queues either.
     */
    followUp: text('follow_up').$type<FollowUp>(),
    /**
     * Linear issue identifier (e.g. LIA-52) when the job was queued from a
     * ticket over `POST /api/jobs`. Unique among non-cancelled rows — the
     * insert IS the claim on the ticket, taken before any Linear write; NULL
     * for UI-created jobs, and NULLs don't collide. Cancelling a job (CTD-176)
     * drops it out of `jobs_ticket_id_unique`'s predicate below, releasing the
     * claim, while the row itself keeps the ticket id it ran.
     */
    ticketId: text('ticket_id'),
    /**
     * Where to POST a signed `job.settled` event once the job leaves the open
     * set — set only by the trigger API (a service that would rather not poll).
     * NULL for UI jobs.
     */
    callbackUrl: text('callback_url'),
    /**
     * The trigger API's `Idempotency-Key` header (LIA-91), unique so a replay
     * finds the job it already made — and so two concurrent first requests
     * insert one row, the same way `ticket_id` arbitrates a claim. NULL for
     * UI jobs, and for API calls that sent no header.
     */
    idempotencyKey: text('idempotency_key'),
    /**
     * sha256 (hex) of the raw request body that first used the key, so a
     * replay with the same key but a different body is refused rather than
     * silently answered with the wrong job. Set and read only with the key.
     */
    idempotencyFingerprint: text('idempotency_fingerprint'),
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
    /**
     * The commit the workspace stood at before the agent touched it (CTD-187):
     * the base branch's tip, or a follow-up's PR branch tip. What `baselines`
     * is keyed by; set once the clone exists.
     */
    baseSha: text('base_sha'),
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
    // Partial (CTD-176): a cancelled row keeps its ticket_id for the record but
    // drops out of the index, so the next trigger for that ticket can claim it.
    uniqueIndex('jobs_ticket_id_unique')
      .on(t.ticketId)
      .where(sql`${t.status} <> 'cancelled'`),
    uniqueIndex('jobs_idempotency_key_unique').on(t.idempotencyKey),
  ],
)

/**
 * The PR watcher's memory (CTD-170): one row per pull request a settled job
 * opened. Not a column on `jobs`, because several jobs share one PR — the root
 * and every follow-up — and the questions the watcher asks are about the PR:
 * which review has already launched a job, which head commit's failed checks
 * have, how many launches are spent. Keyed by URL because that is what the
 * job rows carry; `job_id` is the root job, for the ledger lines, and has no
 * FK for the reason `source_job_id` has none.
 */
export const prWatches = foundry.table('pr_watches', {
  prUrl: text('pr_url').primaryKey(),
  jobId: uuid('job_id').notNull(),
  /** Reviews submitted at or before this moment are done with — acted on, or older than the PR. */
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
  /** The head commit whose failed checks already launched a follow-up. */
  checkedSha: text('checked_sha'),
  /** The base commit whose conflict with the branch already launched a merge follow-up (CTD-214). */
  mergedBaseSha: text('merged_base_sha'),
  /** The head commit whose failed CI jobs the host already reran once (CTD-233). */
  rerunSha: text('rerun_sha'),
  /** When that rerun happened — a later failure counts only if it finished after this. */
  rerunAt: timestamp('rerun_at', { withTimezone: true }),
  /** Automatic follow-ups launched for this PR, bounded by FOUNDRY_PR_RETRIES. */
  followUps: integer('follow_ups').notNull().default(0),
  /** Why watching ended — the PR merged or closed, or the retry budget spent. Null while watching. */
  stopped: text('stopped'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * The base state of a commit (CTD-187): install, the suite and the typecheck
 * as the runner's pre-step ran them on the untouched checkout, before any
 * model turn. Computed once per repo and sha, then handed to every later job
 * on the same base as `FOUNDRY_BASELINE`, so no step spends turns on it. The
 * body is the container's `~/baseline.md` verbatim; `job_id` says which job
 * measured it, with no FK for the reason `source_job_id` has none.
 */
export const baselines = foundry.table(
  'baselines',
  {
    /** The job's `repo.name` — what the events handler has in hand. */
    repo: text('repo').notNull(),
    baseSha: text('base_sha').notNull(),
    body: text('body').notNull(),
    jobId: uuid('job_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.baseSha] })],
)

/*
 * A job's log lines are deliberately not here (LIA-18). They are append-only,
 * per-job, never joined and never updated, so they live as one JSONL file per
 * job under ~/.foundry/logs — see features/jobs/server/job-logs.ts.
 */
