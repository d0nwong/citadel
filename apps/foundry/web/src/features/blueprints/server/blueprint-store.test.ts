/**
 * The seeded skill blueprints — "Spec → QA" (migration 0013, v2 in 0019, v3 in 0020), "Bug → Fix"
 * (0014), "Simplify" (0016), "Fix failing check" (0018) and "Merge base into branch" (0022) — against the real database: each is there under its fixed id, its
 * steps are ones the editor would accept, its history starts with a `seed`
 * revision, and seeding them did not move the ignite default. Needs the local
 * Postgres from `just up postgres`, migrated (`just migrate`). Reads only;
 * nothing here to sweep.
 */
import { describe, expect, test } from 'bun:test'
import {
  BUG_BLUEPRINT_ID,
  CHECK_BLUEPRINT_ID,
  CHECK_BLUEPRINT_STEPS,
  DEFAULT_BLUEPRINT_ID,
  MERGE_BLUEPRINT_ID,
  MERGE_BLUEPRINT_STEPS,
  QA_BLUEPRINT_ID,
  SIMPLIFY_BLUEPRINT_ID,
} from '../types'
import { getBlueprintRow, listRevisions, validate } from './blueprint-store'

const SLASH_SKILL = /^\/forge-[a-z]+\b/

const SEEDED = [
  { id: QA_BLUEPRINT_ID, name: 'Spec → QA', steps: ['spec', 'build', 'verify'] },
  { id: BUG_BLUEPRINT_ID, name: 'Bug → Fix', steps: ['spec', 'debug', 'test', 'implement', 'verify'] },
  { id: SIMPLIFY_BLUEPRINT_ID, name: 'Simplify', steps: ['spec', 'simplify', 'verify'] },
  { id: CHECK_BLUEPRINT_ID, name: 'Fix failing check', steps: ['debug'] },
  { id: MERGE_BLUEPRINT_ID, name: 'Merge base into branch', steps: ['merge'] },
]

test('the check blueprint is forge-debug alone, the same step list the store falls back to', async () => {
  const row = await getBlueprintRow(CHECK_BLUEPRINT_ID)
  expect(row?.steps).toEqual(CHECK_BLUEPRINT_STEPS)
})

test('the merge blueprint is forge-merge alone, the same step list the store falls back to', async () => {
  const row = await getBlueprintRow(MERGE_BLUEPRINT_ID)
  expect(row?.steps).toEqual(MERGE_BLUEPRINT_STEPS)
})

describe.each(SEEDED)('the seeded "$name" blueprint', ({ id, name, steps }) => {
  test('is seeded with its steps, each invoking a /forge-* skill', async () => {
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

test('the simplify blueprint runs spec in refactor mode, so the unchanged suite is the criterion', async () => {
  const row = await getBlueprintRow(SIMPLIFY_BLUEPRINT_ID)
  expect(row?.steps[0].prompt).toMatch(/^\/forge-spec refactor: /)
  expect(row?.steps[1].prompt).toMatch(/^\/forge-simplify\b/)
})

test('Spec → QA v3 writes the tests red and implements them in one step, starting from what the session holds, and keeps v1 and v2 to restore', async () => {
  const row = await getBlueprintRow(QA_BLUEPRINT_ID)
  expect(row?.steps[1].prompt).toMatch(/^\/forge-test\b/)
  expect(row?.steps[1].prompt).toContain('~/.claude/skills/forge-implement/SKILL.md')
  // The session is resumed across steps, so the build step is told not to re-read what spec read.
  expect(row?.steps[1].prompt).toContain('already in this session')
  const revisions = await listRevisions(QA_BLUEPRINT_ID)
  const v1 = revisions.find((r) => r.version === 1)
  expect(v1?.steps.map((s) => s.name)).toEqual(['spec', 'plan', 'test', 'implement', 'verify'])
  const v2 = revisions.find((r) => r.version === 2)
  expect(v2?.source).toBe('seed')
  expect(v2?.steps.map((s) => s.name)).toEqual(['spec', 'build', 'verify'])
  expect(v2?.steps[1].prompt).not.toContain('already in this session')
})

test('seeding them left the ignite default on "Plan → Execute"', async () => {
  const row = await getBlueprintRow(DEFAULT_BLUEPRINT_ID)
  expect(row?.name).toBe('Plan → Execute')
  expect(new Set([DEFAULT_BLUEPRINT_ID, QA_BLUEPRINT_ID, BUG_BLUEPRINT_ID, SIMPLIFY_BLUEPRINT_ID]).size).toBe(4)
})
