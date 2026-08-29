/**
 * Node-only. The ready-ticket scanner (LIA-52): a periodic tick that turns
 * Linear tickets a human labeled `agent-ready` into jobs on the existing
 * pipeline. The scanner is a second door into that pipeline, not a pipeline —
 * everything after the claim is the same store/runner path the UI drives.
 *
 * The claim order is the invariant the tests pin down: the job row's unique
 * `ticket_id` insert comes FIRST, Linear writes (assign + In Progress) second,
 * ignition last. A crash anywhere in between is recovered — a lost Linear
 * write by the next tick's conflict-repair, a lost ignition by that plus the
 * runner's own reconcile/pump.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_BLUEPRINT_ID } from '@/features/blueprints/types'
import { getBlueprintRow } from '@/features/blueprints/server/blueprint-store'
import { claimTicketJob, getJobByTicketId, listOpenJobs } from '@/features/jobs/server/job-store'
import { readFoundryEnv, startJob } from '@/features/jobs/server/job-runner'
import { assessReadiness } from './readiness'
import { makeLinearPort } from './linear-scan'
import { readScannerConfig } from './repo-map'
import { defaultBranchOf } from './repo-map'
import type { LinearPort } from './linear-scan'
import type { RepoMapping } from './repo-map'

/** Still claimable on Linear's side — the repair path's staleness test. */
const CLAIMABLE_STATE_TYPES = ['triage', 'backlog', 'unstarted']

/** Everything one tick touches, injectable so tests can stub the edges. */
export interface TickDeps {
  linear: LinearPort
  readConfig: () => Promise<Record<string, RepoMapping>>
  claimTicketJob: typeof claimTicketJob
  getJobByTicketId: typeof getJobByTicketId
  listOpenJobs: typeof listOpenJobs
  ignite: (jobId: string) => Promise<void>
  maxJobs: number
  log: (msg: string) => void
}

/**
 * One scan pass. Never throws: the tick failing must never take the interval
 * with it, and one bad ticket must never block the others — so the whole pass
 * and each candidate get their own catch-and-log.
 */
export async function scanTick(deps: TickDeps): Promise<void> {
  try {
    // Claim only into free capacity, so labeled tickets queue in Linear —
    // where a human can still edit or unlabel them — not in the ledger.
    let budget = deps.maxJobs - (await deps.listOpenJobs()).length
    if (budget <= 0) {
      deps.log('at capacity — leaving labeled tickets for the next scan')
      return
    }

    const config = await deps.readConfig()
    const candidates = await deps.linear.fetchCandidates()

    // Both looked up lazily, at most once per tick — most ticks claim nothing.
    let viewer: Promise<string> | undefined
    const viewerOnce = () => (viewer ??= deps.linear.viewerId())
    const startedStates = new Map<string, string>()
    const startedStateFor = async (teamId: string) => {
      let id = startedStates.get(teamId)
      if (!id) {
        id = await deps.linear.startedStateId(teamId)
        startedStates.set(teamId, id)
      }
      return id
    }

    for (const c of candidates) {
      if (budget <= 0) break
      try {
        const verdict = assessReadiness({ body: c.body, blockedBy: c.blockedBy })
        if (!verdict.ready) {
          deps.log(`skip ${c.identifier}: ${verdict.reason}`)
          continue
        }

        const mapping = c.projectName === null ? undefined : config[c.projectName]
        if (!mapping) {
          deps.log(`skip ${c.identifier}: project ${c.projectName === null ? '(none)' : `"${c.projectName}"`} not mapped in ~/.foundry/scanner.json`)
          continue
        }
        // A typo'd path should cost a skip, not a claimed ticket with a job
        // that can only fail preflight.
        try {
          await stat(mapping.repoPath)
        } catch {
          deps.log(`skip ${c.identifier}: mapped repoPath ${mapping.repoPath} does not exist`)
          continue
        }

        const baseBranch = mapping.baseBranch ?? (await defaultBranchOf(mapping.repoPath))
        // A configured-but-deleted blueprint degrades to a bare single-step
        // job rather than tripping the store's "no longer exists" throw.
        const wanted = mapping.blueprintId ?? DEFAULT_BLUEPRINT_ID
        const blueprintId = (await getBlueprintRow(wanted)) ? wanted : undefined

        // The ticket body IS the job brief — every section, behind the key,
        // title and URL. `branchSlug` and the PR↔ticket linker both key off
        // the leading identifier for free.
        const task = `${c.identifier}: ${c.title}\n${c.url}\n\n${c.body}`

        const job = await deps.claimTicketJob(
          {
            task,
            repo: { kind: 'local', name: path.basename(mapping.repoPath), path: mapping.repoPath },
            baseBranch,
            forge: 'orbstack',
            blueprintId,
          },
          c.identifier,
        )

        if (job === null) {
          await repairClaim(deps, c, startedStateFor, viewerOnce)
          continue
        }

        // Only now — the row is the claim — mirror it to Linear. If either
        // write throws, the queued row stands and the next tick's repair pass
        // re-applies them; per-candidate catch logs it below.
        await deps.linear.claimIssue(c.id, await viewerOnce(), await startedStateFor(c.teamId))

        budget -= 1
        deps.log(`claimed ${c.identifier} → job ${job.id.slice(0, 8)}`)
        void deps.ignite(job.id)
      } catch (e) {
        deps.log(`${c.identifier}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } catch (e) {
    deps.log(`tick failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * The claim insert conflicted: someone holds the ticket. Almost always that is
 * a previous tick and there is nothing to do — except when a crash landed
 * between that insert and its Linear write or ignition, which is exactly the
 * case where the row is still open but the ticket still reads as claimable.
 */
async function repairClaim(
  deps: TickDeps,
  c: { id: string; identifier: string; teamId: string },
  startedStateFor: (teamId: string) => Promise<string>,
  viewerOnce: () => Promise<string>,
): Promise<void> {
  const row = await deps.getJobByTicketId(c.identifier)
  if (!row) return // purged between conflict and read — next tick reclaims

  if (row.status !== 'queued' && row.status !== 'running') {
    deps.log(`${c.identifier} already ran (${row.status}) — unlabel it, or purge the job to let the scanner retry`)
    return
  }

  if (!CLAIMABLE_STATE_TYPES.includes(await deps.linear.issueStateType(c.id))) return // fully claimed — the normal case

  await deps.linear.claimIssue(c.id, await viewerOnce(), await startedStateFor(c.teamId))
  if (row.status === 'queued') void deps.ignite(row.id)
  deps.log(`repaired claim for ${c.identifier}`)
}

/** `scanTick` on the real edges — the interval's payload. */
export async function runTick(): Promise<void> {
  // Read fresh every tick, like job launches do — `foundry auth --linear`
  // takes effect without a restart.
  const cred = await readFoundryEnv()
  const key = cred.LINEAR_API_KEY ?? process.env.LINEAR_API_KEY
  if (!key) {
    console.error('[scanner] no LINEAR_API_KEY (run `foundry auth --linear`) — skipping scan')
    return
  }
  const g = globalThis as TickGlobal
  if (g.__foundryScannerTicking) return // a slow tick outlived the interval — skip, don't stack
  g.__foundryScannerTicking = true
  try {
    await scanTick({
      linear: makeLinearPort(key),
      readConfig: () => readScannerConfig(),
      claimTicketJob,
      getJobByTicketId,
      listOpenJobs,
      ignite: (id) => startJob(id),
      maxJobs: Number(process.env.FOUNDRY_MAX_JOBS ?? 3),
      log: (m) => console.log(`[scanner] ${m}`),
    })
  } finally {
    g.__foundryScannerTicking = false
  }
}

/**
 * Interval state lives on globalThis, not module scope: HMR re-executes this
 * module (the db/client.ts lesson), and the vite plugin's boot kick may load
 * it through a second SSR module graph — one timer must survive both.
 */
type TickGlobal = typeof globalThis & {
  __foundryScannerTimer?: ReturnType<typeof setInterval>
  __foundryScannerTicking?: boolean
}

const INTERVAL_S = Math.max(5, Number(process.env.FOUNDRY_SCANNER_INTERVAL ?? 300) || 300)

/**
 * Arm the interval. Idempotent and env-gated; importing this module never
 * starts anything — the vite `scannerBoot` plugin is the one caller.
 */
export function startScanner(): void {
  if (process.env.FOUNDRY_SCANNER !== '1') return // belt and braces with the plugin's gate
  const g = globalThis as TickGlobal
  if (g.__foundryScannerTimer) clearInterval(g.__foundryScannerTimer)
  g.__foundryScannerTimer = setInterval(() => void runTick(), INTERVAL_S * 1000)
  console.log(`[scanner] polling Linear for agent-ready tickets every ${INTERVAL_S}s`)
  void runTick()
}
