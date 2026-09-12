/**
 * The seams around the skills the image ships: every skill is one Claude Code
 * reads (frontmatter naming its own directory), every forge-* skill keeps the
 * frame the others are written to — a role with numbered steps, or a lens a
 * role reads — and every `/forge-…` a seeded blueprint step invokes is a skill
 * that exists — a renamed skill would otherwise leave the step running as plain
 * prompt text, silently. No database, no docker.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const SKILLS = path.join(import.meta.dir, 'skills')
const MIGRATIONS = path.join(import.meta.dir, '..', 'web', 'src', 'db', 'migrations')

/** The section order every forge-* skill follows; a role's steps sit between Handoff and Finish. */
const FRAME = ['Overview', 'When to Use', 'Handoff', 'Finish', 'Common Rationalizations', 'Red Flags', 'Verification']

/** A role has numbered steps; a lens (forge-api) has none and is read by a role instead of run as a step. */
const STEP = /^## Step \d+:/m
/** How a role names the lens it reads — the file, never a slash command. */
const LENS_REF = /~\/\.claude\/skills\/(forge-[a-z-]+)\/SKILL\.md/g

const skillDirs = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

const readSkill = (dir: string) => readFileSync(path.join(SKILLS, dir, 'SKILL.md'), 'utf8')

const frontmatter = (md: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md)
  if (!m) return {}
  return Object.fromEntries(
    m[1]
      .split('\n')
      .map((line) => line.split(/:\s*(.*)/s))
      .filter((kv) => kv.length >= 2)
      .map(([k, v]) => [k.trim(), (v ?? '').trim()]),
  )
}

const h2s = (md: string) =>
  md
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())

describe('every skill', () => {
  test('there is at least the /work skill', () => {
    expect(skillDirs).toContain('work')
  })

  for (const dir of skillDirs) {
    test(`${dir}: frontmatter names its directory and describes itself`, () => {
      const fm = frontmatter(readSkill(dir))
      expect(fm.name).toBe(dir)
      expect(fm.description?.length ?? 0).toBeGreaterThan(20)
    })
  }
})

describe('forge-* skills keep the frame', () => {
  for (const dir of skillDirs.filter((d) => d.startsWith('forge-'))) {
    test(`${dir}: ${FRAME.join(' → ')}, in that order`, () => {
      const headings = h2s(readSkill(dir))
      const positions = FRAME.map((h) => headings.indexOf(h))
      for (const [i, pos] of positions.entries()) expect(pos, `missing "## ${FRAME[i]}"`).toBeGreaterThanOrEqual(0)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    })

    test(`${dir}: attributes the agent-skills source`, () => {
      expect(readSkill(dir)).toMatch(/addy-agent-skills \(MIT/)
    })
  }
})

describe('roles and lenses', () => {
  const forge = skillDirs.filter((d) => d.startsWith('forge-'))
  const roles = forge.filter((d) => STEP.test(readSkill(d)))
  const lenses = forge.filter((d) => !STEP.test(readSkill(d)))

  test('forge-api is a lens: Handoff and Finish, no numbered steps', () => {
    expect(lenses).toContain('forge-api')
  })

  for (const dir of roles) {
    test(`${dir}: its steps sit between Handoff and Finish`, () => {
      const headings = h2s(readSkill(dir))
      const steps = headings.map((h, i) => (/^Step \d+:/.test(h) ? i : -1)).filter((i) => i >= 0)
      expect(steps.length).toBeGreaterThan(0)
      expect(steps[0]).toBeGreaterThan(headings.indexOf('Handoff'))
      expect(steps.at(-1)).toBeLessThan(headings.indexOf('Finish'))
    })

    test(`${dir}: every lens it reads exists and is a lens`, () => {
      for (const [, lens] of readSkill(dir).matchAll(LENS_REF)) expect(lenses, lens).toContain(lens)
    })
  }

  for (const dir of lenses) {
    test(`${dir}: is read by at least one role`, () => {
      expect(roles.some((r) => readSkill(r).includes(`~/.claude/skills/${dir}/SKILL.md`))).toBe(true)
    })
  }
})

describe('handoff files keep one shape', () => {
  /** Who writes each handoff file, and the headings its readers may name. */
  const HANDOFF: Record<string, { writers: Array<string>; headings: Array<string> }> = {
    'spec.md': { writers: ['forge-spec'], headings: ['Objective', 'Criteria', 'Commands', 'Out of scope', 'Assumptions', 'Blocked'] },
    'plan.md': { writers: ['forge-plan', 'forge-debug'], headings: ['Change', 'Criteria → code', 'Order', 'Commands', 'Assumptions', 'Not doing', 'Root cause'] },
  }
  /** Headings only one writer produces (a bug plan's root cause; a spec that stops). */
  const OPTIONAL: Record<string, Array<string>> = { 'forge-plan': ['Root cause'], 'forge-debug': ['Blocked'] }
  const known = new Set(Object.values(HANDOFF).flatMap((h) => h.headings))

  for (const [file, { writers, headings }] of Object.entries(HANDOFF)) {
    for (const writer of writers) {
      test(`${writer}'s template for ~/${file} carries every heading a reader may name`, () => {
        const md = readSkill(writer)
        for (const h of headings) if (!OPTIONAL[writer]?.includes(h)) expect(md, h).toContain(`## ${h}`)
      })
    }
  }

  for (const dir of skillDirs.filter((d) => d.startsWith('forge-'))) {
    test(`${dir}: every handoff heading it names in backticks is one a writer produces`, () => {
      for (const [, h] of readSkill(dir).matchAll(/`## ([^`]+)`/g)) expect(known, h).toContain(h)
    })
  }
})

describe('seeded blueprints invoke skills that exist', () => {
  const sqlFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))

  test('the migrations directory is where this test thinks it is', () => {
    expect(sqlFiles.length).toBeGreaterThan(0)
  })

  for (const file of sqlFiles) {
    const invoked = [...new Set(readFileSync(path.join(MIGRATIONS, file), 'utf8').match(/\/forge-[a-z-]+/g) ?? [])]
    if (invoked.length === 0) continue
    test(`${file}: ${invoked.join(', ')}`, () => {
      for (const slash of invoked) expect(existsSync(path.join(SKILLS, slash.slice(1), 'SKILL.md')), slash).toBe(true)
    })
  }
})
