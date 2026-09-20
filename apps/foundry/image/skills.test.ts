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

/** The text of one `## <heading>` section, up to (not including) the next `## ` heading. */
const section = (md: string, heading: string): string => {
  const lines = md.split('\n')
  const start = lines.indexOf(`## ${heading}`)
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => l.startsWith('## '))
  return rest.slice(0, end < 0 ? undefined : end).join('\n')
}

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

describe('the host-carried ## Context is read, not re-hunted (CTD-286)', () => {
  /** The step each role first reads code in — where the host's `## Context` is used before the checkout. */
  const CONTEXT_STEP: Record<string, string> = {
    'forge-test': 'Step 1: Find the runner before writing a line',
    'forge-implement': 'Step 2: One slice at a time',
    'forge-plan': 'Step 1: Read the code each criterion touches',
    'forge-verify': 'Step 3: Review the code on five axes, six when the diff touches a contract',
    'forge-debug': 'Step 2: Localise',
    'forge-simplify': 'Step 1: Understand before touching',
  }

  for (const [dir, step] of Object.entries(CONTEXT_STEP)) {
    test(`C1: ${dir}'s reading step says a carried \`### \`path\`\` block is that file at the base commit`, () => {
      const text = section(readSkill(dir), step)
      expect(text).toContain('Context section')
      expect(text).toMatch(/block there is that file at the base commit/)
    })

    test(`C5: ${dir}'s reading step trusts a carried block over a line number the task cites`, () => {
      const text = section(readSkill(dir), step)
      expect(text).toMatch(/trusted over any line number the task itself cites/)
    })

    test(`C3: ${dir}'s reading step still reads a path the Context does not carry from the checkout`, () => {
      const text = section(readSkill(dir), step)
      expect(text).toMatch(/a path the section does not carry is read from the checkout as before/)
    })

    test(`C4: ${dir}'s Context additions are conditioned on the task carrying one`, () => {
      expect(section(readSkill(dir), step)).toMatch(/^When the task carries a Context section/m)
      // The Finish clause is the second addition, and is conditioned too: without this a job
      // whose task has no Context section would be told to report a list it never received.
      expect(section(readSkill(dir), 'Finish')).toMatch(/the task's Context lists one/)
    })

    test(`C2: ${dir}'s Finish names a missing or not-included path rather than hunting for it`, () => {
      const finish = section(readSkill(dir), 'Finish')
      expect(finish).toContain('### Missing at the base commit')
      expect(finish).toContain('### Not included')
      expect(finish).toMatch(/named with its reason rather than searched for/)
    })
  }

  test('every skill outside this scope names none of this: CTD-286 touched only the six roles above', () => {
    for (const dir of skillDirs.filter((d) => !(d in CONTEXT_STEP))) {
      expect(readSkill(dir), dir).not.toMatch(/named with its reason rather than searched for/)
    }
  })
})

describe('the no-spec path for Plan → Execute (CTD-285)', () => {
  test('C2: forge-plan is offered a task with no ~/spec.md, not just refused one', () => {
    const md = readSkill('forge-plan')
    expect(section(md, 'When to Use')).toContain('no `~/spec.md` exists at all: plan from the task text directly')
    // The old refusal line named no ~/spec.md as a reason to stop; it no longer does.
    expect(md).not.toContain('**When NOT to use:** no `~/spec.md`;')
  })

  test('C2: forge-plan reads the task text in place of a spec, rather than stopping for one', () => {
    expect(readSkill('forge-plan')).toContain('Reads `~/spec.md` when it exists, and the task text in its place when it does not')
  })

  test("C2: forge-implement's Order stands in for the red list with no ~/spec.md", () => {
    const md = readSkill('forge-implement')
    expect(section(md, 'When to Use')).toContain('`~/plan.md` exists with no `~/spec.md` behind it')
    // The old refusal line named no ~/spec.md as a reason to stop; it no longer does.
    expect(md).not.toContain('**When NOT to use:** no `~/spec.md`;')
    expect(section(md, 'Step 1: Start from the red list')).toContain(
      "With no `~/spec.md` and so no red list, there is nothing to run first: the plan's `Order` alone says where to start",
    )
  })

  test("C3: forge-plan's Finish states no approved criteria governed a spec-less run, as forge-verify states a missing spec", () => {
    const finish = section(readSkill('forge-plan'), 'Finish')
    expect(finish).toContain('with no `~/spec.md`, a line stating that no approved criteria governed this run')
  })

  test("C3: forge-implement's Finish states no approved criteria governed a spec-less run, as forge-verify states a missing spec", () => {
    const finish = section(readSkill('forge-implement'), 'Finish')
    expect(finish).toContain("with no `~/spec.md`, the plan's `Order` implemented step by step and a line stating that no approved criteria governed this run")
  })

  test('C4: a run that has ~/spec.md is unchanged — both skills still read it first, ahead of the task-text fallback', () => {
    expect(readSkill('forge-plan')).toContain('Reads `~/spec.md` when it exists')
    expect(readSkill('forge-implement')).toContain('`~/spec.md` (Commands, Assumptions) when it exists')
    // The template shape ~/plan.md is written to, and the criteria-driven slicing, are untouched.
    expect(readSkill('forge-plan')).toContain('## Criteria → code\n- C1 — <file, symbol: what changes there. The helper reused, if any.>')
    expect(readSkill('forge-implement')).toContain("Run the spec's test command once: the failures must match the red list, same names, same reasons.")
    // Lint still comes from the spec's Commands whenever there is a spec to name it.
    expect(readSkill('forge-implement')).toContain("as the spec's Commands names it when there is one")
  })

  test('C4: with a ~/spec.md, forge-implement still refuses a run with nothing red — the Order stands in only when there is no spec', () => {
    // The no-spec escape hatch is scoped: were it unconditional, a spec-driven run whose
    // tests are all green but whose ~/plan.md survives would implement instead of stopping.
    expect(section(readSkill('forge-implement'), 'When to Use')).toContain(
      "**When NOT to use:** no red and no does-not-compile-yet tests — unless there is no `~/spec.md` and `~/plan.md`'s `Order` stands in for them",
    )
  })
})
