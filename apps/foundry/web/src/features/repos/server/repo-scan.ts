/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 */
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { repos as reposTable } from '@/db/schema'
import { lastBaseBranchByRepo } from '@/features/jobs/server/job-store'
import type { DiscoveredRepo } from '../types'

const exec = promisify(execFile)

export const HOME = homedir()
export const SCAN_ROOTS = [path.join(HOME, 'git')]

/** What the database knows about an imported repo, over and above the checkout. */
interface TrackedRepo {
  notes: string
  lastBaseBranch?: string
}

/**
 * The imported set lives in Postgres. It used to be ~/.foundry/repos.json;
 * `just migrate` adopts that file once and then leaves it alone.
 *
 * Keyed by path, since that is what the scan walks. The last base branch comes
 * from the job ledger — no separate store, and it is the same answer on every
 * device you open the UI from.
 */
async function readTracked(): Promise<Map<string, TrackedRepo>> {
  const [rows, lastBase] = await Promise.all([
    db.select({ id: reposTable.id, path: reposTable.path, notes: reposTable.notes }).from(reposTable),
    lastBaseBranchByRepo(),
  ])
  return new Map(rows.map((r) => [r.path, { notes: r.notes ?? '', lastBaseBranch: lastBase.get(r.id) }]))
}

/** The imported set as the trigger API resolves it — id, path and basename, nothing live. */
export async function trackedRepos(): Promise<Array<{ id: string; path: string; name: string }>> {
  return db.select({ id: reposTable.id, path: reposTable.path, name: reposTable.name }).from(reposTable)
}

/**
 * origin's default branch of a checkout — what the trigger API bases a job on
 * when the caller names no `baseBranch` and the repo has never had one. The
 * same derivation `scanRepos` does for `defaultBranch`; local-only, no network,
 * and 'main' when origin/HEAD is unset (as it is in some clones).
 */
export async function defaultBranchOf(repoPath: string): Promise<string> {
  const head = await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  return head.replace(/^origin\//, '') || 'main'
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
    const [branch, status, lastCommit, originHead] = await Promise.all([
      git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(dir, ['status', '--porcelain']),
      git(dir, ['log', '-1', '--format=%ct']),
      // origin's default branch — what a job should base itself on unless told
      // otherwise. Local-only, no network; unset in some clones, hence ''.
      git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']),
    ])
    return {
      path: dir,
      name: path.basename(dir),
      branch: branch || 'HEAD',
      defaultBranch: originHead.replace(/^origin\//, '') || 'main',
      dirty: status.length > 0,
      notes: tracked.get(dir)?.notes ?? '',
      lastBaseBranch: tracked.get(dir)?.lastBaseBranch,
      tracked: tracked.has(dir),
      lastCommit: lastCommit ? Number(lastCommit) * 1000 : 0,
    } satisfies DiscoveredRepo
  })

  return repos.sort((a, b) => b.lastCommit - a.lastCommit)
}

export async function trackRepos(paths: Array<string>) {
  if (paths.length === 0) return
  const rows = paths.map((p) => ({ path: p, name: path.basename(p) }))
  await db.insert(reposTable).values(rows).onConflictDoNothing({ target: reposTable.path })
}

/**
 * Standing instructions for one repo. Blank clears them back to NULL, so
 * "no notes" is one state in the database rather than two.
 */
export async function saveRepoNotes(repoPath: string, notes: string) {
  const trimmed = notes.trim()
  await db
    .update(reposTable)
    .set({ notes: trimmed === '' ? null : trimmed })
    .where(eq(reposTable.path, repoPath))
}

/** What a job hands its agent. '' when the repo is gone or has no notes. */
export async function repoNotes(repoPath: string): Promise<string> {
  const [row] = await db.select({ notes: reposTable.notes }).from(reposTable).where(eq(reposTable.path, repoPath))
  return row?.notes ?? ''
}

/** Jobs that targeted it keep their `repo` snapshot; only the link goes null. */
export async function untrackRepo(repoPath: string) {
  await db.delete(reposTable).where(eq(reposTable.path, repoPath))
}
