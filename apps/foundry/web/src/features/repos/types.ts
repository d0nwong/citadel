/** A git checkout the user has added to Foundry — what jobs can target. */
export interface Repo {
  path: string
  name: string
  /** Currently checked out on disk — a fact about the working tree, not a default. */
  branch: string
  /** Origin's default branch (origin/HEAD), `main` when unset — what jobs base on. */
  defaultBranch: string
  dirty: boolean
}

/** A candidate turned up by scanning a directory, plus whether it is already added. */
export interface DiscoveredRepo extends Repo {
  tracked: boolean
  lastCommit: number
}

/**
 * What a job points at. The two kinds are not cosmetic: a local repo is
 * bind-mounted, so edits land on the user's disk as the job runs. A remote
 * forge cannot do that — it clones, and results come back as a pushed branch.
 * Anything rendering a repo has to account for both.
 */
export type RepoRef =
  | { kind: 'local'; name: string; path: string }
  | { kind: 'git'; name: string; url: string; ref: string }

export const localRef = (repo: Repo): RepoRef => ({ kind: 'local', name: repo.name, path: repo.path })

const HOME = '/Users/yickkiuliamleung'

/** Display form for a filesystem path. */
export const tilde = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p)

/** Display form. Pure, so it is safe for any feature to import. */
export function repoLabel(repo: RepoRef): string {
  if (repo.kind === 'local') return tilde(repo.path)
  return repo.url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

/** Where the work ends up — the honest one-liner for each kind. */
export const repoDestination = (repo: RepoRef): string =>
  repo.kind === 'local' ? 'edits land on this machine' : 'pushed as a branch'
