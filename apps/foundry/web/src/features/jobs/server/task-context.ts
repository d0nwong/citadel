/**
 * Node-only. What a task points at, resolved on the host before its container
 * starts (CTD-190): the tickets it links, read through the tickets package
 * (CTD-204), and the repo files it names in backticks, read from the job's
 * clone at the base commit. Appended under `## Context` so the first step
 * starts with them instead of spending turns finding them. The row's `task`
 * stays verbatim; only what the container is handed grows.
 *
 * A ticket cut from a revision (CTD-195) also brings that revision's spec and
 * the arch doc of every feature it names, read from citadel-data
 * (`ARGUS_DATA_DIR`) here on the host; the container never sees citadel-data.
 * Only `revisions/<KEY>/revision.json`, its `specs/`, a feature's
 * `docs/arch.md` and each app's `.doc-workspace/feature-manifest.json` are
 * read — never a ledger.
 *
 * Never fails a job: a path that is not there is listed as missing, a ticket
 * that cannot be fetched is listed with the reason and an `err` line.
 */
import { execFile } from 'node:child_process'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { MissingCredentialError } from '@citadel/tickets'
import type { Ticket } from '@citadel/tickets'
import { trim1 } from '@/shared/lib/format'
import { ticketIdsInTask } from './linear-link'

const exec = promisify(execFile)

/** The issues and files carried whole, in UTF-8 bytes, at most; `ARG_BUDGET` leaves a long task less. */
export const CONTEXT_CAP = 64 * 1024
/** Linked issues fetched per job; the rest are listed, not fetched. */
export const MAX_ISSUES = 10
/**
 * What the task and its context may come to together: the first step gets
 * both as one `claude -p` argument, and Linux refuses one over 128 KiB, so a
 * long ticket leaves the context less room.
 */
export const ARG_BUDGET = 120 * 1024

/** A backticked token with no whitespace in it: a path, a name, an id. */
const BACKTICKED = /`([^`\s]+)`/g
/** The line reference a ticket hangs on a path: `:78`, `:74–76`, `:74-76`. */
const LINE_REF = /:\d+(?:[–-]\d+)?$/
const DOT_SLASH = /^\.\//
/** A file, not a directory or an image tag: it ends in an extension. */
const EXTENSION = /\.([A-Za-z0-9]+)$/
/** A glob, a placeholder or a template: a pattern, never one file. */
const PATTERN = /[*?{}<>$|]/
/** The ticket brief's head (`ticketBrief`): its own ticket is already the task, whichever provider its url is on. */
const BRIEF_HEAD = /^([A-Z][A-Z0-9]*-\d+): .*\nhttps:\/\/\S+\n/
/** Git's own test for a binary file: a NUL in the first 8000 bytes. */
const BINARY_PROBE = 8000
/** A ticket key, the only thing a revision's directory is named after once filed. */
const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/
/** One segment of a feature key — `foundry`, `alden-portal`, `admin` — never `..` or empty. */
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/
/** The manifest id prefixes `featureDirOf` strips: `shared-hooks` → `shared/hooks`, `admin-usage` → `admin/usage`. */
const SHARED_PREFIX = /^shared-/
const ADMIN_PREFIX = /^admin-/

const HEADER =
  '## Context\n\nResolved by the host before this run from what the task above names: linked tickets as their tracker has them now, the reviewed spec and arch doc of a revision the ticket belongs to, files as they stand at the base commit. The task is verbatim; where its line numbers disagree with a file here, the file is current.'

export interface ContextDeps {
  /** One linked ticket, from the provider its key names — the tickets package's `getTicket` (CTD-204). Rejects when the ticket cannot be fetched, including a missing credential. */
  tickets: { get: (key: string) => Promise<Ticket | null> }
  /** citadel-data on this host (`ARGUS_DATA_DIR`); undefined when none is configured. */
  dataDir?: string
}

export interface HydratedTask {
  task: string
  log: Array<{ stream: 'sys' | 'err'; text: string }>
}

type Kind = 'issue' | 'spec' | 'arch' | 'file'

interface Block {
  kind: Kind
  label: string
  text: string
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
const exists = (p: string) => stat(p).then(() => true, () => false)
const readIf = (p: string) => readFile(p, 'utf8').catch(() => null)
const message = (e: unknown) => trim1(e instanceof Error ? e.message : String(e), 200)

/**
 * Repo files a task names in backticks. `paths` carry a directory and are
 * listed as missing when nothing matches; `names` are bare file names, taken
 * only when exactly one tracked file has that name, and dropped quietly
 * otherwise, since a bare `index.ts` names nothing in particular.
 */
export function namedFiles(task: string): { paths: Array<string>; names: Array<string> } {
  const paths = new Set<string>()
  const names = new Set<string>()
  for (const [, raw] of task.matchAll(BACKTICKED)) {
    const token = raw.replace(LINE_REF, '').replace(DOT_SLASH, '')
    if (!EXTENSION.test(token) || PATTERN.test(token) || token.includes('://')) {
      continue
    }
    if (token.startsWith('/') || token.startsWith('~') || token.split('/').includes('..')) {
      continue
    }
    if (token.includes('/')) {
      paths.add(token)
    } else {
      names.add(token)
    }
  }
  return { names: [...names], paths: [...paths] }
}

/** The tickets a task links, less the brief's own ticket when the task is a ticket brief. */
export function linkedIssueIds(task: string): Array<string> {
  const own = BRIEF_HEAD.exec(task)?.[1]
  return ticketIdsInTask(task).filter((id) => id !== own)
}

/** A fence longer than any backtick run inside, so a markdown file cannot close it early. */
function fenced(body: string, lang: string): string {
  const longest = [...body.matchAll(/`+/g)].reduce((n, m) => Math.max(n, m[0].length), 0)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${lang}\n${body}${body.endsWith('\n') ? '' : '\n'}${fence}`
}

async function issueBlocks(
  ids: Array<string>,
  deps: ContextDeps,
  log: HydratedTask['log'],
): Promise<{ blocks: Array<Block>; skipped: Array<string>; known: Map<string, Ticket> }> {
  const blocks: Array<Block> = []
  const skipped: Array<string> = []
  const known = new Map<string, Ticket>()
  if (ids.length === 0) {
    return { blocks, known, skipped }
  }
  const fetched = ids.slice(0, MAX_ISSUES)
  for (const id of ids.slice(MAX_ISSUES)) {
    skipped.push(`${id} — past the ${MAX_ISSUES}-issue limit, not fetched`)
  }
  const results = await Promise.allSettled(fetched.map((id) => deps.tickets.get(id)))
  for (const [i, r] of results.entries()) {
    const id = fetched[i]
    if (r.status === 'rejected') {
      const reason = message(r.reason)
      skipped.push(`${id} — not fetched: ${reason}`)
      log.push({ stream: 'err', text: `context: ${id} not fetched — ${reason}` })
    } else if (r.value !== null) {
      const { key, title, url, description } = r.value
      known.set(id, r.value)
      blocks.push({ kind: 'issue', label: key, text: `### ${key}: ${title}\n${url}\n\n${description.trim()}` })
    }
    // null: no provider knows this id, so it was ordinary text (`ISO-8601`).
  }
  return { blocks, known, skipped }
}

/** `foundry/jobs` → `<dataDir>/foundry/features/jobs`; `alden/alden-portal/admin/usage` → under `alden/alden-portal/features`. */
async function featureDir(dataDir: string, feature: string): Promise<string | null> {
  const segs = feature.split('/')
  for (const n of [2, 1]) {
    if (segs.length <= n) {
      continue
    }
    const dir = path.join(dataDir, ...segs.slice(0, n), 'features', ...segs.slice(n))
    if (await exists(dir)) {
      return dir
    }
  }
  return null
}

/** Where a feature manifest lives under an app's directory. */
const MANIFEST = '.doc-workspace/feature-manifest.json'
/** citadel's own top-level workspace directories; a manifest's `repo` names its place under
 * one of them (`~/git/citadel/apps/foundry`), while a ticket names a path from there down
 * (`apps/foundry/...`). A `repo` naming neither — `alden-portal`'s `fe_repo`/`be_repo` point
 * outside this checkout entirely — owns nothing a ticket can name. */
const WORKSPACE_ROOTS = new Set(['apps', 'packages'])

interface ManifestFeature {
  id: string
  dir?: string
  type?: string
  core_files?: unknown
  core_files_extra?: unknown
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isManifestFeature = (v: unknown): v is ManifestFeature => isObj(v) && typeof v.id === 'string'

/** A feature's docs directory, the same derivation the manifest tooling (`accio`, argus) uses: the curated `dir` wins, else it comes from the id. */
const featureDirOf = (f: ManifestFeature): string =>
  f.dir ?? (f.type === 'shared' ? `shared/${f.id.replace(SHARED_PREFIX, '')}` : f.id.replace(ADMIN_PREFIX, 'admin/'))

/** The rightmost `apps/…` or `packages/…` tail of an absolute `repo` path, or null when it names neither. */
function repoTail(repo: string): string | null {
  const segs = repo.split('/')
  const fromEnd = [...segs].reverse().findIndex((s) => WORKSPACE_ROOTS.has(s))
  return fromEnd < 0 ? null : segs.slice(segs.length - 1 - fromEnd).join('/')
}

/** Every app directory under citadel-data holding a feature manifest — one level down (`foundry`), or two (`alden/alden-portal`). */
async function manifestApps(dataDir: string): Promise<Array<string>> {
  const dirs = async (p: string) =>
    (await readdir(p, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name)
  const apps: Array<string> = []
  for (const a of await dirs(dataDir)) {
    if (await exists(path.join(dataDir, a, MANIFEST))) {
      apps.push(a)
      continue
    }
    for (const b of await dirs(path.join(dataDir, a))) {
      if (await exists(path.join(dataDir, a, b, MANIFEST))) {
        apps.push(`${a}/${b}`)
      }
    }
  }
  return apps
}

interface Owned {
  /** `<app>/<feature dir>` — the key `featureDir` and a revision's features use. */
  feature: string
  /** A `core_files` entry resolved to a monorepo-relative path or directory. */
  path: string
}

/** `declared` is a file or a directory `path` names, or is above: the same rule `core_files` uses to claim a file on disk, carried across the boundary between the monorepo root and the manifest's own `repo`. */
const owns = (declared: string, file: string) => file === declared || file.startsWith(`${declared}/`)

/** `core_files` plus the curated `core_files_extra` — the manifest tooling's own combined list (argus's `allCoreFiles`). */
function coreFilesOf(f: ManifestFeature): Array<string> {
  const raw = [...(Array.isArray(f.core_files) ? f.core_files : []), ...(Array.isArray(f.core_files_extra) ? f.core_files_extra : [])]
  return raw.filter((c): c is string => typeof c === 'string')
}

/** One manifest's features, each `core_files` entry resolved to a monorepo path from `tail`; a feature whose derived directory is not a valid key segment is left out. */
function ownedFrom(app: string, tail: string, features: Array<unknown>): Array<Owned> {
  const owned: Array<Owned> = []
  for (const f of features) {
    if (!isManifestFeature(f)) {
      continue
    }
    const feature = featureDirOf(f)
    if (!feature.split('/').every((s) => SEGMENT.test(s))) {
      continue
    }
    for (const c of coreFilesOf(f)) {
      owned.push({ feature: `${app}/${feature}`, path: path.join(tail, c) })
    }
  }
  return owned
}

/** One app's manifest, read and resolved: its owned entries, or the one line saying why it has none. A manifest with no monorepo `repo` — `alden-portal`'s two external repos — owns nothing here, quietly: `trouble` is only ever an unreadable or malformed file. */
async function readManifest(dataDir: string, app: string): Promise<{ owned: Array<Owned>; trouble: string | null }> {
  const raw = await readIf(path.join(dataDir, app, MANIFEST))
  if (raw === null) {
    return { owned: [], trouble: `${app} — unreadable` }
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(raw)
  } catch (e) {
    return { owned: [], trouble: `${app} — malformed: ${message(e)}` }
  }
  if (!isObj(manifest) || typeof manifest.repo !== 'string' || !Array.isArray(manifest.features)) {
    return { owned: [], trouble: null }
  }
  const tail = repoTail(manifest.repo)
  return { owned: tail === null ? [] : ownedFrom(app, tail, manifest.features), trouble: null }
}

/**
 * Every app's feature manifest under citadel-data, flattened to what each
 * feature's `core_files` resolve to from the monorepo root. Tolerates an
 * absent, unreadable or malformed manifest.
 */
export async function featureManifests(dataDir: string): Promise<{ owned: Array<Owned>; note: string }> {
  if (!(await exists(dataDir))) {
    return { owned: [], note: `no feature manifests — no citadel-data at ${dataDir}` }
  }
  const apps = await manifestApps(dataDir)
  const owned: Array<Owned> = []
  const trouble: Array<string> = []
  for (const app of apps) {
    const read = await readManifest(dataDir, app)
    owned.push(...read.owned)
    if (read.trouble !== null) {
      trouble.push(read.trouble)
    }
  }
  const note = `feature manifests — ${apps.length} app(s), ${owned.length} core file(s)${trouble.length > 0 ? `; ${trouble.join('; ')}` : ''}`
  return { owned, note }
}

/**
 * The single `<app>/<feature>` a monorepo-relative path belongs to, by whose
 * `core_files` declare it — or null when nothing declares it, or when more
 * than one feature does (AC2): a claim shared by two features says nothing
 * about which owns the file, so it is carried as neither.
 */
export function featureOwning(file: string, owned: Array<Owned>): string | null {
  const features = new Set(owned.filter((o) => owns(o.path, file)).map((o) => o.feature))
  const [only] = features
  return features.size === 1 ? only : null
}

interface RevisionSource {
  blocks: Array<Block>
  skipped: Array<string>
  /** One `sys` line saying what was found, or why nothing was; empty when the task is about no ticket. */
  note: string
}

const nothing = (note: string): RevisionSource => ({ blocks: [], note, skipped: [] })

/**
 * The filed revision under `revisions/<parentKey>/`: every feature's spec,
 * then every feature's arch doc. Specs come first because a cut at the cap
 * should cost the reference before it costs the reviewed spec.
 */
export async function revisionBlocks(parentKey: string, dataDir: string): Promise<RevisionSource> {
  if (!TICKET_KEY.test(parentKey)) {
    return nothing(`no revision — ${parentKey} is not a ticket key`)
  }
  if (!(await exists(dataDir))) {
    return nothing(`no revision — no citadel-data at ${dataDir}`)
  }
  const dir = path.join(dataDir, 'revisions', parentKey)
  let rev: { status?: unknown; features?: unknown }
  try {
    rev = JSON.parse(await readFile(path.join(dir, 'revision.json'), 'utf8'))
  } catch (e) {
    return (e as { code?: string }).code === 'ENOENT'
      ? nothing(`no revision for ${parentKey}`)
      : nothing(`no revision — revisions/${parentKey}/revision.json unreadable: ${message(e)}`)
  }
  if (rev.status !== 'filed') {
    return nothing(`no revision — revisions/${parentKey} is ${String(rev.status)}, not filed`)
  }
  const features = Array.isArray(rev.features) ? rev.features.filter((f): f is string => typeof f === 'string') : []
  const specs: Array<Block> = []
  const archs: Array<Block> = []
  const skipped: Array<string> = []
  for (const f of features) {
    if (!f.split('/').every((s) => SEGMENT.test(s))) {
      skipped.push(`\`${f}\` — not a feature key`)
      continue
    }
    const spec = await readIf(path.join(dir, 'specs', `${f}.md`))
    if (spec === null) {
      skipped.push(`Spec: ${f} — revisions/${parentKey} has no spec for it`)
    } else {
      specs.push({ kind: 'spec', label: `Spec: ${f}`, text: `### Spec: ${f}\n${fenced(spec, 'md')}` })
    }
    const fdir = await featureDir(dataDir, f)
    const arch = fdir === null ? null : await readIf(path.join(fdir, 'docs', 'arch.md'))
    if (arch === null) {
      skipped.push(`Arch: ${f} — no arch doc`)
    } else {
      archs.push({ kind: 'arch', label: `Arch: ${f}`, text: `### Arch: ${f}\n${fenced(arch, 'md')}` })
    }
  }
  return { blocks: [...specs, ...archs], note: `revisions/${parentKey} — ${features.length} feature(s)`, skipped }
}

/**
 * The ticket the task is about — the brief's own, else the first linked ticket
 * its tracker knows — and the revision its parent carries. The own ticket is
 * not in `known` (issues skips it), so it is fetched here, once, for its parent.
 */
async function revisionSource(
  own: string | undefined,
  ids: Array<string>,
  known: Map<string, Ticket>,
  deps: ContextDeps,
): Promise<RevisionSource> {
  const id = own ?? ids.find((i) => known.has(i))
  if (id === undefined) {
    return nothing('')
  }
  let subject = known.get(id)
  if (!subject) {
    try {
      subject = (await deps.tickets.get(id)) ?? undefined
    } catch (e) {
      if (e instanceof MissingCredentialError) {
        return nothing(`revision not checked — no ${e.variable} to read ${id}'s parent`)
      }
      return nothing(`revision not checked — ${id} not fetched: ${message(e)}`)
    }
    if (!subject) {
      return nothing(`revision not checked — no such ticket ${id}`)
    }
  }
  if (!subject.parentKey) {
    return nothing(`no revision — ${id} has no parent`)
  }
  if (!deps.dataDir) {
    return nothing('no revision — no ARGUS_DATA_DIR on the host')
  }
  return revisionBlocks(subject.parentKey, deps.dataDir)
}

async function fileBlock(work: string, file: string): Promise<Block | { skip: string }> {
  const abs = path.join(work, file)
  const st = await lstat(abs).catch(() => null)
  if (!st?.isFile()) {
    return { skip: st?.isSymbolicLink() ? 'a symlink' : 'not a regular file' }
  }
  if (st.size > CONTEXT_CAP) {
    return { skip: `${kb(st.size)}, over the ${kb(CONTEXT_CAP)} context cap on its own` }
  }
  const buf = await readFile(abs)
  if (buf.subarray(0, BINARY_PROBE).includes(0)) {
    return { skip: 'binary' }
  }
  const lang = EXTENSION.exec(file)?.[1] ?? ''
  return { kind: 'file', label: `\`${file}\``, text: `### \`${file}\`\n${fenced(buf.toString('utf8'), lang)}` }
}

/** The tracked file a token names: exact, else a unique suffix match, since a ticket often names a path from partway down. */
function resolveToken(token: string, exact: Set<string>, tracked: Array<string>): { file: string } | { matches: number } {
  if (exact.has(token)) {
    return { file: token }
  }
  const hits = tracked.filter((f) => f.endsWith(`/${token}`))
  return hits.length === 1 ? { file: hits[0] } : { matches: hits.length }
}

async function fileBlocks(
  tokens: { paths: Array<string>; names: Array<string> },
  work: string,
  log: HydratedTask['log'],
): Promise<{ blocks: Array<Block>; missing: Array<string>; skipped: Array<string> }> {
  const blocks: Array<Block> = []
  const missing: Array<string> = []
  const skipped: Array<string> = []
  if (tokens.paths.length === 0 && tokens.names.length === 0) {
    return { blocks, missing, skipped }
  }
  let tracked: Array<string>
  try {
    const { stdout } = await exec('git', ['-C', work, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 })
    tracked = stdout.split('\0').filter(Boolean)
  } catch (e) {
    log.push({ stream: 'err', text: `context: could not list the repo's files — ${message(e)}` })
    return { blocks, missing, skipped }
  }
  const exact = new Set(tracked)
  const seen = new Set<string>()
  for (const token of [...tokens.paths, ...tokens.names]) {
    const found = resolveToken(token, exact, tracked)
    if ('matches' in found) {
      // A bare name matching none or several files names nothing in particular: dropped quietly.
      if (token.includes('/') && found.matches === 0) {
        missing.push(token)
      } else if (token.includes('/')) {
        skipped.push(`\`${token}\` — matches ${found.matches} files`)
      }
      continue
    }
    const { file } = found
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const block = await fileBlock(work, file)
    if ('skip' in block) {
      skipped.push(`\`${file}\` — ${block.skip}`)
    } else {
      blocks.push(block)
    }
  }
  return { blocks, missing, skipped }
}

/**
 * `task` with a `## Context` section appended, or unchanged when it names
 * nothing that resolves. Issues come first, then a revision's specs and arch
 * docs, then files in the order the task names them; each is carried whole
 * until the next would pass the cap (`CONTEXT_CAP`, less for a long task),
 * and everything from there on is listed as cut, never truncated mid-file.
 */
export async function hydrateTask(task: string, work: string, deps: ContextDeps): Promise<HydratedTask> {
  const log: HydratedTask['log'] = []
  const own = BRIEF_HEAD.exec(task)?.[1]
  const ids = linkedIssueIds(task)
  const tokens = namedFiles(task)
  if (own === undefined && ids.length === 0 && tokens.paths.length === 0 && tokens.names.length === 0) {
    return { log, task }
  }

  const issues = await issueBlocks(ids, deps, log)
  const revision = await revisionSource(own, ids, issues.known, deps)
  if (revision.note !== '') {
    log.push({ stream: 'sys', text: `context: ${revision.note}` })
  }
  const files = await fileBlocks(tokens, work, log)
  const skipped = [...issues.skipped, ...revision.skipped, ...files.skipped]

  const cap = Math.min(CONTEXT_CAP, ARG_BUDGET - Buffer.byteLength(task))
  const kept: Array<Block> = []
  let used = 0
  let cut = false
  for (const block of [...issues.blocks, ...revision.blocks, ...files.blocks]) {
    const size = Buffer.byteLength(block.text) + 2
    cut ||= used + size > cap
    if (cut) {
      skipped.push(`${block.label} — cut at the ${kb(Math.max(cap, 0))} context cap`)
      continue
    }
    kept.push(block)
    used += size
  }

  if (kept.length === 0 && files.missing.length === 0 && skipped.length === 0) {
    return { log, task }
  }
  const parts = [HEADER, ...kept.map((b) => b.text)]
  if (files.missing.length > 0) {
    parts.push(`### Missing at the base commit\n${files.missing.map((m) => `- \`${m}\``).join('\n')}`)
  }
  if (skipped.length > 0) {
    parts.push(`### Not included\n${skipped.map((s) => `- ${s}`).join('\n')}`)
  }
  const count = (k: Kind) => kept.filter((b) => b.kind === k).length
  log.unshift({
    stream: 'sys',
    text: `context: ${count('issue')} issue(s), ${count('spec')} spec(s), ${count('arch')} arch doc(s) and ${count('file')} file(s) added (${kb(used)}); ${files.missing.length} missing, ${skipped.length} not included`,
  })
  return { log, task: `${task}\n\n${parts.join('\n\n')}\n` }
}
