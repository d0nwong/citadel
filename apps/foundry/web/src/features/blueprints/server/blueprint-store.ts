/**
 * Node-only. Imported exclusively from inside server-function handlers.
 *
 * Input validation is by hand, like the uuid guard in job-store: the repo has
 * no schema library, and a step list is small enough not to warrant one.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { blueprintRevisions, blueprints } from '@/db/schema'
import { isStepEffort, isStepModel } from '../types'
import type { Blueprint, BlueprintInput, BlueprintRevision, BlueprintSnapshot, BlueprintStep } from '../types'

type Row = typeof blueprints.$inferSelect
type RevisionRow = typeof blueprintRevisions.$inferSelect
/** The handle `db.transaction` hands its callback — `db` itself won't do. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const toBlueprint = (row: Row): Blueprint => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  steps: row.steps,
  version: row.version,
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
})

const toRevision = (row: RevisionRow): BlueprintRevision => ({
  version: row.version,
  name: row.name,
  description: row.description ?? undefined,
  steps: row.steps,
  source: row.source,
  note: row.note ?? undefined,
  createdAt: row.createdAt.getTime(),
})

export const toSnapshot = (row: Row): BlueprintSnapshot => ({
  id: row.id,
  name: row.name,
  version: row.version,
  steps: row.steps,
})

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
  const note = input.note?.trim()
  return { name, steps, ...(description ? { description } : {}), ...(note ? { note } : {}) }
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

/**
 * Mirrors a blueprint row into `blueprint_revisions`. Every write path goes
 * through this, inside the same transaction as the write, so the history can
 * never be missing the version the row currently claims to be at.
 */
async function recordRevision(tx: Tx, row: Row, note: string | undefined) {
  await tx.insert(blueprintRevisions).values({
    blueprintId: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    steps: row.steps,
    source: 'user',
    note: note ?? null,
  })
}

export async function createBlueprint(input: BlueprintInput): Promise<Blueprint> {
  const v = validate(input)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(blueprints)
      .values({ name: v.name, description: v.description ?? null, steps: v.steps })
      .returning()
    await recordRevision(tx, row, v.note)
    return toBlueprint(row)
  })
}

export async function updateBlueprint(id: string, input: BlueprintInput): Promise<Blueprint> {
  if (!isUuid(id)) throw new Error('no such blueprint')
  const v = validate(input)
  return db.transaction(async (tx) => {
    // Bumped in SQL rather than read-then-written, so two saves racing each
    // other cannot land on the same version — the revisions PK would reject
    // the second anyway, and this way it never gets that far.
    const [row] = await tx
      .update(blueprints)
      .set({
        name: v.name,
        description: v.description ?? null,
        steps: v.steps,
        version: sql`${blueprints.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(blueprints.id, id))
      .returning()
    if (!row) throw new Error('no such blueprint')
    await recordRevision(tx, row, v.note)
    return toBlueprint(row)
  })
}

/** Newest first — the editor's history list. */
export async function listRevisions(blueprintId: string): Promise<Array<BlueprintRevision>> {
  if (!isUuid(blueprintId)) return []
  const rows = await db
    .select()
    .from(blueprintRevisions)
    .where(eq(blueprintRevisions.blueprintId, blueprintId))
    .orderBy(desc(blueprintRevisions.version))
  return rows.map(toRevision)
}

/**
 * Puts an old revision's content back as a *new* version. History is append-only
 * on purpose: a job that ran v3 must keep meaning what it meant, so restoring v3
 * writes v6 rather than reopening v3.
 */
export async function restoreRevision(blueprintId: string, version: number): Promise<Blueprint> {
  if (!isUuid(blueprintId)) throw new Error('no such blueprint')
  const [rev] = await db
    .select()
    .from(blueprintRevisions)
    .where(and(eq(blueprintRevisions.blueprintId, blueprintId), eq(blueprintRevisions.version, version)))
  if (!rev) throw new Error(`no v${version} of that blueprint`)

  return updateBlueprint(blueprintId, {
    name: rev.name,
    description: rev.description ?? undefined,
    steps: rev.steps,
    note: `Restored v${version}`,
  })
}

/** Jobs that ran it keep their snapshot; the FK only nulls `blueprint_id`. */
export async function deleteBlueprint(id: string): Promise<void> {
  if (!isUuid(id)) return
  await db.delete(blueprints).where(eq(blueprints.id, id))
}
