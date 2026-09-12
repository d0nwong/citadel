/**
 * The seeded skill blueprints — "Spec → QA" (migration 0013) and "Bug → Fix"
 * (0014) — against the real database: each is there under its fixed id, its
 * steps are ones the editor would accept, its history starts with a `seed`
 * revision, and seeding them did not move the ignite default. Needs the local
 * Postgres from `just up postgres`, migrated (`just migrate`). Reads only;
 * nothing here to sweep.
 */
import { describe, expect, test } from 'bun:test'
import { BUG_BLUEPRINT_ID, DEFAULT_BLUEPRINT_ID, QA_BLUEPRINT_ID } from '../types'
import { getBlueprintRow, listRevisions, validate } from './blueprint-store'

const SLASH_SKILL = /^\/forge-[a-z]+\b/

const SEEDED = [
  { id: QA_BLUEPRINT_ID, name: 'Spec → QA', steps: ['spec', 'plan', 'test', 'implement', 'verify'] },
  { id: BUG_BLUEPRINT_ID, name: 'Bug → Fix', steps: ['spec', 'debug', 'test', 'implement', 'verify'] },
]

describe.each(SEEDED)('the seeded "$name" blueprint', ({ id, name, steps }) => {
  test('is seeded with five steps, each invoking a /forge-* skill', async () => {
    const row = await getBlueprintRow(id)
    expect(row?.name).toBe(name)
    expect(row?.steps.map((s) => s.name)).toEqual(steps)
    for (const step of row?.steps ?? []) expect(step.prompt).toMatch(SLASH_SKILL)
    // The task reaches the run through the first step only; later ones read the handoff files.
    expect(row?.steps[0].prompt).toContain('{{task}}')
  })

  test("its steps pass the editor's own validation unchanged", async () => {
    const row = await getBlueprintRow(id)
    if (!row) throw new Error(`${name} not seeded — run \`just migrate\``)
    const v = validate({ name: row.name, description: row.description ?? undefined, steps: row.steps })
    expect(v.steps).toEqual(row.steps)
  })

  test('its history opens with a seed revision at the version the row claims', async () => {
    const row = await getBlueprintRow(id)
    if (!row) throw new Error(`${name} not seeded — run \`just migrate\``)
    const revisions = await listRevisions(id)
    expect(revisions.length).toBeGreaterThanOrEqual(1)
    const first = revisions.at(-1)
    expect(first?.version).toBe(1)
    expect(first?.source).toBe('seed')
    expect(revisions[0]?.version).toBe(row.version)
  })
})

test('the bug blueprint runs spec in bug mode, so the reproduction is the criterion', async () => {
  const row = await getBlueprintRow(BUG_BLUEPRINT_ID)
  expect(row?.steps[0].prompt).toMatch(/^\/forge-spec bug: /)
  expect(row?.steps[1].prompt).toMatch(/^\/forge-debug\b/)
})

test('seeding them left the ignite default on "Plan → Execute"', async () => {
  const row = await getBlueprintRow(DEFAULT_BLUEPRINT_ID)
  expect(row?.name).toBe('Plan → Execute')
  expect(new Set([DEFAULT_BLUEPRINT_ID, QA_BLUEPRINT_ID, BUG_BLUEPRINT_ID]).size).toBe(3)
})
