/**
 * Node-only. The forge inventory, read live from docker — the mock this
 * replaces was the last fake data in the app.
 *
 * Two kinds of container count as a forge:
 *   - label `foundry.forge` — pooled, created by `foundry new`, long-lived
 *   - label `foundry.job`   — ephemeral, one per running job (LIA-13)
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AdapterInfo, Forge } from '../types'

const exec = promisify(execFile)

const MAX_JOBS = Number(process.env.FOUNDRY_MAX_JOBS ?? 3)

/** Same pinning as the job runner: forges are an OrbStack feature. */
const DOCKER_CONTEXT = process.env.FOUNDRY_DOCKER_CONTEXT ?? 'orbstack'

async function docker(args: Array<string>): Promise<string> {
  const { stdout } = await exec('docker', args, {
    timeout: 10_000,
    env: { ...process.env, DOCKER_CONTEXT },
  })
  return stdout.trim()
}

export async function listAdapters(): Promise<Array<AdapterInfo>> {
  return [{ id: 'orbstack', label: 'OrbStack — local containers', lifecycle: 'ephemeral', concurrency: MAX_JOBS }]
}

interface InspectRow {
  name: string
  labels: Record<string, string>
  state: string
  started: string
  created: string
  image: string
}

async function inspectAll(ids: Array<string>): Promise<Array<InspectRow>> {
  if (ids.length === 0) return []
  const out = await docker([
    'inspect',
    ...ids,
    '--format',
    '{"name":{{json .Name}},"labels":{{json .Config.Labels}},"state":{{json .State.Status}},"started":{{json .State.StartedAt}},"created":{{json .Created}},"image":{{json .Config.Image}}}',
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as InspectRow)
}

/**
 * Pooled forges plus whatever job containers are alive right now. Docker being
 * unreachable yields an empty inventory rather than a broken page — the jobs
 * pipeline reports that problem where it matters, on the job itself.
 */
export async function listForges(): Promise<Array<Forge>> {
  let rows: Array<InspectRow>
  try {
    const ids = (await docker(['ps', '-aq', '--filter', 'label=foundry.forge'])).split('\n').filter(Boolean)
    const jobIds = (await docker(['ps', '-q', '--filter', 'label=foundry.job'])).split('\n').filter(Boolean)
    rows = await inspectAll([...new Set([...ids, ...jobIds])])
  } catch {
    return []
  }

  return rows.map((r) => {
    const jobId = r.labels['foundry.job']
    const pooledName = r.labels['foundry.name']
    const name = pooledName ?? r.name.replace(/^\//, '')
    const running = r.state === 'running'
    return {
      name,
      adapter: 'orbstack',
      status: jobId ? 'busy' : running ? 'idle' : 'stopped',
      lifecycle: jobId ? 'ephemeral' : 'pooled',
      runtime: { image: r.image },
      runtimeSummary: r.image,
      host: pooledName ? `${pooledName}.foundry.local` : undefined,
      createdAt: Date.parse(r.created) || Date.now(),
      currentJobId: jobId,
      jobsRun: 0,
    } satisfies Forge
  })
}
