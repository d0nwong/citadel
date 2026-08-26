import { createServerFn } from '@tanstack/react-start'
import type { DiscoveredRepo, Repo } from './types'

/**
 * Real data — repos come from scanning the user's filesystem, and the chosen
 * set persists to ~/.foundry/repos.json. The node-only scanner is imported
 * inside each handler so it never reaches the client bundle.
 */

export const discoverRepos = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<DiscoveredRepo>> => {
  const { scanRepos } = await import('./server/repo-scan')
  return scanRepos()
})

/** Repos the user has added — the only ones a job can target. */
export const listRepos = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<Repo>> => {
  const { scanRepos } = await import('./server/repo-scan')
  const repos = await scanRepos()
  return repos.filter((r) => r.tracked).map(({ tracked: _t, lastCommit: _l, ...repo }) => repo)
})

export const listScanRoots = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<string>> => {
  const { SCAN_ROOTS } = await import('./server/repo-scan')
  return SCAN_ROOTS
})

export const addRepos = createServerFn({ method: 'POST' })
  .validator((paths: Array<string>) => paths)
  .handler(async ({ data }) => {
    const { trackRepos } = await import('./server/repo-scan')
    await trackRepos(data)
  })

/**
 * Standing instructions for a repo. Capped because they are handed to the
 * agent as system prompt on every job — a runaway paste would crowd out the
 * task itself (and travels as a container env var).
 */
export const MAX_REPO_NOTES = 4000

export const saveRepoNotes = createServerFn({ method: 'POST' })
  .validator((input: { path: string; notes: string }) => {
    if (input.notes.length > MAX_REPO_NOTES) throw new Error(`notes are limited to ${MAX_REPO_NOTES} characters`)
    return input
  })
  .handler(async ({ data }) => {
    const { saveRepoNotes: save } = await import('./server/repo-scan')
    await save(data.path, data.notes)
  })

export const removeRepo = createServerFn({ method: 'POST' })
  .validator((repoPath: string) => repoPath)
  .handler(async ({ data }) => {
    const { untrackRepo } = await import('./server/repo-scan')
    await untrackRepo(data)
  })
