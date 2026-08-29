/**
 * Node-only. The scanner's ticket→repo mapping: ~/.foundry/scanner.json maps a
 * Linear *project name* to the local checkout its jobs should run against.
 *
 *   { "alden-portal": { "repoPath": "/Users/me/git/alden-portal-fe",
 *                       "baseBranch": "staging", "blueprintId": "…" } }
 *
 * Read fresh on every tick, the way `readFoundryEnv` reads credentials — an
 * edit takes effect without restarting the server. A missing or unparsable
 * file degrades to "everything unmapped, skip and log", never a crash: the
 * config is the human's side of the contract, and a typo should cost a
 * skipped scan, not a dead scanner.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { FOUNDRY_HOME } from '@/features/jobs/server/job-logs'

const CONFIG_FILE = path.join(FOUNDRY_HOME, 'scanner.json')
const run = promisify(execFile)

export interface RepoMapping {
  repoPath: string
  /** Defaults to the checkout's origin/HEAD when absent. */
  baseBranch?: string
  /** Defaults to DEFAULT_BLUEPRINT_ID when absent. */
  blueprintId?: string
}

/** Linear project name → mapping. `{}` when the file is missing or bad. */
export async function readScannerConfig(log: (msg: string) => void = console.error): Promise<Record<string, RepoMapping>> {
  let raw: string
  try {
    raw = await readFile(CONFIG_FILE, 'utf8')
  } catch {
    return {} // no file — every project reads as unmapped
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, RepoMapping> = {}
    for (const [project, entry] of Object.entries(parsed)) {
      const m = entry as Partial<RepoMapping> | null
      if (m && typeof m.repoPath === 'string') out[project] = m as RepoMapping
      else log(`[scanner] ${CONFIG_FILE}: entry "${project}" has no repoPath — ignored`)
    }
    return out
  } catch (e) {
    log(`[scanner] ${CONFIG_FILE} is not valid JSON — treating every project as unmapped (${String(e)})`)
    return {}
  }
}

/** origin's default branch of a checkout, as repo-scan derives it; 'main' fallback. */
export async function defaultBranchOf(repoPath: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
      timeout: 5000,
    })
    return stdout.trim().replace(/^origin\//, '') || 'main'
  } catch {
    return 'main'
  }
}
