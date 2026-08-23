/**
 * Temporary in-memory stand-in for the forge inventory.
 *
 * Jobs and repos are real now — Postgres, via each feature's `server/` module.
 * What is left here is forges, whose real source is `foundry ls` / docker
 * labels. `features/forges/api.ts` wraps this slice, so when that lands this
 * whole directory gets deleted and only that wrapper changes.
 */
import type { AdapterInfo, Forge } from '@/features/forges/types'

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
})

/**
 * No `currentJobId` on any of these: a forge is only busy when a real job row
 * says so, and nothing assigns work to a forge until LIA-13.
 */
export const FORGES: Array<Forge> = [
  orbstack('anvil', 'idle', 4, '8g', Date.now() - 864e5 * 3, 12),
  orbstack('bellows', 'idle', 2, '4g', Date.now() - 864e5 * 2, 7),
  orbstack('crucible', 'idle', 6, '12g', Date.now() - 36e5 * 9, 3),
  orbstack('tongs', 'idle', 2, '4g', Date.now() - 36e5 * 4, 1),
  orbstack('quench', 'stopped', 4, '8g', Date.now() - 864e5 * 6, 21),
]

export const latency = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
