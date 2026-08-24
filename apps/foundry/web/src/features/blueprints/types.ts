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
  createdAt: number
  updatedAt: number
}

/**
 * What a job keeps of the blueprint it ran: enough to re-run and to display,
 * immune to later edits or deletion of the blueprint row.
 */
export interface BlueprintSnapshot {
  id: string
  name: string
  steps: Array<BlueprintStep>
}

export interface BlueprintInput {
  name: string
  description?: string
  steps: Array<BlueprintStep>
}

export const isStepModel = (s: string): s is StepModel => (STEP_MODELS as ReadonlyArray<string>).includes(s)
export const isStepEffort = (s: string): s is StepEffort => (STEP_EFFORTS as ReadonlyArray<string>).includes(s)

/** `plan · fable → execute · sonnet` — the one-line summary of a step list. */
export const stepsSummary = (steps: Array<BlueprintStep>) => steps.map((s) => `${s.name} · ${s.model}`).join(' → ')
