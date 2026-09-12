/**
 * The seeded "Spec → QA" blueprint (migration 0013) against the real database:
 * it is there under its fixed id, its steps are ones the editor would accept,
 * its history starts with a `seed` revision, and seeding it did not move the
 * ignite default. Needs the local Postgres from `just up postgres`, migrated
 * (`just migrate`). Reads only; nothing here to sweep.
 */
import { expect, test } from 'bun:test'
import { DEFAULT_BLUEPRINT_ID, QA_BLUEPRINT_ID } from '../types'
import { getBlueprintRow, listRevisions, validate } from './blueprint-store'

const SLASH_SKILL = /^\/forge-[a-z]+\b/

test('the QA blueprint is seeded with five steps, each invoking a /forge-* skill', async () => {
  const row = await getBlueprintRow(QA_BLUEPRINT_ID)
  expect(row?.name).toBe('Spec → QA')
  expect(row?.steps.map((s) => s.name)).toEqual(['spec', 'plan', 'test', 'implement', 'verify'])
  for (const step of row?.steps ?? []) expect(step.prompt).toMatch(SLASH_SKILL)
  // The task reaches the run through the first step only; later ones read the handoff files.
  expect(row?.steps[0].prompt).toContain('{{task}}')
})

test('the seeded steps pass the editor\'s own validation unchanged', async () => {
  const row = await getBlueprintRow(QA_BLUEPRINT_ID)
  if (!row) throw new Error('QA blueprint not seeded — run `just migrate`')
  const v = validate({ name: row.name, description: row.description ?? undefined, steps: row.steps })
  expect(v.steps).toEqual(row.steps)
})

test('its history opens with a seed revision at the version the row claims', async () => {
  const row = await getBlueprintRow(QA_BLUEPRINT_ID)
  if (!row) throw new Error('QA blueprint not seeded — run `just migrate`')
  const revisions = await listRevisions(QA_BLUEPRINT_ID)
  expect(revisions.length).toBeGreaterThanOrEqual(1)
  const first = revisions.at(-1)
  expect(first?.version).toBe(1)
  expect(first?.source).toBe('seed')
  expect(revisions[0]?.version).toBe(row.version)
})

test('seeding it left the ignite default on "Plan → Execute"', async () => {
  const row = await getBlueprintRow(DEFAULT_BLUEPRINT_ID)
  expect(row?.name).toBe('Plan → Execute')
  expect(DEFAULT_BLUEPRINT_ID).not.toBe(QA_BLUEPRINT_ID)
})
