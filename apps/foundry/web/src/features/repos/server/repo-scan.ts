/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DiscoveredRepo } from '../types'

const exec = promisify(execFile)

export const HOME = homedir()
export const SCAN_ROOTS = [path.join(HOME, 'git')]

const STATE_DIR = path.join(HOME, '.foundry')
const STATE_FILE = path.join(STATE_DIR, 'repos.json')

async function readTracked(): Promise<Set<string>> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as { tracked?: Array<string> }
    return new Set(parsed.tracked ?? [])
  } catch {
    return new Set()
  }
}

async function writeTracked(tracked: Set<string>) {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, `${JSON.stringify({ tracked: [...tracked].sort() }, null, 2)}\n`)
}

async function isGitRepo(dir: string) {
  try {
    return (await stat(path.join(dir, '.git'))).isDirectory() || (await stat(path.join(dir, '.git'))).isFile()
  } catch {
    return false
  }
}

/** Runs a git command in a repo, returning '' rather than throwing on failure. */
async function git(dir: string, args: Array<string>): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', dir, ...args], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

/** Bounded concurrency — a `~/git` with 50+ repos would otherwise spawn 100+ processes at once. */
async function mapLimit<T, R>(items: Array<T>, limit: number, fn: (item: T) => Promise<R>): Promise<Array<R>> {
  const out: Array<R> = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

export async function scanRepos(): Promise<Array<DiscoveredRepo>> {
  const tracked = await readTracked()

  const candidates: Array<string> = []
  for (const root of SCAN_ROOTS) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = path.join(root, entry.name)
      if (await isGitRepo(dir)) candidates.push(dir)
    }
  }

  const repos = await mapLimit(candidates, 12, async (dir) => {
    const [branch, status, lastCommit] = await Promise.all([
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(dir, ['status', '--porcelain']),
      git(dir, ['log', '-1', '--format=%ct']),
    ])
    return {
      path: dir,
      name: path.basename(dir),
      branch: branch || 'HEAD',
      dirty: status.length > 0,
      tracked: tracked.has(dir),
      lastCommit: lastCommit ? Number(lastCommit) * 1000 : 0,
    } satisfies DiscoveredRepo
  })

  return repos.sort((a, b) => b.lastCommit - a.lastCommit)
}

export async function trackRepos(paths: Array<string>) {
  const tracked = await readTracked()
  for (const p of paths) tracked.add(p)
  await writeTracked(tracked)
}

export async function untrackRepo(repoPath: string) {
  const tracked = await readTracked()
  tracked.delete(repoPath)
  await writeTracked(tracked)
}
