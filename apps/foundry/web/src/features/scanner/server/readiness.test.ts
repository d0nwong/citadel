import { describe, expect, test } from 'bun:test'
import { assessReadiness } from './readiness'
import type { BlockedBy } from './readiness'

const ready = (body: string, blockedBy: Array<BlockedBy> = []) =>
  assessReadiness({ body, blockedBy }).ready

describe('blocked-by', () => {
  test('no blockers, no Pending → ready', () => {
    expect(ready('## Summary\n\nDo the thing.')).toBe(true)
  })

  test('an unresolved blocker → not ready, named in the reason', () => {
    const out = assessReadiness({ body: '', blockedBy: [{ identifier: 'LIA-9', stateType: 'started' }] })
    expect(out).toEqual({ ready: false, reason: 'blocked by LIA-9' })
  })

  test('completed and canceled blockers are resolved → ready', () => {
    expect(
      ready('', [
        { identifier: 'LIA-1', stateType: 'completed' },
        { identifier: 'LIA-2', stateType: 'canceled' },
      ]),
    ).toBe(true)
  })

  test('an unknown state type counts as unresolved', () => {
    expect(ready('', [{ identifier: 'LIA-3', stateType: '' }])).toBe(false)
  })
})

describe('Pending section', () => {
  test('content under ## Pending → not ready', () => {
    const out = assessReadiness({
      body: '## Summary\n\nok\n\n## Pending\n\n* waiting on backend\n\n## Technical Notes\n\nnone',
      blockedBy: [],
    })
    expect(out).toEqual({ ready: false, reason: 'non-empty Pending section' })
  })

  test('an empty ## Pending section → ready', () => {
    expect(ready('## Pending\n\n\n## Technical Notes\n\nstuff')).toBe(true)
  })

  test('absent Pending section → ready', () => {
    expect(ready('## Summary\n\nall clear')).toBe(true)
  })

  test('prefix and case both match: "## Pending items", "## PENDING"', () => {
    expect(ready('## Pending items\n\n- one more thing')).toBe(false)
    expect(ready('## PENDING\n\nblocked on legal')).toBe(false)
  })

  test('compound non-Pending headings do not match', () => {
    expect(ready('## Scope / Out of Scope\n\nIn scope:\n\n* everything')).toBe(true)
  })

  test('the section ends at the next heading', () => {
    expect(ready('## Pending\n\n\n### Notes\n\nthese lines are not pending items')).toBe(true)
  })
})
