/**
 * A blueprint is a reusable sequence of agent steps, each on a model of its
 * own — plan on one, execute on another. Every step runs `claude -p` inside
 * the same job container against the same session, so later steps see the
 * earlier ones' work. The runner (image/forge-run.sh) is what consumes it.
 */

/** Aliases `claude --model` resolves to the latest of each family. */
export const STEP_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const
export type StepModel = (typeof STEP_MODELS)[number]

export const STEP_EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type StepEffort = (typeof STEP_EFFORTS)[number]

/** The placeholder a step prompt uses for the job's task text. */
export const TASK_PLACEHOLDER = '{{task}}'

/**
 * "Plan → Execute", seeded by migration 0007 — what the ignite dialog starts on,
 * because planning first is the right default for a task nobody is watching.
 * Matched by id, not by name: the row is the user's to rename or rewrite, and
 * only deleting it should change what a fresh job defaults to (then: no
 * blueprint, one bare step).
 */
export const DEFAULT_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000001'

/**
 * "Spec → QA", seeded by migration 0013 (CTD-65) and cut to three steps by
 * 0019 (CTD-179): spec the ticket, write its tests red and implement them to
 * green in one step, verify and report — each step a `/forge-*` skill the
 * image ships. v1's five steps, with a plan step, stay restorable from its
 * history. Not the ignite default; a ticket without acceptance criteria stops
 * it at the first step by design.
 */
export const QA_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000003'

/**
 * "Bug → Fix", seeded by migration 0014 (CTD-173): the reproduction as the
 * criterion, `forge-debug` to find the root cause and plan its fix, then the
 * test, implement and verify steps "Spec → QA" v1 had. A ticket with neither
 * reproduction steps nor a failing check stops it at the first step.
 */
export const BUG_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000004'

/**
 * "Simplify", seeded by migration 0016 (CTD-175): spec in refactor mode (the
 * unchanged suite and each named simplification as criteria), `forge-simplify`
 * to remove what the ticket names with the suite as the oracle, then verify.
 * A ticket naming no file and nothing to remove stops it at the first step.
 */
export const SIMPLIFY_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000005'

/**
 * "Fix failing check", seeded by migration 0018 (CTD-170): the one step the
 * PR watcher's check follow-up runs — `forge-debug` alone, handed the failing
 * steps' logs as its task, so the failure is reproduced and its cause fixed
 * rather than the log pattern-matched. `CHECK_BLUEPRINT_STEPS` is the same
 * step list, for a follow-up queued after the row was deleted.
 */
export const CHECK_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000006'
export const CHECK_BLUEPRINT_STEPS: Array<BlueprintStep> = [
  { name: 'debug', model: 'fable', effort: 'high', prompt: '/forge-debug {{task}}' },
]

/**
 * "Merge base into branch", seeded by migration 0022 (CTD-214): the one step
 * the PR watcher's merge follow-up runs — `forge-merge`, handed the base commit
 * and the conflicted files, merging the base in and resolving each hunk only
 * where both sides' intent fits. `MERGE_BLUEPRINT_STEPS` is the fallback for a
 * follow-up queued after the row was deleted.
 */
export const MERGE_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000007'
export const MERGE_BLUEPRINT_STEPS: Array<BlueprintStep> = [
  { name: 'merge', model: 'opus', effort: 'high', prompt: '/forge-merge {{task}}' },
]

export interface BlueprintStep {
  name: string
  model: StepModel
  effort?: StepEffort
  /** May contain `{{task}}`, substituted with the job's task in the container. */
  prompt: string
}

/** Timestamps are epoch milliseconds, as the rest of the app expects. */
export interface Blueprint {
  id: string
  name: string
  description?: string
  steps: Array<BlueprintStep>
  /** Bumped on every save; `blueprint_revisions` holds each one's content. */
  version: number
  createdAt: number
  updatedAt: number
}

/**
 * Who wrote a revision. `seed` marks content a migration shipped and nobody has
 * touched since — the one case where a later migration may improve a blueprint
 * in place. One `user` revision and the row is the user's for good.
 */
export const REVISION_SOURCES = ['seed', 'user'] as const
export type RevisionSource = (typeof REVISION_SOURCES)[number]

/** One saved state of a blueprint. Append-only: restoring writes a new version. */
export interface BlueprintRevision {
  version: number
  name: string
  description?: string
  steps: Array<BlueprintStep>
  source: RevisionSource
  /** What changed, if whoever saved it said. */
  note?: string
  createdAt: number
}

/**
 * What a job keeps of the blueprint it ran: enough to re-run and to display,
 * immune to later edits or deletion of the blueprint row.
 */
export interface BlueprintSnapshot {
  id: string
  name: string
  /**
   * Which revision ran — this is what makes "did v4 do better than v3" a
   * question the ledger can answer. Absent on jobs queued before blueprints
   * were versioned, so it stays optional forever.
   */
  version?: number
  steps: Array<BlueprintStep>
}

export interface BlueprintInput {
  name: string
  description?: string
  steps: Array<BlueprintStep>
  /** One line on what changed, kept with the revision this save creates. */
  note?: string
}

export const isStepModel = (s: string): s is StepModel => (STEP_MODELS as ReadonlyArray<string>).includes(s)
export const isStepEffort = (s: string): s is StepEffort => (STEP_EFFORTS as ReadonlyArray<string>).includes(s)

/** `plan · fable → execute · sonnet` — the one-line summary of a step list. */
export const stepsSummary = (steps: Array<BlueprintStep>) => steps.map((s) => `${s.name} · ${s.model}`).join(' → ')

/**
 * `Plan → Execute v3` — how a blueprint is named wherever a job refers to one.
 * Jobs from before versioning have no version and read as just the name.
 */
export const blueprintLabel = (bp: { name: string; version?: number }) =>
  bp.version === undefined ? bp.name : `${bp.name} v${bp.version}`
