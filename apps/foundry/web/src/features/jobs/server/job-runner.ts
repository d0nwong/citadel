/**
 * Node-only. The orchestrator: everything between "row inserted" and "row
 * settled" that runs on the HOST.
 *
 * The split, deliberately: the host clones, brands the branch, launches the
 * container, and afterwards pushes and opens the PR with the user's own
 * credentials (`bb`/`gh` live here, and only here). The container gets the
 * workspace, a Claude credential and a per-job callback token — nothing else.
 * It reports progress to /api/jobs/$id/events; only this process touches
 * Postgres.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { repoNotes } from '@/features/repos/server/repo-scan'
import { createPullRequest, fetchPrComments, originHost, prCliFor } from './forge-pr'
import { FOUNDRY_HOME, appendLogs } from './job-logs'
import * as store from './job-store'
import type { JobRow } from './job-store'
import { linkPrToTicket } from './linear-link'

const exec = promisify(execFile)

const ENV_FILE = path.join(FOUNDRY_HOME, 'env')
const JOBS_DIR = path.join(FOUNDRY_HOME, 'jobs')
const IMAGE = process.env.FOUNDRY_IMAGE ?? 'foundry/forge:latest'
const CALLBACK_BASE = process.env.FOUNDRY_CALLBACK_BASE ?? 'http://host.docker.internal:3777'
/** The MCP gateway (infra/ `mcp` service) as the container sees it — host port from infra/.env's MCP_PORT. */
const MCP_URL = process.env.FOUNDRY_MCP_URL ?? 'http://host.docker.internal:9090'
const MAX_JOBS = Number(process.env.FOUNDRY_MAX_JOBS ?? 3)
/** Seconds the agent may run before the container's `timeout` kills it. */
const JOB_TIMEOUT = Number(process.env.FOUNDRY_TIMEOUT ?? 1800)
/** Where forge-run.sh lives on the host — bind-mounted, so edits need no image rebuild. */
const RUNNER_SCRIPT = path.resolve(process.cwd(), '..', 'image', 'forge-run.sh')
/** foundry's canonical PR template, bind-mounted for the same reason. Bitbucket has no repo template convention, so this keeps PR bodies one shape on every forge. */
const PR_TEMPLATE = path.resolve(process.cwd(), '..', 'image', 'pr-template.md')

const containerName = (jobId: string) => `foundry-${jobId}`
const workspaceOf = (jobId: string) => path.join(JOBS_DIR, jobId, 'work')

const sys = (id: string, text: string) => appendLogs(id, [{ stream: 'sys', text }])
const err = (id: string, text: string) => appendLogs(id, [{ stream: 'err', text }])

async function git(dir: string, args: Array<string>): Promise<string> {
  const { stdout } = await exec('git', ['-C', dir, ...args], { timeout: 60_000 })
  return stdout.trim()
}

/**
 * Every docker call is pinned to the OrbStack context: the user's shell context
 * drifts (Docker Desktop grabs it), and forges are an OrbStack feature — their
 * image, labels and host.docker.internal wiring all live there.
 */
const DOCKER_CONTEXT = process.env.FOUNDRY_DOCKER_CONTEXT ?? 'orbstack'

async function docker(args: Array<string>, timeout = 30_000): Promise<string> {
  const { stdout } = await exec('docker', args, {
    timeout,
    env: { ...process.env, DOCKER_CONTEXT },
  })
  return stdout.trim()
}

/** `KEY=value` lines of ~/.foundry/env — the credential `foundry auth` stores. */
async function readFoundryEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    for (const line of (await readFile(ENV_FILE, 'utf8')).split('\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* no file — preflight reports it */
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Preflight                                                          */
/* ------------------------------------------------------------------ */

/** Everything that must hold before a container is worth starting. */
async function preflight(
  job: JobRow,
): Promise<{ credEnv: Record<string, string>; originUrl: string; notes: string; comments?: string }> {
  if (job.repo.kind !== 'local') throw new Error(`only local repos run today — this job targets a ${job.repo.kind} ref`)
  const repoPath = job.repo.path

  const cred = await readFoundryEnv()
  const credEnv: Record<string, string> = {}
  if (cred.CLAUDE_CODE_OAUTH_TOKEN) credEnv.CLAUDE_CODE_OAUTH_TOKEN = cred.CLAUDE_CODE_OAUTH_TOKEN
  else if (cred.ANTHROPIC_API_KEY) credEnv.ANTHROPIC_API_KEY = cred.ANTHROPIC_API_KEY
  else throw new Error('no Claude credential for the forge — run: foundry auth')
  // Gateway token only — the Linear/Slack keys stay on the host, behind the
  // gateway. FOUNDRY_MCP_SERVERS tells box-init which upstreams to register.
  if (cred.FOUNDRY_MCP_TOKEN) {
    credEnv.FOUNDRY_MCP_TOKEN = cred.FOUNDRY_MCP_TOKEN
    credEnv.FOUNDRY_MCP_URL = MCP_URL
    const servers = [cred.LINEAR_API_KEY && 'linear', cred.SLACK_MCP_TOKEN && 'slack'].filter(Boolean)
    if (servers.length > 0) credEnv.FOUNDRY_MCP_SERVERS = servers.join(',')
  }

  try {
    await docker(['info', '--format', '{{.OperatingSystem}}'])
  } catch {
    throw new Error('docker daemon unreachable — is OrbStack running? (docker context use orbstack)')
  }
  try {
    await docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}'])
  } catch {
    throw new Error(`image ${IMAGE} not built — run: foundry build`)
  }

  try {
    await git(repoPath, ['rev-parse', '--git-dir'])
  } catch {
    throw new Error(`${repoPath} is not a git repository`)
  }
  let originUrl: string
  try {
    originUrl = await git(repoPath, ['remote', 'get-url', 'origin'])
  } catch {
    throw new Error(`${repoPath} has no 'origin' remote — nowhere to push`)
  }
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${job.baseBranch}`])
  } catch {
    throw new Error(`base branch '${job.baseBranch}' does not exist in ${repoPath}`)
  }

  // The PR CLI check is a preflight concern only for hosts we *can* serve:
  // an exotic origin still gets its branch pushed, just no PR.
  const cli = prCliFor(originHost(originUrl))
  if (cli !== null) {
    try {
      await exec(cli, ['--version'], { timeout: 15_000 })
    } catch {
      throw new Error(`'${cli}' CLI not found on PATH — needed to open PRs on ${originHost(originUrl)}`)
    }
  }

  // Read now rather than at insert time: the notes that apply are the ones
  // standing when the forge lights, not when the job was queued.
  const notes = await repoNotes(repoPath)

  // A follow-up job (LIA-40) exists to address review comments on its PR, so
  // the host reads them here — fresh at launch, like the notes above, and with
  // the user's own CLI credentials, which the container never holds. No
  // comments to address means no forge worth lighting. The user's checkout
  // stands in as cwd for `bb`: same origin as the PR, and the job's own clone
  // does not exist yet.
  let comments: string | undefined
  if (job.sourceJobId !== null) {
    if (!job.prUrl) throw new Error('follow-up job has no PR URL to read comments from')
    const fetched = await fetchPrComments(originUrl, { workspace: repoPath, prUrl: job.prUrl })
    if (fetched.text === null) throw new Error(fetched.reason)
    if (fetched.empty) throw new Error(`no unresolved comments on ${job.prUrl} — nothing to address`)
    comments = fetched.text
  }

  return { credEnv, originUrl, notes, comments }
}

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

/**
 * A per-job clone, not a `git worktree`: a worktree's `.git` is a pointer into
 * the parent repo, which does not resolve inside the container without also
 * mounting the user's real checkout into the sandbox. A local clone hardlinks
 * objects (cheap) and its `.git` is self-contained. Uncommitted changes in the
 * user's checkout are deliberately excluded.
 */
async function prepareWorkspace(job: JobRow, originUrl: string): Promise<{ branch: string }> {
  const repoPath = job.repo.kind === 'local' ? job.repo.path : ''
  const work = workspaceOf(job.id)
  await mkdir(path.dirname(work), { recursive: true })

  await exec('git', ['clone', '--branch', job.baseBranch, repoPath, work], { timeout: 300_000 })
  await git(work, ['remote', 'set-url', 'origin', originUrl])

  // Cloning from a local checkout sets the workspace's origin/HEAD to whatever
  // branch that checkout happened to be on — and an agent asking the repo for
  // its default branch faithfully gets that wrong answer. (PR #11's release
  // workflow was written to trigger on a feature branch exactly this way.)
  // Repoint it at the source repo's real default before the agent looks.
  const defaultBranch =
    (await git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')).replace(
      /^origin\//,
      '',
    ) || 'main'
  await git(work, ['remote', 'set-head', 'origin', defaultBranch]).catch(() => undefined)

  // A follow-up job continues an existing PR, and updating a PR means pushing
  // to the branch it was opened from: check out origin's tip of that exact
  // branch — never a fresh one, never uniquified.
  if (job.sourceJobId !== null) {
    try {
      await git(work, ['fetch', 'origin', job.branch])
    } catch {
      throw new Error(`PR branch '${job.branch}' is not on origin — was the PR merged and the branch deleted?`)
    }
    await git(work, ['checkout', '-B', job.branch, 'FETCH_HEAD'])
    return { branch: job.branch }
  }

  // Branch from origin's tip of the base, not the local checkout's — the local
  // ref may be behind, and the PR diff should be against what the forge has.
  let startPoint = 'HEAD'
  try {
    await git(work, ['fetch', 'origin', job.baseBranch])
    startPoint = 'FETCH_HEAD'
  } catch {
    await sys(job.id, `base '${job.baseBranch}' not on origin — branching from the local checkout`)
  }

  // Branch names carry the job's short id, so two concurrent jobs cannot claim
  // the same one. This still resolves against the remote for the case it was
  // written for — a branch of that exact name already being there, e.g. a
  // re-run of a job whose workspace was rebuilt — so `push -u` cannot land on
  // someone's existing branch.
  let branch = job.branch
  try {
    let n = 2
    while ((await git(work, ['ls-remote', '--heads', 'origin', branch])) !== '') {
      if (n > 20) throw new Error(`cannot find a free branch name near ${job.branch}`)
      branch = `${job.branch}-${n}`
      n++
    }
  } catch (e) {
    // ls-remote failing (offline?) is not fatal — push will surface it.
    if (e instanceof Error && e.message.includes('free branch name')) throw e
  }
  if (branch !== job.branch) await store.patchJob(job.id, { branch })

  await git(work, ['checkout', '-B', branch, startPoint])
  return { branch }
}

/* ------------------------------------------------------------------ */
/* Container                                                          */
/* ------------------------------------------------------------------ */

async function hostGitIdentity(): Promise<Record<string, string>> {
  const get = async (k: string) => {
    try {
      return (await exec('git', ['config', '--global', k])).stdout.trim()
    } catch {
      return ''
    }
  }
  return {
    GIT_AUTHOR_NAME: (await get('user.name')) || 'foundry',
    GIT_AUTHOR_EMAIL: (await get('user.email')) || 'foundry@localhost',
  }
}

/**
 * What a follow-up forge is actually asked to do: the fetched comments, framed.
 * Composed at launch and never stored — the row's `task` stays the readable
 * ledger label, and the comments are read fresh each run. The first line is
 * deliberately short: forge-run.sh's commit sweep uses `head -1` of the task
 * as the commit subject when the agent leaves uncommitted work behind.
 */
function followUpTask(job: JobRow, comments: string): string {
  return [
    'Address PR review comments',
    '',
    `You previously opened pull request ${job.prUrl} from branch ${job.branch} of this repository; ` +
      `the current checkout is that branch, exactly as the PR stands. Reviewers left the comments below. ` +
      `Address them with code changes on this branch — build on it as it is, do not start over or rebase. ` +
      `Where a comment is a question, or you disagree with it, answer in your final message rather than guessing an edit.`,
    '',
    comments,
  ].join('\n')
}

async function launch(job: JobRow, credEnv: Record<string, string>, notes: string, comments?: string): Promise<void> {
  const name = containerName(job.id)
  const env: Record<string, string> = {
    ...credEnv,
    ...(await hostGitIdentity()),
    FOUNDRY_JOB_ID: job.id,
    FOUNDRY_CALLBACK: CALLBACK_BASE,
    FOUNDRY_TOKEN: job.token,
    FOUNDRY_TASK: comments === undefined ? job.task : followUpTask(job, comments),
    FOUNDRY_TIMEOUT: String(JOB_TIMEOUT),
    // The repo's standing instructions (Repos page). Empty for a repo with
    // none — forge-run then leaves the system prompt alone.
    FOUNDRY_REPO_NOTES: notes,
    // Empty for a plain job — the runner then synthesises one bare step.
    FOUNDRY_STEPS: JSON.stringify(job.blueprint?.steps ?? []),
  }
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `foundry.job=${job.id}`,
    '-v',
    `${workspaceOf(job.id)}:/work`,
    '-v',
    `${RUNNER_SCRIPT}:/usr/local/bin/forge-run:ro`,
    '-v',
    `${PR_TEMPLATE}:/usr/local/share/foundry/pr-template.md:ro`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    IMAGE,
    'forge-run',
  ]
  await docker(args, 60_000)
}

/**
 * `docker wait` as a safety net: if the container exits without ever reporting
 * its commit step — runner crash, curl failure, kill — nothing else would move
 * the row, and it would sit at `running` forever.
 */
function armWatcher(jobId: string): void {
  const name = containerName(jobId)
  const child = spawn('docker', ['wait', name], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DOCKER_CONTEXT },
  })
  let out = ''
  child.stdout.on('data', (d: Buffer) => (out += d.toString()))
  child.on('close', () => {
    void (async () => {
      const row = await store.getJobRow(jobId)
      if (!row) return
      // Once the commit callback lands, step moves to push/pr/done *before*
      // the container exits (the runner's curl completes first) — so a still-
      // 'agent' step here means it died mid-flight.
      const settledByHost = row.step === 'push' || row.step === 'pr' || row.step === 'done'
      if (settledByHost || (row.status !== 'running' && row.status !== 'queued')) return
      const code = out.trim() || '?'
      const wasSettled = await store.settleJob(jobId, { status: 'failed' })
      if (wasSettled) await err(jobId, `container exited unexpectedly (exit ${code}) — job failed`)
      await removeContainer(jobId)
      void pumpQueue()
    })()
  })
  child.unref()
}

async function removeContainer(jobId: string): Promise<void> {
  try {
    await docker(['rm', '-f', containerName(jobId)])
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

/**
 * Take a queued job all the way to a running container. Failures before the
 * container exists settle the row directly — never launch a forge that cannot
 * finish. Called fire-and-forget from createJob and from the queue pump.
 */
export async function startJob(id: string): Promise<void> {
  await ensureReconciled()

  const job = await store.getJobRow(id)
  if (!job || job.status !== 'queued') return

  // Concurrency cap: leave it queued; every settle pumps the queue.
  const running = await store.countRunning()
  if (running >= MAX_JOBS) {
    await sys(id, `waiting — ${running} job(s) already running (cap ${MAX_JOBS})`)
    return
  }

  if (!(await store.claimJob(id))) return

  try {
    const { credEnv, originUrl, notes, comments } = await preflight(job)
    await sys(id, 'preflight ok — preparing workspace')
    if (comments !== undefined) await sys(id, `PR comments fetched (${comments.length} chars) — ${job.prUrl}`)

    const work = workspaceOf(id)
    await store.patchJob(id, { workspace: work, container: containerName(id) })
    const { branch } = await prepareWorkspace(job, originUrl)
    await sys(
      id,
      comments === undefined
        ? `cloned ${job.repo.name} @ ${job.baseBranch} → ${branch}`
        : `cloned ${job.repo.name} — continuing PR branch ${branch}`,
    )

    if (notes !== '') await sys(id, `repo notes applied (${notes.length} chars) — see the Repos page`)

    await store.patchJob(id, { step: 'agent' })
    await launch({ ...job, branch }, credEnv, notes, comments)
    armWatcher(id)
    await sys(id, `forge lit — ${containerName(id)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await store.settleJob(id, { status: 'failed' })
    await err(id, msg)
    await removeContainer(id)
    void pumpQueue()
  }
}

/**
 * The host's half of the pipeline, once the container reports its commit step.
 * Push with the user's own git credentials, open the PR with the right CLI,
 * measure the diff, settle.
 */
export async function finishJob(id: string, outcome: 'committed' | 'no-changes', exitCode: number): Promise<void> {
  const job = await store.getJobRow(id)
  if (!job) return
  await removeContainer(id)

  const agentFailed = exitCode !== 0
  const work = job.workspace ?? workspaceOf(id)

  if (outcome === 'no-changes') {
    await sys(id, agentFailed ? `agent exited ${exitCode} with no changes` : 'agent made no changes — nothing to push')
    await store.settleJob(id, { status: agentFailed ? 'failed' : 'succeeded', exitCode })
    void pumpQueue()
    return
  }

  try {
    await store.patchJob(id, { step: 'push' })
    await sys(id, `pushing ${job.branch}`)
    await exec('git', ['-C', work, 'push', '-u', 'origin', job.branch], { timeout: 120_000 })

    const diff = await diffStats(work, job.baseBranch)

    await store.patchJob(id, { step: 'pr' })
    let prUrl: string | undefined
    if (job.sourceJobId !== null) {
      // A follow-up pushes to the branch its PR was opened from — the push
      // above *is* the update, so there is nothing to create here.
      prUrl = job.prUrl ?? undefined
      await sys(id, `PR updated: ${job.prUrl}`)
    } else {
      const originUrl = await git(work, ['remote', 'get-url', 'origin'])
      const title = await prTitle(work, job.task)
      const body = await prBody(work, job)
      const pr = await createPullRequest(originUrl, {
        workspace: work,
        branch: job.branch,
        baseBranch: job.baseBranch,
        title,
        body,
      })
      if (pr.url !== null) await sys(id, `PR opened: ${pr.url}`)
      else await err(id, pr.reason)
      prUrl = pr.url ?? undefined

      if (pr.url !== null && prCliFor(originHost(originUrl)) === 'bb') await linkTicket(id, pr.url, title, body, job.task)
    }

    // An agent that errored still gets its work pushed, but the job is failed:
    // the outcome should not read clean when the run wasn't.
    await store.settleJob(id, {
      status: agentFailed ? 'failed' : 'succeeded',
      exitCode,
      diff,
      prUrl,
    })
    await sys(id, 'job settled')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await store.settleJob(id, { status: 'failed', exitCode })
    await err(id, `push failed: ${msg} — the commit is intact in ${work}`)
  }
  void pumpQueue()
}

/**
 * Bitbucket only. Linear's GitHub integration files GitHub PRs onto the ticket
 * by itself, off the same `Closes LIA-24` line; it has no Bitbucket equivalent,
 * so for a `bb` origin the host files the attachment instead. Never fatal — the
 * PR is already open, and a missing key or an unreachable Linear is worth a log
 * line, not a failed job. Reads the ticket from the PR body *and* the job's own
 * task text (linear-link.ts) — the task is what the user actually typed, and
 * often the only place the ticket is named at all.
 */
async function linkTicket(id: string, prUrl: string, title: string, body: string, task: string): Promise<void> {
  try {
    const cred = await readFoundryEnv()
    const key = cred.LINEAR_API_KEY ?? process.env.LINEAR_API_KEY
    if (!key) return // Linear was never configured; nothing to link to.

    const res = await linkPrToTicket(key, { prUrl, title, body, task })
    if (res.linked.length > 0) await sys(id, `PR linked to ${res.linked.join(', ')} in Linear`)
    for (const f of res.failed) await err(id, `Linear link failed for ${f.id}: ${f.reason}`)
    if (res.unknown.length > 0) await sys(id, `PR body/task named ${res.unknown.join(', ')} but Linear has no such issue — skipped`)
    if (res.linked.length === 0 && res.failed.length === 0 && res.unknown.length === 0) {
      await sys(id, 'no Linear ticket named in the task or PR body — nothing to link')
    }
  } catch (e) {
    // Belt and braces: this sits inside finishJob's try, and a throw escaping
    // here would settle the job as a push failure it never had.
    await err(id, `Linear link failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined)
  }
}

/**
 * CI lints PR titles as Conventional Commits and release-please reads them, so
 * prefer the agent's own commit subject when it wrote one in that shape (the
 * /work skill asks it to); the raw task text is the fallback.
 */
async function prTitle(work: string, task: string): Promise<string> {
  const subject = await git(work, ['log', '-1', '--format=%s']).catch(() => '')
  return /^[a-z]+(\([^)]+\))?!?: \S/.test(subject) ? subject : task
}

/**
 * The agent authors the PR description in the container — the UNATTENDED
 * prompt (with a backstop turn in forge-run.sh, LIA-39) has it fill the repo's
 * PR template, or foundry's image/pr-template.md, into `.git/PR_BODY.md`,
 * inside `.git/` on purpose so the commit sweep can never pick it up. Only the
 * agent knows what it did and how it verified it, so the file is merely read
 * here. When it is missing anyway, the newest substantive commit body is the
 * next best thing — the skill and blueprints both ask for a summary plus
 * assumptions there — and the raw task text is the last resort.
 */
async function prBody(work: string, job: JobRow): Promise<string> {
  const authored = (await readFile(path.join(work, '.git', 'PR_BODY.md'), 'utf8').catch(() => '')).trim()
  if (authored && authored.length <= 60_000) return `${authored}\n\n---\nCreated by foundry ${job.id}.`

  const commitBody = await newestCommitBody(work, job)
  const closes = /Closes [A-Z]+-\d+/.exec(`${commitBody}\n${job.task}`)?.[0]
  const summary = (commitBody || job.task)
    .split('\n')
    .filter((line) => line.trim() !== closes)
    .join('\n')
    .trim()
  return [...(closes ? [closes, ''] : []), '## Summary', '', summary, '', '---', `Created by foundry ${job.id}.`].join(
    '\n',
  )
}

/**
 * Newest commit between the base and HEAD whose body actually says something:
 * the sweep commit forge-run.sh makes (body `foundry <job-id>`) and bodies
 * that are only Co-Authored-By-style trailers don't count.
 */
async function newestCommitBody(work: string, job: JobRow): Promise<string> {
  const baseRef = await resolveBaseRef(work, job.baseBranch)
  const raw = await git(work, ['log', `${baseRef}..HEAD`, '--format=%x1e%b']).catch(() => '')
  for (const body of raw.split('\x1e')) {
    const kept = body
      .split('\n')
      .filter((line) => !/^(co-authored-by|claude-session|signed-off-by):/i.test(line.trim()))
      .join('\n')
      .trim()
    if (kept && kept !== `foundry ${job.id}`) return kept
  }
  return ''
}

/** `origin/<base>` when the remote ref exists in this clone, the bare name otherwise. */
async function resolveBaseRef(work: string, baseBranch: string): Promise<string> {
  const baseRef = `origin/${baseBranch}`
  try {
    await git(work, ['rev-parse', '--verify', '--quiet', baseRef])
    return baseRef
  } catch {
    return baseBranch
  }
}

async function diffStats(work: string, baseBranch: string): Promise<{ files: number; additions: number; deletions: number }> {
  const baseRef = await resolveBaseRef(work, baseBranch)
  const numstat = await git(work, ['diff', '--numstat', `${baseRef}...HEAD`])
  let files = 0
  let additions = 0
  let deletions = 0
  for (const line of numstat.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(line)
    if (!m) continue
    files++
    if (m[1] !== '-') additions += Number(m[1])
    if (m[2] !== '-') deletions += Number(m[2])
  }
  return { files, additions, deletions }
}

/**
 * Settle first, kill second. The moment the container dies, its `docker wait`
 * watcher fires — and if the row still reads running at that point, the
 * watcher's `failed` wins the guarded transition instead of this cancel.
 */
export async function cancelJob(id: string): Promise<void> {
  await store.cancelJob(id)
  await removeContainer(id)
  void pumpQueue()
}

/* ------------------------------------------------------------------ */
/* Reconcile + queue                                                  */
/* ------------------------------------------------------------------ */

let reconciled: Promise<void> | undefined

/**
 * Once per server process (vite restarts included). Three cases per running
 * job: the container is still alive — re-arm its watcher and leave it be (the
 * callback route is stateless, so it is healthy); the job is at push/pr — the
 * container is *supposed* to be gone there and the interrupted host-side
 * finish is resumable from the workspace, so resume it; anything else with no
 * container is genuinely orphaned and fails.
 */
export function ensureReconciled(): Promise<void> {
  reconciled ??= (async () => {
    const open = await store.listOpenJobs()
    for (const job of open) {
      if (job.status !== 'running') continue
      let state = ''
      try {
        state = await docker(['inspect', '--format', '{{.State.Status}}', containerName(job.id)])
      } catch {
        /* container gone */
      }
      if (state === 'running' || state === 'created') {
        armWatcher(job.id)
      } else if (job.step === 'push' || job.step === 'pr') {
        // Push is idempotent and the commit sits in the workspace — pick the
        // finish back up rather than failing work that is already done.
        await sys(job.id, `resuming ${job.step} after a server restart`)
        void finishJob(job.id, 'committed', job.exitCode ?? 0)
      } else {
        const settled = await store.settleJob(job.id, { status: 'failed' })
        if (settled) await err(job.id, `orphaned mid-${job.step ?? 'run'} by a server restart — job failed`)
        await removeContainer(job.id)
      }
    }
    void pumpQueue()
  })().catch(() => {
    // Postgres not up yet, most likely. Try again on the next entry point.
    reconciled = undefined
  })
  return reconciled
}

/** Start the oldest queued job when a slot frees up. */
async function pumpQueue(): Promise<void> {
  try {
    const running = await store.countRunning()
    if (running >= MAX_JOBS) return
    const next = (await store.listOpenJobs()).find((j) => j.status === 'queued')
    if (next) void startJob(next.id)
  } catch {
    /* next settle will pump again */
  }
}
