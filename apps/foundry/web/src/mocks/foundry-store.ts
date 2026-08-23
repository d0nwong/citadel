/**
 * Temporary in-memory stand-in for the Foundry orchestrator.
 *
 * One module because the mock entities reference each other (a forge points at
 * the job it is running). Each feature's `api.ts` wraps the slice it owns, so
 * when the real endpoints land this whole directory gets deleted and only those
 * wrappers change.
 */
import type { Job, LogLine, NewJobInput } from '@/features/jobs/types'
import type { AdapterInfo, Forge } from '@/features/forges/types'
import type { Repo } from '@/features/repos/types'

const HOME = '/Users/yickkiuliamleung'

export const REPOS: Array<Repo> = [
  { path: `${HOME}/git/foundry`, name: 'foundry', branch: 'main', dirty: true },
  { path: `${HOME}/git/binery-core`, name: 'binery-core', branch: 'develop', dirty: false },
  { path: `${HOME}/git/binery-frontend`, name: 'binery-frontend', branch: 'main', dirty: false },
  { path: `${HOME}/git/binery-accounting-backend`, name: 'binery-accounting-backend', branch: 'main', dirty: true },
  { path: `${HOME}/git/binery-acs`, name: 'binery-acs', branch: 'release/2.4', dirty: false },
  { path: `${HOME}/git/ai-workspace`, name: 'ai-workspace', branch: 'main', dirty: false },
  { path: `${HOME}/git/alden`, name: 'alden', branch: 'main', dirty: false },
]

export const ADAPTERS: Array<AdapterInfo> = [
  { id: 'orbstack', label: 'OrbStack — local containers', lifecycle: 'pooled' },
  { id: 'remote', label: 'Remote devboxes (illustrative)', lifecycle: 'ephemeral', concurrency: 8 },
]

const orbstack = (
  name: string,
  status: Forge['status'],
  cpus: number,
  memory: string,
  createdAt: number,
  jobsRun: number,
  currentJobId?: string,
): Forge => ({
  name,
  adapter: 'orbstack',
  status,
  lifecycle: 'pooled',
  runtime: { image: 'foundry/forge:latest', cpus: String(cpus), memory },
  runtimeSummary: `${cpus}c/${memory}`,
  host: `${name}.foundry.local`,
  createdAt,
  jobsRun,
  currentJobId,
})

export const FORGES: Array<Forge> = [
  orbstack('anvil', 'busy', 4, '8g', Date.now() - 864e5 * 3, 12, 'job_017kq2'),
  orbstack('bellows', 'idle', 2, '4g', Date.now() - 864e5 * 2, 7),
  orbstack('crucible', 'busy', 6, '12g', Date.now() - 36e5 * 9, 3, 'job_017kp8'),
  orbstack('tongs', 'idle', 2, '4g', Date.now() - 36e5 * 4, 1),
  orbstack('quench', 'stopped', 4, '8g', Date.now() - 864e5 * 6, 21),
]

const line = (stream: LogLine['stream'], text: string, t: number): LogLine => ({ stream, text, t })

let seq = 41
const nextId = () => `job_${(++seq).toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 5)}`

const now = Date.now()

export const JOBS: Array<Job> = [
  {
    id: 'job_017kq2',
    task: 'Migrate the test runner from jest to vitest and get CI green',
    repo: { kind: 'local', name: 'binery-core', path: `${HOME}/git/binery-core` },
    baseBranch: 'develop',
    branch: 'foundry/vitest-migration',
    forge: 'anvil',
    status: 'running',
    worktree: true,
    createdAt: now - 1000 * 60 * 14,
    startedAt: now - 1000 * 60 * 13,
    logs: [
      line('sys', '$ foundry run anvil -- "migrate jest -> vitest"', now - 780e3),
      line('out', 'Reading package.json, jest.config.ts, 41 test files', now - 770e3),
      line('tool', 'Edit  jest.config.ts -> vitest.config.ts', now - 700e3),
      line('tool', 'Bash  bun remove jest ts-jest @types/jest', now - 640e3),
      line('out', 'removed 148 packages in 2.1s', now - 630e3),
      line('tool', 'Bash  bun add -d vitest @vitest/coverage-v8', now - 600e3),
      line('tool', 'Edit  src/**/*.test.ts (41 files) — jest.fn -> vi.fn', now - 420e3),
      line('tool', 'Bash  bun run test', now - 180e3),
      line('err', 'FAIL  src/billing/proration.test.ts > handles mid-cycle upgrade', now - 150e3),
      line('out', 'Investigating: fake timers behave differently under vitest', now - 90e3),
      line('tool', 'Edit  src/billing/proration.test.ts', now - 40e3),
    ],
  },
  {
    id: 'job_017kp8',
    task: 'Add rate limiting to the public webhook endpoint',
    repo: { kind: 'local', name: 'binery-accounting-backend', path: `${HOME}/git/binery-accounting-backend` },
    baseBranch: 'main',
    branch: 'foundry/webhook-ratelimit',
    forge: 'crucible',
    status: 'running',
    worktree: true,
    createdAt: now - 1000 * 60 * 6,
    startedAt: now - 1000 * 60 * 5,
    logs: [
      line('sys', '$ foundry run crucible -- "rate limit webhooks"', now - 300e3),
      line('out', 'Found 3 webhook handlers under src/webhooks/', now - 280e3),
      line('tool', 'Read  src/webhooks/router.ts', now - 240e3),
      line('tool', 'Edit  src/middleware/rate-limit.ts', now - 120e3),
      line('tool', 'Bash  bun test src/middleware', now - 30e3),
    ],
  },
  {
    id: 'job_017kn1',
    task: 'Upgrade to React 19 and fix the resulting type errors',
    repo: { kind: 'local', name: 'binery-frontend', path: `${HOME}/git/binery-frontend` },
    baseBranch: 'main',
    branch: 'foundry/react-19',
    forge: 'bellows',
    status: 'succeeded',
    worktree: true,
    createdAt: now - 1000 * 60 * 96,
    startedAt: now - 1000 * 60 * 95,
    finishedAt: now - 1000 * 60 * 61,
    exitCode: 0,
    diff: { files: 38, additions: 412, deletions: 297 },
    logs: [
      line('sys', '$ foundry run bellows -- "upgrade to react 19"', now - 5700e3),
      line('tool', 'Bash  bun add react@19 react-dom@19', now - 5680e3),
      line('tool', 'Edit  38 files', now - 4200e3),
      line('tool', 'Bash  bun run typecheck', now - 3700e3),
      line('out', 'No errors found.', now - 3660e3),
      line('sys', 'exit 0 — 34m 12s', now - 3660e3),
    ],
  },
  {
    id: 'job_017km4',
    task: 'Write integration tests for the subscription proration logic',
    repo: { kind: 'local', name: 'binery-core', path: `${HOME}/git/binery-core` },
    baseBranch: 'develop',
    branch: 'foundry/proration-tests',
    forge: 'tongs',
    status: 'failed',
    worktree: true,
    createdAt: now - 1000 * 60 * 210,
    startedAt: now - 1000 * 60 * 209,
    finishedAt: now - 1000 * 60 * 188,
    exitCode: 1,
    diff: { files: 4, additions: 186, deletions: 3 },
    logs: [
      line('sys', '$ foundry run tongs -- "integration tests for proration"', now - 12540e3),
      line('tool', 'Bash  docker compose up -d postgres', now - 12500e3),
      line('err', 'Cannot connect to the Docker daemon inside the forge', now - 12480e3),
      line('out', 'No docker socket mounted — falling back to sqlite', now - 12400e3),
      line('err', 'FAIL  8 of 14 tests — sqlite lacks interval arithmetic', now - 11300e3),
      line('sys', 'exit 1 — 20m 47s', now - 11280e3),
    ],
  },
  {
    id: 'job_017kl9',
    task: 'Document every public endpoint in the OpenAPI spec',
    repo: { kind: 'local', name: 'binery-acs', path: `${HOME}/git/binery-acs` },
    baseBranch: 'release/2.4',
    branch: 'foundry/openapi-docs',
    forge: 'bellows',
    status: 'queued',
    worktree: true,
    createdAt: now - 1000 * 45,
    logs: [line('sys', 'queued — waiting for a free forge', now - 45e3)],
  },
  {
    id: 'job_017kj2',
    task: 'Strip dead feature flags from the checkout flow',
    repo: { kind: 'local', name: 'binery-frontend', path: `${HOME}/git/binery-frontend` },
    baseBranch: 'main',
    branch: 'foundry/flag-cleanup',
    forge: 'quench',
    status: 'cancelled',
    worktree: false,
    createdAt: now - 1000 * 60 * 400,
    startedAt: now - 1000 * 60 * 399,
    finishedAt: now - 1000 * 60 * 396,
    logs: [
      line('sys', '$ foundry run quench -- "remove dead feature flags"', now - 23940e3),
      line('sys', 'cancelled by user — 2m 51s', now - 23760e3),
    ],
  },
]

export const latency = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

export function addJob(input: NewJobInput): Job {
  const slug =
    input.task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .split('-')
      .filter(Boolean)
      .slice(0, 3)
      .join('-') || 'task'

  const job: Job = {
    id: nextId(),
    task: input.task.trim(),
    repo: input.repo,
    baseBranch: input.baseBranch,
    branch: `foundry/${slug}`,
    forge: input.forge,
    status: 'queued',
    worktree: input.worktree,
    createdAt: Date.now(),
    logs: [line('sys', `queued on ${input.forge}`, Date.now())],
  }
  JOBS.push(job)
  return job
}

export function stopJob(id: string) {
  const job = JOBS.find((j) => j.id === id)
  if (!job || (job.status !== 'running' && job.status !== 'queued')) return
  job.status = 'cancelled'
  job.finishedAt = Date.now()
  job.logs.push(line('sys', 'cancelled by user', Date.now()))
  releaseForge(job)
}

function releaseForge(job: Job) {
  const forge = FORGES.find((f) => f.name === job.forge)
  if (forge && forge.currentJobId === job.id) {
    forge.status = 'idle'
    forge.currentJobId = undefined
  }
}

/* ── liveness simulator ───────────────────────────────────────────────
   Advances queued -> running -> settled so the ledger is never static. */

const CHATTER = [
  'Read  src/index.ts',
  'Grep  "featureFlag" (18 matches)',
  'Edit  src/config/flags.ts',
  'Bash  bun run typecheck',
  'Bash  bun test --filter unit',
  'Read  package.json',
  'Edit  src/lib/client.ts',
  'Bash  git add -A && git commit -m "wip"',
]

let ticking = false

export function startSimulator() {
  if (ticking || typeof window === 'undefined') return
  ticking = true
  setInterval(() => {
    const t = Date.now()
    for (const job of JOBS) {
      if (job.status === 'queued' && t - job.createdAt > 6000) {
        const forge = FORGES.find((f) => f.name === job.forge)
        if (forge && forge.status === 'busy') continue
        job.status = 'running'
        job.startedAt = t
        job.logs.push(line('sys', `$ foundry run ${job.forge} -- "${job.task.slice(0, 48)}"`, t))
        if (forge) {
          forge.status = 'busy'
          forge.currentJobId = job.id
          forge.jobsRun += 1
        }
        continue
      }
      if (job.status !== 'running') continue

      if (Math.random() < 0.45) {
        job.logs.push(line(Math.random() < 0.7 ? 'tool' : 'out', CHATTER[Math.floor(Math.random() * CHATTER.length)], t))
        if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400)
      }
      const elapsed = t - (job.startedAt ?? t)
      if (elapsed > 90_000 && Math.random() < 0.04) {
        const failed = Math.random() < 0.25
        job.status = failed ? 'failed' : 'succeeded'
        job.exitCode = failed ? 1 : 0
        job.finishedAt = t
        job.diff = {
          files: 2 + Math.floor(Math.random() * 30),
          additions: 20 + Math.floor(Math.random() * 500),
          deletions: 5 + Math.floor(Math.random() * 200),
        }
        job.logs.push(line(failed ? 'err' : 'sys', `exit ${job.exitCode}`, t))
        releaseForge(job)
      }
    }
  }, 1000)
}
