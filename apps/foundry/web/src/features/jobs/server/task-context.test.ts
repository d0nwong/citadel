/**
 * The task's `## Context` (CTD-190) against a real git repo in a temp dir and a
 * stubbed Linear: what counts as a named file, what is carried whole, what is
 * listed as missing or not included, and that nothing here fails a job. No
 * database, no docker.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ARG_BUDGET, CONTEXT_CAP, hydrateTask, linkedIssueIds, namedFiles } from './task-context'
import type { LinearIssue } from './linear-link'
import type { ContextDeps } from './task-context'

const exec = promisify(execFile)
let work = ''

const MAPPER = 'src/features/usage/lib/map-billing-cycle-history.ts'
const FILES: Record<string, string | Buffer> = {
  [MAPPER]: 'export const mapBillingCycleHistory = () => []\n',
  'src/features/usage/lib/map-billing-cycle-history.test.ts': "test('C1', () => {})\n",
  'docs/notes.md': 'Run it:\n```sh\nbun test\n```\n',
  'src/a/index.ts': 'export const a = 1\n',
  'src/b/index.ts': 'export const b = 2\n',
  'assets/logo.bin': Buffer.from([0x89, 0x50, 0x00, 0x01]),
  'src/big/one.ts': `// one\n${'a'.repeat(30 * 1024)}\n`,
  'src/big/two.ts': `// two\n${'b'.repeat(30 * 1024)}\n`,
  'src/big/three.ts': `// three\n${'c'.repeat(30 * 1024)}\n`,
  'src/huge.ts': 'x'.repeat(CONTEXT_CAP + 1),
}

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'foundry-context-'))
  for (const [file, body] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(work, file)), { recursive: true })
    await writeFile(path.join(work, file), body)
  }
  const git = (...args: Array<string>) => exec('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args])
  await git('init', '-q')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'base')
})

afterAll(async () => {
  await rm(work, { force: true, recursive: true })
})

const issue = (identifier: string): LinearIssue => ({
  description: `The ${identifier} description.`,
  id: `uuid-${identifier}`,
  identifier,
  teamId: 'team',
  title: `${identifier} title`,
  url: `https://linear.app/acme/issue/${identifier}/slug`,
})

/** A Linear that knows ALD-44 and ALD-45, knows nothing of UTF-8, and is down for ALD-500. */
const linear = (calls: Array<string> = []): ContextDeps => ({
  fetchIssue: async (_key, id) => {
    calls.push(id)
    if (id === 'ALD-500') {
      throw new Error('HTTP 503')
    }
    return id === 'ALD-44' || id === 'ALD-45' ? issue(id) : null
  },
  linearKey: 'lin_api_test',
})

describe('namedFiles', () => {
  test('takes paths and bare names in backticks, without their line references', () => {
    const task = 'See `apps/x/y.ts:78`, `z/w.sh:74–76`, `job-runner.ts:341` and `./rel/a.md`.'
    expect(namedFiles(task)).toEqual({ names: ['job-runner.ts'], paths: ['apps/x/y.ts', 'z/w.sh', 'rel/a.md'] })
  })

  test('skips commands, globs, placeholders, URLs, absolute and home paths, directories and image tags', () => {
    const task = [
      '`pnpm install --frozen-lockfile`',
      '`src/**/x.test.ts`',
      '`GET /api/v1/history/{id}/billing-cycles`',
      '`/work/.git/PR_BODY.md`',
      '`~/baseline.md`',
      '`https://x.io/a.js`',
      '`src/features/`',
      '`../up.ts`',
      '`foundry/forge:latest`',
    ].join(' ')
    expect(namedFiles(task)).toEqual({ names: [], paths: [] })
  })
})

describe('linkedIssueIds', () => {
  test('a ticket brief does not fetch its own issue, only the ones it links', () => {
    const brief = 'ALD-45: title\nhttps://linear.app/acme/issue/ALD-45/slug\n\nBlocked by ALD-44. Related to ALD-45.'
    expect(linkedIssueIds(brief)).toEqual(['ALD-44'])
  })

  test('a task written as instructions fetches the ticket it links', () => {
    expect(linkedIssueIds('Implement https://linear.app/acme/issue/ALD-45/slug, keep it small')).toEqual(['ALD-45'])
  })
})

describe('hydrateTask', () => {
  test('AC1: a named path is carried with its contents at the base commit, the task above it verbatim', async () => {
    const task = `Fix the rollover in \`${MAPPER}\`.`
    const out = await hydrateTask(task, work, linear())
    expect(out.task.startsWith(`${task}\n\n## Context\n`)).toBe(true)
    expect(out.task).toContain(`### \`${MAPPER}\`\n\`\`\`ts\n${FILES[MAPPER]}\`\`\``)
    expect(out.log[0]).toEqual({ stream: 'sys', text: expect.stringContaining('0 issue(s) and 1 file(s) added') })
  })

  test('AC2: a named path absent at the base is listed as missing', async () => {
    const out = await hydrateTask('Start from `src/features/usage/lib/gone.ts:12`.', work, linear())
    expect(out.task).toContain('### Missing at the base commit\n- `src/features/usage/lib/gone.ts`')
  })

  test('a partial path or bare name is taken when one tracked file matches, and an ambiguous bare name is dropped quietly', async () => {
    const out = await hydrateTask('Touch `lib/map-billing-cycle-history.test.ts`, `a/index.ts` and `index.ts`.', work, linear())
    expect(out.task).toContain('### `src/features/usage/lib/map-billing-cycle-history.test.ts`')
    expect(out.task).toContain('### `src/a/index.ts`')
    expect(out.task).not.toContain('src/b/index.ts')
    expect(out.task).not.toContain('Not included')
  })

  test('AC3: a linked issue is carried with its title and description', async () => {
    const out = await hydrateTask('Blocked by ALD-44.', work, linear())
    expect(out.task).toContain('### ALD-44: ALD-44 title\nhttps://linear.app/acme/issue/ALD-44/slug\n\nThe ALD-44 description.')
  })

  test('AC3: with no Linear key the id is carried with the reason, an err line is logged, and nothing throws', async () => {
    const out = await hydrateTask('Blocked by ALD-44.', work, { ...linear(), linearKey: undefined })
    expect(out.task).toContain('- ALD-44 — not fetched: no Linear key on the host')
    expect(out.log.some((l) => l.stream === 'err' && l.text.includes('ALD-44'))).toBe(true)
  })

  test('an issue Linear fails on is listed with the reason and logged; one it does not know adds nothing', async () => {
    const calls: Array<string> = []
    const out = await hydrateTask('See ALD-500 and UTF-8.', work, linear(calls))
    expect(calls.sort()).toEqual(['ALD-500', 'UTF-8'])
    expect(out.task).toContain('- ALD-500 — not fetched: HTTP 503')
    expect(out.task).not.toContain('UTF-8 —')
    expect(out.log.some((l) => l.stream === 'err' && l.text.includes('HTTP 503'))).toBe(true)
    expect((await hydrateTask('Encode as UTF-8.', work, linear())).task).toBe('Encode as UTF-8.')
  })

  test('AC4: files are carried whole up to the cap, and the rest are named as cut, never truncated', async () => {
    const out = await hydrateTask('Split `src/big/one.ts`, `src/big/two.ts` and `src/big/three.ts`.', work, linear())
    expect(out.task).toContain(FILES['src/big/one.ts'] as string)
    expect(out.task).toContain(FILES['src/big/two.ts'] as string)
    expect(out.task).not.toContain('// three')
    expect(out.task).toContain('- `src/big/three.ts` — cut at the 64.0 KB context cap')
  })

  test('a file over the cap on its own is named, and the files after it still come', async () => {
    const out = await hydrateTask(`See \`src/huge.ts\` then \`${MAPPER}\`.`, work, linear())
    expect(out.task).toContain('- `src/huge.ts` — 64.0 KB, over the 64.0 KB context cap on its own')
    expect(out.task).toContain(`### \`${MAPPER}\``)
  })

  test('a binary file is named, not carried; a markdown file keeps its own fences', async () => {
    const out = await hydrateTask('See `assets/logo.bin` and `docs/notes.md`.', work, linear())
    expect(out.task).toContain('- `assets/logo.bin` — binary')
    expect(out.task).toContain(`### \`docs/notes.md\`\n\`\`\`\`md\n${FILES['docs/notes.md']}\`\`\`\``)
  })

  test('a long task leaves the context less room, so the whole stays one argument Linux accepts', async () => {
    const task = `${'x'.repeat(100 * 1024)} then \`src/big/one.ts\``
    const out = await hydrateTask(task, work, linear())
    expect(out.task).toContain('- `src/big/one.ts` — cut at the 20.0 KB context cap')
    expect(Buffer.byteLength(out.task)).toBeLessThan(ARG_BUDGET)
  })

  test('a task naming nothing is handed on unchanged', async () => {
    const out = await hydrateTask('Tidy the README wording.', work, linear())
    expect(out).toEqual({ log: [], task: 'Tidy the README wording.' })
  })

  test('a workspace that is not a repo logs an err line and never throws', async () => {
    const out = await hydrateTask(`See \`${MAPPER}\`.`, path.join(work, 'nowhere'), linear())
    expect(out.task).toBe(`See \`${MAPPER}\`.`)
    expect(out.log.some((l) => l.stream === 'err' && l.text.startsWith("context: could not list the repo's files"))).toBe(true)
  })
})
