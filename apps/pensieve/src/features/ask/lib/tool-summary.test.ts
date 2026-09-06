import { describe, expect, test } from 'bun:test'
import { parseArguments, toolResultText, toolSummary } from './tool-summary'

describe('toolSummary', () => {
  test('Read shows the path', () => {
    expect(toolSummary('Read', { file_path: 'reports/points.json' })).toBe('reports/points.json')
    expect(toolSummary('Read', { path: 'reports' })).toBe('reports')
  })

  test('Grep and Glob show the pattern, and where when given', () => {
    expect(toolSummary('Grep', { pattern: 'LIA-94' })).toBe('LIA-94')
    expect(toolSummary('Grep', { pattern: 'LIA-94', path: 'journal' })).toBe('LIA-94 in journal')
    expect(toolSummary('Glob', { pattern: '**/*.md', path: 'docs' })).toBe('**/*.md in docs')
  })

  test('Bash shows the command', () => {
    expect(toolSummary('Bash', { command: 'git log --oneline -5', description: 'recent commits' })).toBe('git log --oneline -5')
  })

  test('unknown tools show their first string argument; nothing usable is empty', () => {
    expect(toolSummary('LS', { path: 'src' })).toBe('src')
    expect(toolSummary('TodoWrite', { todos: [] })).toBe('')
    expect(toolSummary('Read', undefined)).toBe('')
    expect(toolSummary('Read', 'not an object')).toBe('')
    expect(toolSummary('Read', { file_path: '   ' })).toBe('')
  })
})

describe('parseArguments', () => {
  test('parses complete JSON, undefined otherwise', () => {
    expect(parseArguments('{"file_path":"a.md"}')).toEqual({ file_path: 'a.md' })
    expect(parseArguments('{"file_path":"a.m')).toBeUndefined()
    expect(parseArguments('')).toBeUndefined()
    expect(parseArguments(undefined)).toBeUndefined()
  })
})

describe('toolResultText', () => {
  test('strings pass through, parts join their text, anything else is empty', () => {
    expect(toolResultText('hello')).toBe('hello')
    expect(
      toolResultText([
        { type: 'text', content: 'a' },
        { type: 'image', source: { type: 'url', value: 'x' } },
        { type: 'text', content: 'b' },
      ]),
    ).toBe('ab')
    expect(toolResultText(undefined)).toBe('')
    expect(toolResultText({ content: 'nope' })).toBe('')
  })
})
