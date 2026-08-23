/** A git checkout discovered on this machine — what the repo picker lists. */
export interface Repo {
  path: string
  name: string
  branch: string
  dirty: boolean
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

/** Display form. Pure, so it is safe for any feature to import. */
export function repoLabel(repo: RepoRef): string {
  if (repo.kind === 'local') {
    return repo.path.startsWith(HOME) ? `~${repo.path.slice(HOME.length)}` : repo.path
  }
  return repo.url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
}

/** Where the work ends up — the honest one-liner for each kind. */
export const repoDestination = (repo: RepoRef): string =>
  repo.kind === 'local' ? 'edits land on this machine' : 'pushed as a branch'
