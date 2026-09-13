/**
 * Node-only. The base-state cache (CTD-187): one row per repo and base sha,
 * holding the `~/baseline.md` a job's pre-step measured. Written from the
 * events handler when a container posts one, read by the runner before it
 * launches the next container on the same base.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { baselines } from '@/db/schema'

export type BaselineRow = typeof baselines.$inferSelect

export async function getBaseline(repo: string, baseSha: string): Promise<BaselineRow | undefined> {
  const [row] = await db
    .select()
    .from(baselines)
    .where(and(eq(baselines.repo, repo), eq(baselines.baseSha, baseSha)))
  return row
}

/**
 * Upsert: two jobs on a fresh base can both measure it (neither found a row at
 * launch), and the later report simply replaces the earlier — same commit,
 * same answer.
 */
export async function putBaseline(row: { repo: string; baseSha: string; body: string; jobId: string }): Promise<void> {
  await db
    .insert(baselines)
    .values(row)
    .onConflictDoUpdate({
      set: { body: row.body, createdAt: new Date(), jobId: row.jobId },
      target: [baselines.repo, baselines.baseSha],
    })
}
