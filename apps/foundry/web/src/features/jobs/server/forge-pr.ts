/**
 * Node-only. Opening a pull request, dispatched on where `origin` lives.
 *
 * This runs on the HOST, never in the forge container: `bb` is a PHP phar the
 * node image cannot run, and both CLIs hold the user's real credentials —
 * which have no business inside a sandbox running an agent with permissions
 * disabled. The container commits; the host pushes and talks to the forge.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface PrRequest {
  workspace: string
  branch: string
  baseBranch: string
  title: string
  body: string
}

export type PrResult = { url: string } | { url: null; reason: string }

/** `https://user@bitbucket.org/team/repo.git` / `git@github.com:o/r.git` -> hostname. */
export function originHost(originUrl: string): string {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/.exec(originUrl.trim())
  return m?.[1].toLowerCase() ?? ''
}

/** The CLI a host needs, or null when we can only push and step aside. */
export function prCliFor(host: string): 'gh' | 'bb' | null {
  if (host === 'github.com') return 'gh'
  if (host === 'bitbucket.org') return 'bb'
  return null
}

/* eslint-disable-next-line no-control-regex -- ANSI escapes are control chars by definition */
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

const trim1 = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export async function createPullRequest(originUrl: string, req: PrRequest): Promise<PrResult> {
  const host = originHost(originUrl)
  const cli = prCliFor(host)
  if (cli === null) return { url: null, reason: `no PR CLI for ${host || 'this origin'} — branch pushed, open the PR yourself` }

  const title = trim1(req.title.split('\n')[0], 100)
  try {
    if (cli === 'gh') {
      // gh prints the PR URL as the last stdout line.
      const { stdout } = await exec(
        'gh',
        ['pr', 'create', '--base', req.baseBranch, '--head', req.branch, '--title', title, '--body', req.body],
        { cwd: req.workspace, timeout: 60_000 },
      )
      const url = stdout.trim().split('\n').at(-1)?.trim()
      return url?.startsWith('http') ? { url } : { url: null, reason: `gh gave no URL: ${trim1(stdout.trim(), 200)}` }
    }

    // bb pr create <from> <to> <addDefaultReviewers> — two-arg form is explicit
    // (one arg would be the *destination*, inferring source from HEAD). `0`
    // because a foundry PR should not auto-ping the team's default reviewers;
    // FOUNDRY_BB_REVIEWERS=1 opts back in.
    const reviewers = process.env.FOUNDRY_BB_REVIEWERS === '1' ? '1' : '0'
    const { stdout } = await exec(
      'bb',
      ['pr', 'create', req.branch, req.baseBranch, reviewers, '--title', title, '--description', req.body],
      { cwd: req.workspace, timeout: 60_000 },
    )
    // bb renders `Link: <url>` lines through ANSI colour codes (and PHP may
    // interleave deprecation noise), so strip the colours and fish for the URL.
    const url = /https:\/\/bitbucket\.org\/\S+\/pull-requests\/\d+/.exec(stripAnsi(stdout))?.[0]
    return url ? { url } : { url: null, reason: `bb gave no PR link: ${trim1(stripAnsi(stdout).trim(), 200)}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { url: null, reason: `${cli} pr create failed: ${trim1(msg, 300)}` }
  }
}
