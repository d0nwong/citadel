/**
 * The task's `## Context` (CTD-190) against a real git repo in a temp dir and a
 * stubbed tickets package: what counts as a named file, what is carried whole,
 * what is listed as missing or not included, and that nothing here fails a
 * job. No database, no docker.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { MissingCredentialError } from '@citadel/tickets'
import type { Ticket } from '@citadel/tickets'
import { ARG_BUDGET, CONTEXT_CAP, featureManifests, featureOwning, hydrateTask, linkedIssueIds, namedFiles } from './task-context'
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
  'scripts/build': '#!/usr/bin/env bash\necho build\n',
  'apps/one/lib/dup.ts': 'export const one = 1\n',
  'apps/two/lib/dup.ts': 'export const two = 2\n',
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

const issue = (identifier: string): Ticket => ({
  description: `The ${identifier} description.`,
  key: identifier,
  title: `${identifier} title`,
  url: `https://linear.app/acme/issue/${identifier}/slug`,
  state: { state: 'open', name: 'Todo', provider: 'linear', url: `https://linear.app/acme/issue/${identifier}/slug` },
})

/** A tracker that knows ALD-44 and ALD-45, knows nothing of UTF-8, and is down for ALD-500. */
const linear = (calls: Array<string> = []): ContextDeps => ({
  tickets: {
    get: async (id) => {
      calls.push(id)
      if (id === 'ALD-500') {
        throw new Error('HTTP 503')
      }
      return id === 'ALD-44' || id === 'ALD-45' ? issue(id) : null
    },
  },
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

  test('AC1: strips a comma-separated list of references and ranges, en dash and hyphen', () => {
    const task = [
      '`apps/argus/scripts/argus/blockers.ts:36,47,72,86-87`',
      '`apps/argus/scripts/argus/pull.ts:65-73,88-98`',
      '`z/w.sh:74–76,80`',
    ].join(' ')
    expect(namedFiles(task)).toEqual({
      names: [],
      paths: ['apps/argus/scripts/argus/blockers.ts', 'apps/argus/scripts/argus/pull.ts', 'z/w.sh'],
    })
  })

  test('AC3: a time, a ratio and a bare id with a colon are not paths and add nothing', () => {
    const task = '`10:30` `3:1` `node:20` `1:23:45`'
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

  test('a Trello card brief does not fetch its own card either, only the ones it links', () => {
    const brief = 'AP-45: title\nhttps://trello.com/c/abc123\n\nBlocked by ALD-44. Related to AP-45.'
    expect(linkedIssueIds(brief)).toEqual(['ALD-44'])
  })
})

describe('hydrateTask', () => {
  test('AC1: a named path is carried with its contents at the base commit, the task above it verbatim', async () => {
    const task = `Fix the rollover in \`${MAPPER}\`.`
    const out = await hydrateTask(task, work, linear())
    expect(out.task.startsWith(`${task}\n\n## Context\n`)).toBe(true)
    expect(out.task).toContain(`### \`${MAPPER}\`\n\`\`\`ts\n${FILES[MAPPER]}\`\`\``)
    expect(out.log[0]).toEqual({ stream: 'sys', text: expect.stringContaining('0 issue(s), 0 spec(s), 0 arch doc(s) and 1 file(s) added') })
  })

  test('AC1: a comma-separated list of references and ranges resolves the file whole, same as one reference', async () => {
    const out = await hydrateTask(`Fix \`${MAPPER}:36,47,72,86-87\`.`, work, linear())
    expect(out.task).toContain(`### \`${MAPPER}\`\n\`\`\`ts\n${FILES[MAPPER]}\`\`\``)
    expect(out.task).not.toContain('Missing at the base commit')
    expect(out.task).not.toContain('Not included')
  })

  test('AC2: a named path absent at the base is listed as missing', async () => {
    const out = await hydrateTask('Start from `src/features/usage/lib/gone.ts:12`.', work, linear())
    expect(out.task).toContain('### Missing at the base commit\n- `src/features/usage/lib/gone.ts`')
  })

  test('AC2: an extensionless path resolves when tracked, and is listed as missing when not', async () => {
    const out = await hydrateTask('Run `scripts/build` after editing `apps/argus/scripts/argus`.', work, linear())
    expect(out.task).toContain('### `scripts/build`')
    expect(out.task).toContain('### Missing at the base commit\n- `apps/argus/scripts/argus`')
  })

  test('AC2: a path matching several tracked files is listed under Not included, with the count', async () => {
    const out = await hydrateTask('See `lib/dup.ts`.', work, linear())
    expect(out.task).toContain('### Not included\n- `lib/dup.ts` — matches 2 files')
  })

  test('AC3: a version-shaped bare token is not carried, and adds nothing to the output', async () => {
    const out = await hydrateTask('Bump to `v1.2.3` from `1.2.3`.', work, linear())
    expect(out.task).toBe('Bump to `v1.2.3` from `1.2.3`.')
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
    const noKey: ContextDeps = { tickets: { get: async () => { throw new MissingCredentialError('LINEAR_API_KEY') } } }
    const out = await hydrateTask('Blocked by ALD-44.', work, noKey)
    expect(out.task).toContain('- ALD-44 — not fetched: LINEAR_API_KEY is not set')
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

/**
 * The revision source (CTD-195) against a temp citadel-data: a ticket whose
 * Linear parent has a filed revision is handed the revision's specs and the
 * features' arch docs, in that order, before the files; every way of having no
 * revision adds nothing and says why in one sys line; nothing but the
 * revision and the arch docs is read.
 */
describe('the revision source', () => {
  let data = ''
  const SPEC = '---\nfeature: foundry/jobs\nrevised_by: CTD-900\nnext_id: 3\n---\n# Spec: Jobs\n\n## Criteria\n- S-1 — a job runs.\n'
  const ARCH = '# Jobs — Architecture\n\nThe host clones; the container runs.\n'
  const put = async (rel: string, body: string) => {
    await mkdir(path.dirname(path.join(data, rel)), { recursive: true })
    await writeFile(path.join(data, rel), body)
  }
  const rev = (key: string, status: string, features: Array<string>) =>
    JSON.stringify({ features, key, slug: key.toLowerCase(), status, tickets: [] })

  beforeAll(async () => {
    data = await mkdtemp(path.join(tmpdir(), 'foundry-data-'))
    await put('revisions/CTD-900/revision.json', rev('CTD-900', 'filed', ['foundry/jobs', 'foundry/ghost']))
    await put('revisions/CTD-900/specs/foundry/jobs.md', SPEC)
    await put('revisions/CTD-800/revision.json', rev('CTD-800', 'draft', ['foundry/jobs']))
    await put('revisions/CTD-700/revision.json', rev('CTD-700', 'filed', ['../../etc', 'alden/alden-portal/admin/usage']))
    await put('revisions/CTD-700/specs/alden/alden-portal/admin/usage.md', '# Spec: Usage\n')
    await put('revisions/CTD-600/revision.json', rev('CTD-600', 'filed', ['foundry/jobs']))
    await put('revisions/CTD-600/specs/foundry/jobs.md', `# Spec: big\n${'s'.repeat(CONTEXT_CAP)}\n`)
    await put('foundry/features/jobs/docs/arch.md', ARCH)
    await put('foundry/features/jobs/ledger.json', '{"secret":"LEDGER-MUST-NOT-LEAK"}')
    await put('alden/alden-portal/features/admin/usage/docs/arch.md', '# Usage — Architecture\n')
  })
  afterAll(async () => {
    await rm(data, { force: true, recursive: true })
  })

  /** A tracker that knows each id in `parents`, with that parent (or none), and fails on CTD-503. */
  const deps = (parents: Record<string, string | undefined>, over: Partial<ContextDeps> = {}, calls: Array<string> = []): ContextDeps => ({
    dataDir: data,
    tickets: {
      get: async (id) => {
        calls.push(id)
        if (id === 'CTD-503') {
          throw new Error('HTTP 503')
        }
        if (!(id in parents)) {
          return null
        }
        const parent = parents[id]
        return { ...issue(id), ...(parent ? { parentKey: parent } : {}) }
      },
    },
    ...over,
  })
  const brief = (id: string, body = `Fix \`${MAPPER}\`.`) => `${id}: title\nhttps://linear.app/acme/issue/${id}/slug\n\n${body}`

  test('AC1: a brief whose parent has a filed revision gets its specs, then its arch docs, before the files', async () => {
    const calls: Array<string> = []
    const out = await hydrateTask(brief('CTD-901'), work, deps({ 'CTD-901': 'CTD-900' }, {}, calls))
    expect(calls).toEqual(['CTD-901'])
    const spec = out.task.indexOf(`### Spec: foundry/jobs\n\`\`\`md\n${SPEC}\`\`\``)
    const arch = out.task.indexOf(`### Arch: foundry/jobs\n\`\`\`md\n${ARCH}\`\`\``)
    const file = out.task.indexOf(`### \`${MAPPER}\``)
    expect(spec).toBeGreaterThan(0)
    expect(arch).toBeGreaterThan(spec)
    expect(file).toBeGreaterThan(arch)
    expect(out.task).toContain('- Spec: foundry/ghost — revisions/CTD-900 has no spec for it')
    expect(out.task).toContain('- Arch: foundry/ghost — no arch doc')
    expect(out.log[0]?.text).toContain('0 issue(s), 1 spec(s), 1 arch doc(s) and 1 file(s) added')
    expect(out.log).toContainEqual({ stream: 'sys', text: 'context: revisions/CTD-900 — 2 feature(s)' })
  })

  test('AC1: a task that links the ticket takes its parent from the issue already fetched', async () => {
    const calls: Array<string> = []
    const out = await hydrateTask('Implement https://linear.app/acme/issue/CTD-901/slug', work, deps({ 'CTD-901': 'CTD-900' }, {}, calls))
    expect(calls).toEqual(['CTD-901'])
    expect(out.task.indexOf('### CTD-901: CTD-901 title')).toBeLessThan(out.task.indexOf('### Spec: foundry/jobs'))
  })

  test('AC1/AC3: a brief for an AP sub-card whose parent has a filed revision gets its specs and arch docs, same as a Linear one', async () => {
    const apBrief = 'AP-207: title\nhttps://trello.com/c/abc123\n\nNo files named.'
    const calls: Array<string> = []
    const out = await hydrateTask(apBrief, work, deps({ 'AP-207': 'CTD-900' }, {}, calls))
    expect(calls).toEqual(['AP-207'])
    expect(out.task).toContain('### Spec: foundry/jobs')
    expect(out.task).toContain('### Arch: foundry/jobs')
    // the card's own brief is already the task; it must not also appear as a linked ticket block.
    expect(out.task).not.toContain('### AP-207:')
  })

  test('AC2: no parent, no revision, a draft, no data dir, no key, a failed fetch: nothing added, one sys line says which', async () => {
    const plain = (id: string) => brief(id, 'No files named.')
    const cases: Array<[string, ContextDeps, string]> = [
      ['CTD-902', deps({ 'CTD-902': undefined }), 'context: no revision — CTD-902 has no parent'],
      ['AP-208', deps({ 'AP-208': undefined }), 'context: no revision — AP-208 has no parent'],
      ['CTD-903', deps({ 'CTD-903': 'CTD-999' }), 'context: no revision for CTD-999'],
      ['CTD-801', deps({ 'CTD-801': 'CTD-800' }), 'context: no revision — revisions/CTD-800 is draft, not filed'],
      ['CTD-901', deps({ 'CTD-901': 'CTD-900' }, { dataDir: '/nowhere/citadel-data' }), 'context: no revision — no citadel-data at /nowhere/citadel-data'],
      ['CTD-901', deps({ 'CTD-901': 'CTD-900' }, { dataDir: undefined }), 'context: no revision — no ARGUS_DATA_DIR on the host'],
      [
        'CTD-901',
        deps({ 'CTD-901': 'CTD-900' }, { tickets: { get: async () => { throw new MissingCredentialError('LINEAR_API_KEY') } } }),
        "context: revision not checked — no LINEAR_API_KEY to read CTD-901's parent",
      ],
      ['CTD-503', deps({}), 'context: revision not checked — CTD-503 not fetched: HTTP 503'],
    ]
    for (const [id, d, line] of cases) {
      const out = await hydrateTask(plain(id), work, d)
      expect(out.task).toBe(plain(id))
      expect(out.log).toEqual([{ stream: 'sys', text: line }])
    }
  })

  test('AC3: an issue with no parent carries none; a task about no ticket says nothing about revisions', async () => {
    const out = await hydrateTask('Tidy `docs/notes.md`.', work, deps({}))
    expect(out.log.some((l) => l.text.includes('revision'))).toBe(false)
  })

  test('AC5: a key that climbs out of citadel-data is refused, a two-level app resolves, and no ledger is read', async () => {
    const out = await hydrateTask(brief('CTD-701'), work, deps({ 'CTD-701': 'CTD-700' }))
    expect(out.task).toContain('### Spec: alden/alden-portal/admin/usage')
    expect(out.task).toContain('### Arch: alden/alden-portal/admin/usage\n```md\n# Usage — Architecture\n```')
    expect(out.task).toContain('- `../../etc` — not a feature key')
    const again = await hydrateTask(brief('CTD-901'), work, deps({ 'CTD-901': 'CTD-900' }))
    expect(again.task).not.toContain('LEDGER-MUST-NOT-LEAK')
  })

  test('the cap still cuts whole blocks and never truncates a spec', async () => {
    const out = await hydrateTask(brief('CTD-601'), work, deps({ 'CTD-601': 'CTD-600' }))
    expect(out.task).not.toContain('s'.repeat(1000))
    expect(out.task).toContain('- Spec: foundry/jobs — cut at the 64.0 KB context cap')
    expect(out.task).toContain('- Arch: foundry/jobs — cut at the 64.0 KB context cap')
  })
})

/**
 * The feature that owns a named file (CTD-280), against a temp citadel-data
 * holding each app's own `.doc-workspace/feature-manifest.json`: `core_files`
 * resolve to a monorepo path by the manifest's own `repo`, a file two
 * features' `core_files` both declare maps to neither, and a manifest that
 * is missing, unreadable or malformed contributes nothing and raises nothing.
 */
describe('the feature that owns a file', () => {
  let data = ''
  const put = async (rel: string, body: string) => {
    await mkdir(path.dirname(path.join(data, rel)), { recursive: true })
    await writeFile(path.join(data, rel), body)
  }
  const manifest = (repo: string, features: Array<Record<string, unknown>>) => JSON.stringify({ app: 'x', features, repo })

  beforeAll(async () => {
    data = await mkdtemp(path.join(tmpdir(), 'foundry-manifests-'))
    // argus: one feature declaring two files by name, another declaring a whole directory.
    await put(
      'argus/.doc-workspace/feature-manifest.json',
      manifest('/home/dev/git/citadel/apps/argus', [
        { core_files: ['scripts/argus/blockers.ts', 'scripts/argus/pull.ts'], id: 'sweep', type: 'feature' },
        { core_files: ['scripts/accio'], id: 'accio', type: 'feature' },
      ]),
    )
    // foundry and foundry-admin: two citadel-data apps sharing one repo, one's directory nested inside the other's — AC2.
    await put(
      'foundry/.doc-workspace/feature-manifest.json',
      manifest('/home/dev/git/citadel/apps/foundry', [{ core_files: ['web/src/features/jobs'], id: 'jobs', type: 'feature' }]),
    )
    await put(
      'foundry-admin/.doc-workspace/feature-manifest.json',
      manifest('/home/dev/git/citadel/apps/foundry', [
        { core_files: ['web/src/features/jobs/server/task-context.ts'], id: 'misc', type: 'feature' },
      ]),
    )
    // alden-portal: a two-repo area (fe_repo/be_repo, no `repo`), nested two levels down — owns nothing here, quietly.
    await put(
      'alden/alden-portal/.doc-workspace/feature-manifest.json',
      JSON.stringify({
        app: 'alden-portal',
        be_repo: '~/git/alden-connect-portal-be',
        features: [{ core_files: ['src/pages/admin/usage'], id: 'admin-usage', type: 'feature' }],
        fe_repo: '~/git/alden-portal-fe',
      }),
    )
    // broken: not JSON at all.
    await put('broken/.doc-workspace/feature-manifest.json', '{ not json')
    // ghost: the manifest path is a directory, not a file — unreadable, not missing.
    await mkdir(path.join(data, 'ghost/.doc-workspace/feature-manifest.json'), { recursive: true })
  })

  afterAll(async () => {
    await rm(data, { force: true, recursive: true })
  })

  test('AC1: a named path maps to the feature whose core_files declare it; one no feature declares maps to nothing', async () => {
    const { note, owned } = await featureManifests(data)
    expect(featureOwning('apps/argus/scripts/argus/blockers.ts', owned)).toBe('argus/sweep')
    expect(featureOwning('apps/argus/scripts/accio/manifest.ts', owned)).toBe('argus/accio')
    expect(featureOwning('apps/argus/scripts/argus/nope.ts', owned)).toBeNull()
    expect(note).toContain('feature manifests — 6 app(s)')
  })

  test('AC2: a path two features declare, across two apps sharing one repo, maps to nothing rather than to either', async () => {
    const { owned } = await featureManifests(data)
    expect(featureOwning('apps/foundry/web/src/features/jobs/server/task-context.ts', owned)).toBeNull()
    // the same directory, one level up, only one feature claims — no ambiguity there.
    expect(featureOwning('apps/foundry/web/src/features/jobs/routes.ts', owned)).toBe('foundry/jobs')
  })

  test('AC3: a missing citadel-data directory yields no mapping, one sys-style line, and raises nothing', async () => {
    const out = await featureManifests('/nowhere/citadel-data')
    expect(out).toEqual({ note: 'no feature manifests — no citadel-data at /nowhere/citadel-data', owned: [] })
  })

  test('AC3: an unreadable or malformed manifest contributes nothing, named in one line with no newline, raising nothing', async () => {
    const { note, owned } = await featureManifests(data)
    expect(note.includes('\n')).toBe(false)
    expect(note).toContain('broken — malformed:')
    expect(note).toContain('ghost — unreadable')
    // the two-repo area's manifest is read without error and simply owns nothing.
    expect(owned.some((o) => o.feature.startsWith('alden'))).toBe(false)
    expect(owned.some((o) => o.feature === 'argus/sweep')).toBe(true)
  })
})
