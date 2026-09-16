/**
 * The pure parts of the preflight skill check (CTD-236): extracting the
 * `/<skill>` a step's prompt names, and diffing that list against what an
 * image has. No docker — `imageSkills` itself needs a real daemon and image,
 * which these tests don't have.
 */
import { describe, expect, test } from 'bun:test'
import { missingSkills, namedSkills, stepSkill } from './image-skills'

describe('stepSkill', () => {
  test('the leading /command, not the rest of the prompt', () => {
    expect(stepSkill({ prompt: '/forge-merge {{task}}' })).toBe('forge-merge')
    expect(stepSkill({ prompt: '/forge-plan for the spec at ~/spec.md' })).toBe('forge-plan')
  })

  test('null for a prompt that names no command', () => {
    expect(stepSkill({ prompt: 'fix the bug described below' })).toBeNull()
    expect(stepSkill({ prompt: '' })).toBeNull()
  })

  test('leading whitespace does not hide the command', () => {
    expect(stepSkill({ prompt: '  /forge-debug {{task}}' })).toBe('forge-debug')
  })
})

describe('namedSkills', () => {
  test('one entry per distinct skill, first-seen order, no duplicates', () => {
    expect(
      namedSkills([
        { prompt: '/forge-spec {{task}}' },
        { prompt: '/forge-test for the criteria in ~/spec.md' },
        { prompt: '/forge-spec bug: {{task}}' },
      ]),
    ).toEqual(['forge-spec', 'forge-test'])
  })

  test('a plain job (no steps) names nothing', () => {
    expect(namedSkills([])).toEqual([])
  })

  test('a step whose prompt names no command contributes nothing', () => {
    expect(namedSkills([{ prompt: 'plain text, no slash command' }])).toEqual([])
  })
})

describe('missingSkills', () => {
  test('only the names the image does not have', () => {
    expect(missingSkills(['forge-merge', 'forge-debug'], new Set(['forge-debug']))).toEqual(['forge-merge'])
  })

  test('empty when the image has everything named', () => {
    expect(missingSkills(['forge-debug'], new Set(['forge-debug', 'forge-merge']))).toEqual([])
  })
})
