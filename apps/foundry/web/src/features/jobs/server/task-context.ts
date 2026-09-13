/**
 * Node-only. What a task points at, resolved on the host before its container
 * starts (CTD-190): the Linear issues it links, read with the host's key, and
 * the repo files it names in backticks, read from the job's clone at the base
 * commit. Appended under `## Context` so the first step starts with them
 * instead of spending turns finding them. The row's `task` stays verbatim;
 * only what the container is handed grows.
 *
 * Never fails a job: a path that is not there is listed as missing, an issue
 * that cannot be fetched is listed with the reason and an `err` line.
 */
import { execFile } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { trim1 } from '@/shared/lib/format'
import { ticketIdsInTask } from './linear-link'
import type { LinearIssue } from './linear-link'

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
/** The ticket brief's head (`ticketBrief`): its own issue is already the task. */
const BRIEF_HEAD = /^([A-Z][A-Z0-9]*-\d+): .*\nhttps:\/\/linear\.app\//
/** Git's own test for a binary file: a NUL in the first 8000 bytes. */
const BINARY_PROBE = 8000

const HEADER =
  '## Context\n\nResolved by the host before this run from what the task above names: linked issues as Linear has them now, files as they stand at the base commit. The task is verbatim; where its line numbers disagree with a file here, the file is current.'

export interface ContextDeps {
  /** The host's Linear key; undefined when none is configured. */
  linearKey: string | undefined
  fetchIssue: (apiKey: string, identifier: string) => Promise<LinearIssue | null>
}

export interface HydratedTask {
  task: string
  log: Array<{ stream: 'sys' | 'err'; text: string }>
}

interface Block {
  label: string
  text: string
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`

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

/** The Linear issues a task links, less the brief's own issue when the task is a ticket brief. */
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
): Promise<{ blocks: Array<Block>; skipped: Array<string> }> {
  const blocks: Array<Block> = []
  const skipped: Array<string> = []
  if (ids.length === 0) {
    return { blocks, skipped }
  }
  const key = deps.linearKey
  if (key === undefined) {
    for (const id of ids) {
      skipped.push(`${id} — not fetched: no Linear key on the host`)
    }
    log.push({ stream: 'err', text: `context: ${ids.join(', ')} not fetched — no LINEAR_API_KEY on the host` })
    return { blocks, skipped }
  }
  const fetched = ids.slice(0, MAX_ISSUES)
  for (const id of ids.slice(MAX_ISSUES)) {
    skipped.push(`${id} — past the ${MAX_ISSUES}-issue limit, not fetched`)
  }
  const results = await Promise.allSettled(fetched.map((id) => deps.fetchIssue(key, id)))
  for (const [i, r] of results.entries()) {
    const id = fetched[i]
    if (r.status === 'rejected') {
      const reason = trim1(r.reason instanceof Error ? r.reason.message : String(r.reason), 200)
      skipped.push(`${id} — not fetched: ${reason}`)
      log.push({ stream: 'err', text: `context: ${id} not fetched — ${reason}` })
    } else if (r.value !== null) {
      const { identifier, title, url, description } = r.value
      blocks.push({ label: identifier, text: `### ${identifier}: ${title}\n${url}\n\n${description.trim()}` })
    }
    // null: Linear knows no such issue, so the id was ordinary text (`ISO-8601`).
  }
  return { blocks, skipped }
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
  return { label: `\`${file}\``, text: `### \`${file}\`\n${fenced(buf.toString('utf8'), lang)}` }
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
    log.push({ stream: 'err', text: `context: could not list the repo's files — ${trim1(e instanceof Error ? e.message : String(e), 200)}` })
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
 * nothing that resolves. Issues come first, then files in the order the task
 * names them; each is carried whole until the next would pass the cap
 * (`CONTEXT_CAP`, less for a long task),
 * and everything from there on is listed as cut, never truncated mid-file.
 */
export async function hydrateTask(task: string, work: string, deps: ContextDeps): Promise<HydratedTask> {
  const log: HydratedTask['log'] = []
  const ids = linkedIssueIds(task)
  const tokens = namedFiles(task)
  if (ids.length === 0 && tokens.paths.length === 0 && tokens.names.length === 0) {
    return { log, task }
  }

  const issues = await issueBlocks(ids, deps, log)
  const files = await fileBlocks(tokens, work, log)
  const skipped = [...issues.skipped, ...files.skipped]

  const cap = Math.min(CONTEXT_CAP, ARG_BUDGET - Buffer.byteLength(task))
  const kept: Array<Block> = []
  let used = 0
  let cut = false
  for (const block of [...issues.blocks, ...files.blocks]) {
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
  const issueCount = kept.filter((b) => !b.label.startsWith('`')).length
  log.unshift({
    stream: 'sys',
    text: `context: ${issueCount} issue(s) and ${kept.length - issueCount} file(s) added (${kb(used)}); ${files.missing.length} missing, ${skipped.length} not included`,
  })
  return { log, task: `${task}\n\n${parts.join('\n\n')}\n` }
}
