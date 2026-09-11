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

/* ------------------------------------------------------------------ */
/* Reading a PR's review comments (LIA-40)                            */
/* ------------------------------------------------------------------ */

export interface PrCommentsRequest {
  workspace: string
  prUrl: string
}

/** `empty` distinguishes "fetched fine, nothing to address" from an error. */
export type PrCommentsResult = { text: string; empty: boolean } | { text: null; reason: string }

/** The whole comments block handed to the agent — one PR's worth, not a transcript. */
const MAX_COMMENTS_CHARS = 20_000
/** One comment body. Reviewers paste logs; the agent needs the point, not the paste. */
const MAX_BODY_CHARS = 2_000

const capped = (s: string) =>
  s.length > MAX_COMMENTS_CHARS ? `${s.slice(0, MAX_COMMENTS_CHARS)}\n\n[comments truncated]` : s

interface GhCommentNode {
  author?: { login?: string; __typename?: string } | null
  path?: string
  line?: number | null
  body?: string
}

interface GhPullRequest {
  reviewThreads?: { nodes?: Array<{ isResolved?: boolean; comments?: { nodes?: Array<GhCommentNode> } }> }
  comments?: { nodes?: Array<GhCommentNode> }
}

/**
 * Unresolved inline review threads plus the PR's general comments, formatted
 * for an agent to act on. Runs on the HOST with the user's own `gh`/`bb` —
 * same stance as `createPullRequest`: the container never holds a forge
 * credential, so the host reads the comments and hands them over as text.
 */
export async function fetchPrComments(originUrl: string, req: PrCommentsRequest): Promise<PrCommentsResult> {
  const host = originHost(originUrl)
  const cli = prCliFor(host)
  if (cli === null) return { text: null, reason: `no PR CLI for ${host || 'this origin'} — cannot read comments` }
  return cli === 'gh' ? githubComments(req) : bitbucketComments(req)
}

/**
 * One GraphQL call: REST has no notion of a resolved review thread, and
 * `isResolved` is exactly the filter wanted here — resolved feedback is
 * done, and re-litigating it would be noise.
 */
async function githubComments(req: PrCommentsRequest): Promise<PrCommentsResult> {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(req.prUrl)
  if (!m) return { text: null, reason: `cannot parse a GitHub PR number from ${req.prUrl}` }
  const [, owner, repo, number] = m

  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { isResolved comments(first: 50) { nodes { author { login } path line body } } }
        }
        comments(last: 50) { nodes { author { login __typename } body } }
      }
    }
  }`

  try {
    const { stdout } = await exec(
      'gh',
      ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${number}`],
      { timeout: 60_000 },
    )
    const pr = (JSON.parse(stdout) as { data?: { repository?: { pullRequest?: GhPullRequest } } }).data?.repository
      ?.pullRequest
    if (!pr) return { text: null, reason: `PR #${number} not found on ${owner}/${repo}` }

    const sections: Array<string> = []

    // App bots (deploy previews, Linear linkbacks) dominate general comments
    // and are never actionable review feedback — without this filter, every PR
    // would look like it had comments to address. Inline threads stay
    // unfiltered: a bot review thread is real feedback, and `isResolved`
    // already gates it.
    const general = (pr.comments?.nodes ?? []).filter((c) => c.author?.__typename !== 'Bot')
    if (general.length > 0) {
      const lines = general.map((c) => `@${c.author?.login ?? 'unknown'}:\n${trim1(c.body ?? '', MAX_BODY_CHARS)}`)
      sections.push(`## General comments\n\n${lines.join('\n\n')}`)
    }

    const threads = (pr.reviewThreads?.nodes ?? []).filter((t) => t?.isResolved === false)
    if (threads.length > 0) {
      const blocks = threads.map((t) => {
        const comments = t.comments?.nodes ?? []
        const where = comments[0]?.path ? `${comments[0].path}${comments[0].line ? `:${comments[0].line}` : ''}` : 'unknown location'
        const body = comments
          .map((c, i) => `@${c.author?.login ?? 'unknown'}${i > 0 ? ' (reply)' : ''}:\n${trim1(c.body ?? '', MAX_BODY_CHARS)}`)
          .join('\n')
        return `### ${where}\n${body}`
      })
      sections.push(`## Unresolved review threads\n\n${blocks.join('\n\n')}`)
    }

    return { text: capped(sections.join('\n\n')), empty: sections.length === 0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { text: null, reason: `gh api graphql failed: ${trim1(msg, 300)}` }
  }
}

/**
 * `bb pr show <id> true` prints general comments plus *unresolved* inline
 * ones, already formatted with authors and file:line headers — ship its
 * output through as-is rather than re-parsing it.
 */
async function bitbucketComments(req: PrCommentsRequest): Promise<PrCommentsResult> {
  const m = /bitbucket\.org\/[^/]+\/[^/]+\/pull-requests\/(\d+)/.exec(req.prUrl)
  if (!m) return { text: null, reason: `cannot parse a Bitbucket PR number from ${req.prUrl}` }
  const [, number] = m

  try {
    // cwd matters: the phar resolves workspace/repo from the checkout's origin.
    const { stdout } = await exec('bb', ['pr', 'show', number, 'true'], { cwd: req.workspace, timeout: 60_000 })
    const text = stripAnsi(stdout).trim()
    const empty = text.includes('No general comments found.') && text.includes('No inline comments found.')
    return { text: capped(text), empty }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { text: null, reason: `bb pr show failed: ${trim1(msg, 300)}` }
  }
}
