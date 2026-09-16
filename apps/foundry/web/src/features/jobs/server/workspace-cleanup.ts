/**
 * Node-only. What happens to a job's clone once it settles (CTD-181): a
 * succeeded job's `jobs/<id>` directory is removed — nothing reads it again —
 * and a failed one's is kept, because a push failure names it as the only copy
 * of the commit. A `pr_ready` job's workspace is removed exactly as a
 * succeeded one's (CTD-230): its PR is open on origin, so the clone is no
 * more needed than a merged one's would be. `FOUNDRY_KEEP_WORKSPACES=1` keeps
 * every one. Cancel never settles through here, so a cancelled job's clone
 * stays too.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'

type Log = (stream: 'sys' | 'err', text: string) => Promise<void>

export async function cleanupWorkspace(
  id: string,
  status: 'succeeded' | 'failed' | 'pr_ready',
  opts: { jobsDir: string; keep: boolean; log: Log },
): Promise<void> {
  const dir = path.join(opts.jobsDir, id)
  const work = path.join(dir, 'work')
  if (status === 'failed') return opts.log('sys', `workspace kept for inspection: ${work}`)
  if (opts.keep) return opts.log('sys', `workspace kept (FOUNDRY_KEEP_WORKSPACES=1): ${work}`)
  try {
    await rm(dir, { recursive: true, force: true })
    await opts.log('sys', 'workspace removed')
  } catch (e) {
    // Cleanup never fails a settle: the row is already terminal.
    await opts.log('err', `could not remove workspace ${dir}: ${(e as Error).message}`)
  }
}
