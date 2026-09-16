/**
 * Node-only. Opening a pull request, dispatched on where `origin` lives.
 *
 * This runs on the HOST, never in the forge container: `bb` is a PHP phar the
 * node image cannot run, and both CLIs hold the user's real credentials —
 * which have no business inside a sandbox running an agent with permissions
 * disabled. The container commits; the host pushes and talks to the forge.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { trim1 } from '@/shared/lib/format'

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
  reviews?: { nodes?: Array<{ author?: { login?: string } | null; state?: string; body?: string }> }
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
        reviews(last: 30) { nodes { author { login } state body } }
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

    // A review's own summary — the paragraph a reviewer writes above their
    // inline threads when they submit — lives on neither the threads nor the
    // general comments, and it is usually where the overall ask is stated
    // (CTD-170). Pending reviews are the author's unsubmitted drafts: not
    // feedback yet, never handed over.
    const summaries = (pr.reviews?.nodes ?? []).filter((r) => r.state !== 'PENDING' && (r.body ?? '').trim() !== '')
    if (summaries.length > 0) {
      const lines = summaries.map(
        (r) => `@${r.author?.login ?? 'unknown'} (${(r.state ?? 'commented').toLowerCase().replace('_', ' ')}):\n${trim1(r.body ?? '', MAX_BODY_CHARS)}`,
      )
      sections.push(`## Review summaries\n\n${lines.join('\n\n')}`)
    }

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

/* ------------------------------------------------------------------ */
/* Reading a PR's state: reviews and checks (CTD-170)                 */
/* ------------------------------------------------------------------ */

/**
 * A submitted review. GitHub's own states; a Bitbucket comment — posted on its
 * own, there being no review-submit there — arrives as `COMMENTED`. A pending
 * (unsubmitted) review never appears: that is the reviewer mid-thought.
 */
export interface PrReview {
  author: string
  state: 'COMMENTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'DISMISSED'
  body: string
  /** Epoch milliseconds. */
  submittedAt: number
}

/** Where a failed check's log can be fetched from, when the forge knows how. */
export type CheckLogRef = { kind: 'gh-job'; repo: string; jobId: string } | { kind: 'bb-pipeline'; repo: string; build: string }

export interface PrCheck {
  name: string
  /** `skipped` covers neutral, cancelled and stale — nothing to triage there. */
  outcome: 'pending' | 'passed' | 'failed' | 'skipped'
  url: string
  log?: CheckLogRef
  /** Epoch milliseconds this outcome was reached, when the forge says — a rerun's own failure needs this (CTD-233). */
  completedAt?: number
}

export interface PrState {
  state: 'open' | 'merged' | 'closed'
  headSha: string
  reviews: Array<PrReview>
  checks: Array<PrCheck>
}

const GH_PR = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/
const BB_PR = /bitbucket\.org\/([^/]+\/[^/]+)\/pull-requests\/(\d+)/

/**
 * The PR as it stands, read with the host's own `gh` or — `bb` prints neither
 * state, approvals nor pipelines — Bitbucket's REST API under the credentials
 * `bb` stores. Throws with a reason: the watcher logs and moves on.
 */
export async function fetchPrState(originUrl: string, prUrl: string): Promise<PrState> {
  const cli = prCliFor(originHost(originUrl))
  if (cli === null) throw new Error(`no PR CLI for ${originHost(originUrl) || 'this origin'} — cannot read the PR`)
  return cli === 'gh' ? githubState(prUrl) : bitbucketState(prUrl)
}

/* ---- GitHub ------------------------------------------------------- */

interface GhReview {
  author?: { login?: string } | null
  state?: string
  body?: string
  submittedAt?: string
}

/** One entry of `gh pr view --json statusCheckRollup`: a workflow's CheckRun, or an external StatusContext. */
interface GhRollupEntry {
  __typename?: string
  name?: string
  workflowName?: string
  status?: string
  conclusion?: string
  detailsUrl?: string
  completedAt?: string
  context?: string
  state?: string
  targetUrl?: string
}

export interface GhPrView {
  state?: string
  headRefOid?: string
  reviews?: Array<GhReview>
  statusCheckRollup?: Array<GhRollupEntry>
}

const GH_REVIEW_STATES = new Set(['COMMENTED', 'CHANGES_REQUESTED', 'APPROVED', 'DISMISSED'])

/** CheckRun conclusions worth a forge; the rest are a human's call or nobody's. */
const GH_FAILED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE'])

function checkRunOutcome(e: GhRollupEntry): PrCheck['outcome'] {
  if (e.status !== 'COMPLETED') return 'pending'
  if (e.conclusion === 'SUCCESS') return 'passed'
  return GH_FAILED.has(e.conclusion ?? '') ? 'failed' : 'skipped'
}

function statusContextOutcome(e: GhRollupEntry): PrCheck['outcome'] {
  if (e.state === 'SUCCESS') return 'passed'
  return e.state === 'FAILURE' || e.state === 'ERROR' ? 'failed' : 'pending'
}

/** `gh pr view --json state,headRefOid,reviews,statusCheckRollup` → the PR's state. Pure, for the tests. */
export function parseGitHubPr(view: GhPrView, repo: string): PrState {
  const state = view.state === 'OPEN' ? 'open' : view.state === 'MERGED' ? 'merged' : 'closed'

  const reviews: Array<PrReview> = []
  for (const r of view.reviews ?? []) {
    const at = Date.parse(r.submittedAt ?? '')
    if (!GH_REVIEW_STATES.has(r.state ?? '') || Number.isNaN(at)) continue // PENDING, or malformed
    reviews.push({
      author: r.author?.login ?? 'unknown',
      state: r.state as PrReview['state'],
      body: r.body ?? '',
      submittedAt: at,
    })
  }

  const checks: Array<PrCheck> = (view.statusCheckRollup ?? []).map((e) => {
    const completedAt = e.completedAt ? Date.parse(e.completedAt) : undefined
    const at = completedAt !== undefined && !Number.isNaN(completedAt) ? { completedAt } : {}
    if (e.__typename === 'StatusContext') {
      return { name: e.context ?? 'status', outcome: statusContextOutcome(e), url: e.targetUrl ?? '', ...at }
    }
    const name = e.workflowName ? `${e.workflowName} / ${e.name ?? 'check'}` : (e.name ?? 'check')
    const job = /\/actions\/runs\/\d+\/job\/(\d+)/.exec(e.detailsUrl ?? '')?.[1]
    return {
      name,
      outcome: checkRunOutcome(e),
      url: e.detailsUrl ?? '',
      ...at,
      ...(job ? { log: { kind: 'gh-job' as const, repo, jobId: job } } : {}),
    }
  })

  return { state, headSha: view.headRefOid ?? '', reviews, checks }
}

async function githubState(prUrl: string): Promise<PrState> {
  const m = GH_PR.exec(prUrl)
  if (!m) throw new Error(`cannot parse a GitHub PR number from ${prUrl}`)
  const [, repo] = m
  const { stdout } = await exec('gh', ['pr', 'view', prUrl, '--json', 'state,headRefOid,reviews,statusCheckRollup'], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return parseGitHubPr(JSON.parse(stdout) as GhPrView, repo)
}

/* ---- Bitbucket ---------------------------------------------------- */

const BB_API = 'https://api.bitbucket.org/2.0'

/**
 * `bb` keeps its credentials in this file, Basic auth with an API token in
 * the password slot (scripts/setup-bb.sh writes it). Read here, on the host,
 * for the calls `bb` has no command for.
 */
const BB_CONFIG = process.env.BB_CONFIG ?? path.join(homedir(), '.bitbucket-rest-cli-config.json')

async function bitbucketAuth(): Promise<string> {
  let parsed: { auth?: { username?: string; appPassword?: string } }
  try {
    parsed = JSON.parse(await readFile(BB_CONFIG, 'utf8'))
  } catch {
    throw new Error(`no Bitbucket credentials at ${BB_CONFIG} — run: just setup-bb`)
  }
  const { username, appPassword } = parsed.auth ?? {}
  if (!username || !appPassword) throw new Error(`${BB_CONFIG} has no credentials in it — run: just setup-bb`)
  return `Basic ${Buffer.from(`${username}:${appPassword}`).toString('base64')}`
}

async function bbGet<T>(auth: string, url: string, accept = 'application/json'): Promise<T> {
  const res = await fetch(url, { headers: { authorization: auth, accept }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Bitbucket ${res.status} on ${url.replace(BB_API, '')}`)
  return (accept === 'application/json' ? res.json() : res.text()) as Promise<T>
}

export interface BbPullRequest {
  state?: string
  source?: { commit?: { hash?: string } }
}
export interface BbComment {
  created_on?: string
  deleted?: boolean
  pending?: boolean
  user?: { display_name?: string; nickname?: string }
  content?: { raw?: string }
}
export interface BbStatus {
  state?: string
  name?: string
  key?: string
  url?: string
}

/**
 * The three Bitbucket answers → the PR's state. Pure, for the tests. A
 * comment is a `COMMENTED` review: Bitbucket has no submit step, so each one
 * is final when posted — except a *pending* one, which is a draft in an
 * unfinished review and stays out, exactly as a pending GitHub review does.
 */
export function parseBitbucketPr(pr: BbPullRequest, comments: Array<BbComment>, statuses: Array<BbStatus>, repo: string): PrState {
  const state = pr.state === 'OPEN' ? 'open' : pr.state === 'MERGED' ? 'merged' : 'closed'

  const reviews: Array<PrReview> = []
  for (const c of comments) {
    const at = Date.parse(c.created_on ?? '')
    if (c.deleted || c.pending || Number.isNaN(at)) continue
    reviews.push({
      author: c.user?.nickname ?? c.user?.display_name ?? 'unknown',
      state: 'COMMENTED',
      body: c.content?.raw ?? '',
      submittedAt: at,
    })
  }

  const checks: Array<PrCheck> = statuses.map((s) => {
    const url = s.url ?? ''
    // Pipelines links its statuses as `…/addon/pipelines/home#!/results/<n>`
    // (seen on alden-portal-fe #442); the older `…/pipelines/results/<n>` too.
    const build = /\/pipelines\/(?:home#!\/)?results\/(\d+)/.exec(url)?.[1]
    const outcome: PrCheck['outcome'] =
      s.state === 'SUCCESSFUL' ? 'passed' : s.state === 'FAILED' ? 'failed' : s.state === 'STOPPED' ? 'skipped' : 'pending'
    return {
      name: s.name ?? s.key ?? 'status',
      outcome,
      url,
      ...(build ? { log: { kind: 'bb-pipeline' as const, repo, build } } : {}),
    }
  })

  return { state, headSha: pr.source?.commit?.hash ?? '', reviews, checks }
}

async function bitbucketState(prUrl: string): Promise<PrState> {
  const m = BB_PR.exec(prUrl)
  if (!m) throw new Error(`cannot parse a Bitbucket PR number from ${prUrl}`)
  const [, repo, number] = m
  const auth = await bitbucketAuth()
  const base = `${BB_API}/repositories/${repo}`
  const pr = await bbGet<BbPullRequest>(auth, `${base}/pullrequests/${number}?fields=state,source.commit.hash`)
  const comments = await bbGet<{ values?: Array<BbComment> }>(
    auth,
    `${base}/pullrequests/${number}/comments?pagelen=100&sort=-created_on&fields=values.created_on,values.deleted,values.pending,values.user.display_name,values.user.nickname,values.content.raw`,
  )
  const sha = pr.source?.commit?.hash
  const statuses = sha
    ? await bbGet<{ values?: Array<BbStatus> }>(auth, `${base}/commit/${sha}/statuses?pagelen=100&fields=values.state,values.name,values.key,values.url`)
    : { values: [] }
  return parseBitbucketPr(pr, comments.values ?? [], statuses.values ?? [], repo)
}

/* ---- The failing log ---------------------------------------------- */

/** One check's log, as handed to the agent: the tail, since that is where the failure is. */
const MAX_LOG_CHARS = 12_000
/** The whole failed-checks block. */
const MAX_CHECKS_CHARS = 40_000

/** Keep the end of a log, marking the cut. */
export const tailOf = (s: string, n = MAX_LOG_CHARS) => (s.length > n ? `[earlier log lines omitted]\n${s.slice(s.length - n)}` : s)

/**
 * `gh run view --log-failed` prefixes every line with `<job>\t<step>\t` and a
 * timestamp; the agent needs neither, and at 12k characters a third of the
 * budget would go on them.
 */
export const stripGhLog = (log: string) =>
  log
    .replace(/^﻿/, '')
    .split('\n')
    .map((line) => line.replace(/^[^\t\n]*\t[^\t\n]*\t/, '').replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z /, ''))
    .join('\n')

/** The failing steps' log for one check, or null when there is no way to fetch one. */
export async function fetchCheckLog(check: PrCheck): Promise<string | null> {
  if (!check.log) return null
  if (check.log.kind === 'gh-job') {
    const { stdout } = await exec('gh', ['run', 'view', '--job', check.log.jobId, '--log-failed', '--repo', check.log.repo], {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    })
    return tailOf(stripGhLog(stdout).trim())
  }
  // Bitbucket Pipelines: the build's failed steps, each step's log in turn.
  const auth = await bitbucketAuth()
  const base = `${BB_API}/repositories/${check.log.repo}/pipelines/${check.log.build}`
  const steps = await bbGet<{ values?: Array<{ uuid?: string; name?: string; state?: { result?: { name?: string } } }> }>(
    auth,
    `${base}/steps/?pagelen=50&fields=values.uuid,values.name,values.state.result.name`,
  )
  const failed = (steps.values ?? []).filter((s) => s.state?.result?.name === 'FAILED' && s.uuid)
  const parts: Array<string> = []
  for (const s of failed) {
    const log = await bbGet<string>(auth, `${base}/steps/${s.uuid}/log`, 'text/plain').catch(() => '')
    parts.push(`--- step: ${s.name ?? s.uuid} ---\n${tailOf(log.trim())}`)
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

export interface FailedChecksRequest {
  prUrl: string
}

/** `empty` means the PR's checks are green (or still running): nothing to fix. */
export type FailedChecksResult = { text: string; empty: boolean; headSha: string } | { text: null; reason: string }

/**
 * The PR's failed checks with their logs, formatted for an agent to triage —
 * the check-shaped twin of `fetchPrComments`, read fresh at launch with the
 * host's own credentials. A check that has no fetchable log (an external
 * status) is still named, with its URL, so the agent knows what is red.
 */
export async function fetchFailedChecks(originUrl: string, req: FailedChecksRequest): Promise<FailedChecksResult> {
  let pr: PrState
  try {
    pr = await fetchPrState(originUrl, req.prUrl)
  } catch (e) {
    return { text: null, reason: e instanceof Error ? e.message : String(e) }
  }
  const failed = pr.checks.filter((c) => c.outcome === 'failed')
  if (failed.length === 0) return { text: '', empty: true, headSha: pr.headSha }

  const blocks: Array<string> = []
  for (const check of failed) {
    const log = await fetchCheckLog(check).catch((e: unknown) => `[log unavailable: ${e instanceof Error ? e.message : String(e)}]`)
    const head = `### ${check.name}${check.url ? ` — ${check.url}` : ''}`
    blocks.push(log ? `${head}\n\n\`\`\`\n${log}\n\`\`\`` : `${head}\n\n(no log available — open the URL for the details)`)
  }
  const text = `## Failed checks on ${pr.headSha.slice(0, 7)}\n\n${blocks.join('\n\n')}`
  return {
    text: text.length > MAX_CHECKS_CHARS ? `${text.slice(0, MAX_CHECKS_CHARS)}\n\n[checks truncated]` : text,
    empty: false,
    headSha: pr.headSha,
  }
}

/* ------------------------------------------------------------------ */
/* Rerunning a head commit's failed CI (CTD-233)                      */
/* ------------------------------------------------------------------ */

export type RerunResult = { ok: true; count: number } | { ok: false; reason: string }

/** The Actions run id an Actions check's own url names — `.../actions/runs/<id>/job/<jobId>`. */
const RUN_ID = /\/actions\/runs\/(\d+)/

/**
 * The commit's failed checks, rerun once each (S-48): `gh run rerun <id>
 * --failed` per distinct Actions run a failed check's url names, so a run
 * with several failed jobs is reran once, not once per job. Bitbucket
 * Pipelines has no rerun here — the watcher never calls this for a
 * Bitbucket PR, taking S-48's last sentence instead. A check with no
 * Actions run behind it (an external status) cannot be reran by this at
 * all; with nothing left to rerun, that counts as the forge refusing.
 */
export async function rerunFailedChecks(originUrl: string, prUrl: string): Promise<RerunResult> {
  const cli = prCliFor(originHost(originUrl))
  if (cli !== 'gh') return { ok: false, reason: `no CI rerun for ${originHost(originUrl) || 'this origin'}` }
  const m = GH_PR.exec(prUrl)
  if (!m) return { ok: false, reason: `cannot parse a GitHub PR number from ${prUrl}` }
  const [, repo] = m

  let pr: PrState
  try {
    pr = await fetchPrState(originUrl, prUrl)
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
  const runIds = [...new Set(pr.checks.filter((c) => c.outcome === 'failed').map((c) => RUN_ID.exec(c.url)?.[1]))].filter(
    (id): id is string => id !== undefined,
  )
  if (runIds.length === 0) return { ok: false, reason: 'no rerunnable Actions run among the failed checks' }

  try {
    for (const runId of runIds) {
      await exec('gh', ['run', 'rerun', runId, '--failed', '--repo', repo], { timeout: 60_000 })
    }
    return { ok: true, count: runIds.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `gh run rerun failed: ${trim1(msg, 300)}` }
  }
}

/* ------------------------------------------------------------------ */
/* Mergeability (CTD-214)                                             */
/* ------------------------------------------------------------------ */

/** Whether a PR branch merges cleanly into its base, as origin has them. */
export interface MergeProbe {
  baseSha: string
  headSha: string
  /** Paths git could not merge on its own; empty when the merge is clean. */
  conflicts: Array<string>
}

/**
 * `git merge-tree --write-tree --name-only --no-messages` output → the
 * conflicted paths: the first line is the merged tree's oid, the rest (up to a
 * blank line) name the files. Pure, for the tests.
 */
export function parseMergeTree(stdout: string): Array<string> {
  const lines = stdout.split('\n').slice(1)
  const end = lines.indexOf('')
  return [...new Set(end === -1 ? lines : lines.slice(0, end))]
}

/**
 * A dry-run merge of origin's base into origin's PR branch, on the HOST's
 * checkout. Neither forge answers this well — GitHub's `mergeable` is UNKNOWN
 * for a while after each push, Bitbucket has no such field — while git answers
 * it the same for both, and hands over the base sha the watcher keys on. The
 * fetch writes only remote-tracking refs: the user's branches and working tree
 * are untouched, and `merge-tree` writes no files. Throws on anything but a
 * clean or conflicting answer.
 */
export async function probeMerge(repoPath: string, baseBranch: string, branch: string): Promise<MergeProbe> {
  const ref = (b: string) => `refs/remotes/origin/${b}`
  await exec(
    'git',
    ['-C', repoPath, 'fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${baseBranch}:${ref(baseBranch)}`, `+refs/heads/${branch}:${ref(branch)}`],
    { timeout: 120_000 },
  )
  const sha = async (r: string) => (await exec('git', ['-C', repoPath, 'rev-parse', '--verify', `${r}^{commit}`])).stdout.trim()
  const baseSha = await sha(ref(baseBranch))
  const headSha = await sha(ref(branch))
  try {
    await exec('git', ['-C', repoPath, 'merge-tree', '--write-tree', '--name-only', '--no-messages', baseSha, headSha], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { baseSha, headSha, conflicts: [] }
  } catch (e) {
    // Exit 1 is git's "merged with conflicts"; its stdout is the answer.
    const failed = e as { code?: number; stdout?: string }
    if (failed.code !== 1 || typeof failed.stdout !== 'string') throw e
    return { baseSha, headSha, conflicts: parseMergeTree(failed.stdout.trim()) }
  }
}
