/**
 * The blackboard reader. Pensieve never writes here — the ai-workspace loop owns every
 * file under WORKSPACE_DIR; this module only turns them into typed, serialisable shapes.
 *
 * Layout it expects (see ai-workspace/README.md "Layout"):
 *   reports/YYYY-MM-DD.md                                sweep report, one per day
 *   digests/YYYY-MM-DD.md                                Slack digest, one per day
 *   alden/alden-portal/features/<dir>/journal/**\/*.md   one entry per landing
 *   alden/alden-portal/features/<dir>/docs/{product,arch}.md
 */
import { homedir } from 'node:os'
import { join, relative, resolve, basename } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { parseMarkdown } from '@tanstack/markdown/parser'
import type { MarkdownDocument } from '@tanstack/markdown'

export const WORKSPACE_DIR = resolve(process.env.WORKSPACE_DIR || join(homedir(), 'git/ai-workspace'))
const FEATURES_DIR = join(WORKSPACE_DIR, 'alden/alden-portal/features')
const REPORTS_DIR = join(WORKSPACE_DIR, 'reports')
const DIGESTS_DIR = join(WORKSPACE_DIR, 'digests')

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type Frontmatter = Record<string, Json>

/** YAML can yield Dates and undefined; the wire only carries JSON. */
function toJson(v: unknown): Frontmatter {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return JSON.parse(JSON.stringify(v)) as Frontmatter
}

export interface Rendered {
  /** Serialisable AST — parsed once here, rendered by React on the client. */
  doc: MarkdownDocument
  frontmatter: Frontmatter
  /** Path relative to WORKSPACE_DIR, for "open in editor" affordances. */
  path: string
}

export interface DayFile {
  day: string
  path: string
  /** First non-heading line, for list previews. */
  lede?: string
}

export type JournalStatus = 'decided' | 'implemented' | 'documented' | 'superseded'

export interface JournalEntry {
  /** `<feature>/<slug>` — slugs alone are not unique (older day-level entries share `YYYY-MM-DD`). */
  id: string
  slug: string
  path: string
  feature: string
  date: string
  pr?: string
  url?: string
  merge?: string
  ticket?: string
  features: string[]
  scope?: string
  status?: JournalStatus
  hold?: string
  summary?: string
  source?: string
}

export interface DocMeta {
  feature: string
  tier: 'product' | 'arch'
  path: string
  id?: string
  name?: string
  status?: string
  owner?: string
  lastVerified?: string
  lastVerifiedDate?: string
  lastVerifiedBe?: string
  lastVerifiedBeDate?: string
  related: string[]
}

// ── helpers ────────────────────────────────────────────────────────────────────

const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.md$/

async function exists(p: string) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.isFile() && e.name.endsWith('.md')) yield p
  }
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return []
}

/**
 * Wikilinks are the journal's own cross-reference syntax: `[[slug]]` points at a sibling
 * entry, `[[YYYY-MM-DD]]` at a day. Resolve them to app routes before parsing so the
 * renderer only ever sees ordinary links.
 */
export function resolveWikilinks(src: string, feature?: string): string {
  return src.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim()
    const text = (label ?? t).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `[${text}](/journal?day=${t})`
    const id = feature ? `${feature}/${t}` : t
    return `[${text}](/journal/${id.split('/').map(encodeURIComponent).join('/')})`
  })
}

/** Doc regions are fenced with HTML comments (`<!-- accio:begin … -->`); readers never need them. */
const stripHtmlComments = (src: string) => src.replace(/<!--[\s\S]*?-->\n?/g, '')

function featureOf(abs: string): string | undefined {
  const rel = relative(FEATURES_DIR, abs)
  const m = rel.match(/^(.*?)\/(journal|docs)\//)
  return m?.[1]
}

/** Split frontmatter off, parse both halves, return the pair. */
export async function render(absPath: string): Promise<Rendered> {
  const raw = await readFile(absPath, 'utf8')
  const src = stripHtmlComments(resolveWikilinks(raw, featureOf(absPath)))
  const doc = parseMarkdown(src, { frontmatter: true, headingIds: true })
  let frontmatter: Frontmatter = {}
  if (doc.frontmatter) {
    try {
      frontmatter = toJson(parseYaml(doc.frontmatter))
    } catch {
      frontmatter = { _error: 'frontmatter did not parse as YAML' }
    }
  }
  return { doc, frontmatter, path: relative(WORKSPACE_DIR, absPath) }
}

async function readFrontmatter(absPath: string): Promise<Frontmatter> {
  const raw = await readFile(absPath, 'utf8')
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!m) return {}
  try {
    return toJson(parseYaml(m[1]))
  } catch {
    return {}
  }
}

async function dayFiles(dir: string): Promise<DayFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: DayFile[] = []
  for (const n of names) {
    const m = n.match(DAY_RE)
    if (!m) continue
    const abs = join(dir, n)
    const raw = await readFile(abs, 'utf8')
    const lede = raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
      ?.replace(/^_|_$/g, '')
    out.push({ day: m[1], path: relative(WORKSPACE_DIR, abs), lede })
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : -1))
}

// ── reports ────────────────────────────────────────────────────────────────────

export const listReports = () => dayFiles(REPORTS_DIR)

export async function readReport(day: string): Promise<Rendered | null> {
  const p = join(REPORTS_DIR, `${day}.md`)
  return (await exists(p)) ? render(p) : null
}

// ── digests ────────────────────────────────────────────────────────────────────

export const listDigests = () => dayFiles(DIGESTS_DIR)

export async function readDigest(day: string): Promise<Rendered | null> {
  const p = join(DIGESTS_DIR, `${day}.md`)
  return (await exists(p)) ? render(p) : null
}

// ── journal ────────────────────────────────────────────────────────────────────

function journalMeta(abs: string, fm: Frontmatter): JournalEntry | null {
  const rel = relative(FEATURES_DIR, abs)
  const idx = rel.indexOf('/journal/')
  if (idx < 0) return null
  const date = str(fm.date)?.slice(0, 10)
  if (!date) return null
  const status = str(fm.status) as JournalStatus | undefined
  const feature = rel.slice(0, idx)
  const slug = basename(abs, '.md')
  return {
    id: `${feature}/${slug}`,
    slug,
    path: relative(WORKSPACE_DIR, abs),
    feature,
    date,
    pr: str(fm.pr),
    url: str(fm.url),
    merge: str(fm.merge),
    ticket: str(fm.ticket),
    features: list(fm.features),
    scope: str(fm.scope),
    status,
    hold: str(fm.hold),
    summary: str(fm.summary),
    source: str(fm.source),
  }
}

export async function listJournal(): Promise<JournalEntry[]> {
  const out: JournalEntry[] = []
  for await (const p of walk(FEATURES_DIR)) {
    if (!p.includes('/journal/')) continue
    const meta = journalMeta(p, await readFrontmatter(p))
    if (meta) out.push(meta)
  }
  return out.sort((a, b) => (a.date === b.date ? (a.slug < b.slug ? 1 : -1) : a.date < b.date ? 1 : -1))
}

/**
 * `id` is `<feature>/<slug>`. A wikilink that crosses features resolves against the wrong
 * feature, so fall back to the slug alone when it is unique across the tree.
 */
export async function readJournalEntry(id: string): Promise<(Rendered & { meta: JournalEntry }) | null> {
  if (id.includes('..')) return null
  const cut = id.lastIndexOf('/')
  const feature = cut > 0 ? id.slice(0, cut) : ''
  const slug = id.slice(cut + 1)
  const candidates: string[] = []
  for await (const p of walk(FEATURES_DIR)) {
    if (!p.includes('/journal/') || basename(p, '.md') !== slug) continue
    if (featureOf(p) === feature) {
      candidates.length = 0
      candidates.push(p)
      break
    }
    candidates.push(p)
  }
  if (candidates.length !== 1) return null
  const r = await render(candidates[0])
  const meta = journalMeta(candidates[0], r.frontmatter)
  return meta ? { ...r, meta } : null
}

// ── docs ───────────────────────────────────────────────────────────────────────

function docMeta(abs: string, fm: Frontmatter): DocMeta | null {
  const rel = relative(FEATURES_DIR, abs)
  const m = rel.match(/^(.*)\/docs\/(product|arch)\.md$/)
  if (!m) return null
  return {
    feature: m[1],
    tier: m[2] as DocMeta['tier'],
    path: relative(WORKSPACE_DIR, abs),
    id: str(fm.id),
    name: str(fm.feature_name),
    status: str(fm.status),
    owner: str(fm.owner),
    lastVerified: str(fm.last_verified),
    lastVerifiedDate: str(fm.last_verified_date),
    lastVerifiedBe: str(fm.last_verified_be),
    lastVerifiedBeDate: str(fm.last_verified_be_date),
    related: list(fm.related_features),
  }
}

export async function listDocs(): Promise<DocMeta[]> {
  const out: DocMeta[] = []
  for await (const p of walk(FEATURES_DIR)) {
    if (!p.includes('/docs/')) continue
    const meta = docMeta(p, await readFrontmatter(p))
    if (meta) out.push(meta)
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature) || a.tier.localeCompare(b.tier))
}

export async function readDoc(feature: string, tier: 'product' | 'arch'): Promise<(Rendered & { meta: DocMeta }) | null> {
  // `feature` is a path segment list from the URL; refuse anything that escapes the tree.
  if (feature.includes('..') || feature.startsWith('/')) return null
  const p = join(FEATURES_DIR, feature, 'docs', `${tier}.md`)
  if (!(await exists(p))) return null
  const r = await render(p)
  const meta = docMeta(p, r.frontmatter)
  return meta ? { ...r, meta } : null
}
