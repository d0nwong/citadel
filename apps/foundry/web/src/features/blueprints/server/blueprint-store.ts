/**
 * Node-only. Imported exclusively from inside server-function handlers.
 *
 * Input validation is by hand, like the uuid guard in job-store: the repo has
 * no schema library, and a step list is small enough not to warrant one.
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { blueprints } from '@/db/schema'
import { isStepEffort, isStepModel } from '../types'
import type { Blueprint, BlueprintInput, BlueprintSnapshot, BlueprintStep } from '../types'

type Row = typeof blueprints.$inferSelect

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const toBlueprint = (row: Row): Blueprint => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  steps: row.steps,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
})

export const toSnapshot = (row: Row): BlueprintSnapshot => ({ id: row.id, name: row.name, steps: row.steps })

/** Throws with a message fit for a toast; returns the trimmed, normalised input. */
export function validate(input: BlueprintInput): BlueprintInput {
  const name = input.name.trim()
  if (name === '') throw new Error('a blueprint needs a name')
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('a blueprint needs at least one step')

  const steps: Array<BlueprintStep> = input.steps.map((s, i) => {
    const stepName = s.name.trim()
    const prompt = s.prompt.trim()
    if (stepName === '') throw new Error(`step ${i + 1} needs a name`)
    if (prompt === '') throw new Error(`step "${stepName}" needs a prompt`)
    if (!isStepModel(s.model)) throw new Error(`step "${stepName}": unknown model '${s.model}'`)
    if (s.effort !== undefined && !isStepEffort(s.effort)) throw new Error(`step "${stepName}": unknown effort '${s.effort}'`)
    return { name: stepName, model: s.model, prompt, ...(s.effort ? { effort: s.effort } : {}) }
  })

  const description = input.description?.trim()
  return { name, steps, ...(description ? { description } : {}) }
}

export async function listBlueprints(): Promise<Array<Blueprint>> {
  const rows = await db.select().from(blueprints).orderBy(asc(blueprints.name))
  return rows.map(toBlueprint)
}

/** Full row — for the job store to snapshot at ignite time. */
export async function getBlueprintRow(id: string): Promise<Row | undefined> {
  if (!isUuid(id)) return undefined
  const [row] = await db.select().from(blueprints).where(eq(blueprints.id, id))
  return row
}

export async function createBlueprint(input: BlueprintInput): Promise<Blueprint> {
  const v = validate(input)
  const [row] = await db
    .insert(blueprints)
    .values({ name: v.name, description: v.description ?? null, steps: v.steps })
    .returning()
  return toBlueprint(row)
}

export async function updateBlueprint(id: string, input: BlueprintInput): Promise<Blueprint> {
  if (!isUuid(id)) throw new Error('no such blueprint')
  const v = validate(input)
  const [row] = await db
    .update(blueprints)
    .set({ name: v.name, description: v.description ?? null, steps: v.steps, updatedAt: new Date() })
    .where(eq(blueprints.id, id))
    .returning()
  if (!row) throw new Error('no such blueprint')
  return toBlueprint(row)
}

/** Jobs that ran it keep their snapshot; the FK only nulls `blueprint_id`. */
export async function deleteBlueprint(id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.delete(blueprints).where(eq(blueprints.id, id))
}
