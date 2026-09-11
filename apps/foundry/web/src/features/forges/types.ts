export type ForgeStatus = 'idle' | 'busy' | 'stopped'

/**
 * Pooled forges are named, long-lived and reused — the OrbStack containers.
 * Ephemeral ones are provisioned per job and have nothing to list in between,
 * which is how most remote runtimes behave.
 */
export type ForgeLifecycle = 'pooled' | 'ephemeral'

export interface Forge {
  name: string
  /** Which adapter owns this forge. The domain deliberately knows nothing else about it. */
  adapter: string
  status: ForgeStatus
  lifecycle: ForgeLifecycle
  /** Adapter-scoped facts, rendered as-is. Docker has image/cpus/memory; a remote has region/size. */
  runtime: Record<string, string>
  /** Compact form of `runtime` for dense UI. The adapter decides what is worth showing. */
  runtimeSummary: string
  /** Reachable address, if the adapter gives one. `.foundry.local` locally, a URL remotely. */
  host?: string
  createdAt: number
  currentJobId?: string
  jobsRun: number
}

/** How an adapter presents itself when it has no per-forge rows to show. */
export interface AdapterInfo {
  id: string
  label: string
  lifecycle: ForgeLifecycle
  /** Concurrent jobs this adapter will accept, if it caps them. */
  concurrency?: number
}
