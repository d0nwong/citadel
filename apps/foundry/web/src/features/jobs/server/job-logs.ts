/**
 * Node-only. A job's log, on disk: one JSONL file per job under
 * ~/.foundry/logs, the way Claude Code keeps a session under ~/.claude/projects.
 *
 * These lines are append-only, per-job, never joined and never updated — the
 * only two operations are "append" and "read this job's lines in order", so a
 * table bought nothing and cost a round trip per batch plus a full select on
 * every one-second poll. As files they are also `cat`-able, `grep`-able and
 * `tail -f`-able without the app.
 *
 * One line is one `LogLine`, so the wire format and the domain type are the
 * same object. Files outlive the workspace on purpose: `foundry jobs prune`
 * clears ~/.foundry/jobs, and a job's history should survive its clone.
 */
import { appendFile, mkdir, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LogLine, LogStream } from '../types'

export const FOUNDRY_HOME = process.env.FOUNDRY_HOME ?? path.join(homedir(), '.foundry')
export const LOGS_DIR = path.join(FOUNDRY_HOME, 'logs')

export const logFile = (jobId: string) => path.join(LOGS_DIR, `${jobId}.jsonl`)

/**
 * Appends run serialised per job. Callers fire these off from several places at
 * once — the runner's `sys` helper, the container's callback, the queue pump —
 * and a chain per job id keeps their order the order they were called in.
 */
const chains = new Map<string, Promise<void>>()

function enqueue(jobId: string, work: () => Promise<void>): Promise<void> {
  const next = (chains.get(jobId) ?? Promise.resolve()).then(work, work)
  chains.set(jobId, next)
  // Drop the entry once nothing is queued behind it, so the map tracks only
  // jobs with writes in flight rather than every job this process ever saw.
  void next.then(() => {
    if (chains.get(jobId) === next) chains.delete(jobId)
  })
  return next
}

/**
 * Never throws: a log line that cannot be written is worth a console warning,
 * not a failed job — every caller is on a path that has real work to finish.
 */
export async function appendLogs(jobId: string, lines: Array<{ stream: LogStream; text: string }>): Promise<void> {
  if (lines.length === 0) return
  const t = Date.now()
  const chunk = lines.map((l) => `${JSON.stringify({ t, stream: l.stream, text: l.text } satisfies LogLine)}\n`).join('')

  return enqueue(jobId, async () => {
    try {
      await mkdir(LOGS_DIR, { recursive: true })
      await appendFile(logFile(jobId), chunk, 'utf8')
    } catch (e) {
      console.error(`job ${jobId}: could not write log lines —`, e)
    }
  })
}

/**
 * A malformed line is skipped rather than thrown on: the sheet polls while the
 * job is still writing, and one torn trailing line must not blank the whole
 * log. No file means no lines yet — the honest answer for a job that has just
 * been queued, and for one whose logs were pruned.
 */
export async function readLogs(jobId: string): Promise<Array<LogLine>> {
  let raw: string
  try {
    raw = await readFile(logFile(jobId), 'utf8')
  } catch {
    return []
  }

  const lines: Array<LogLine> = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      lines.push(JSON.parse(line) as LogLine)
    } catch {
      /* torn or truncated — skip it */
    }
  }
  return lines
}

/** Takes the place of the FK cascade `job_logs` used to have on `jobs`. */
export async function deleteLogs(jobIds: Array<string>): Promise<void> {
  await Promise.all(
    jobIds.map((id) =>
      unlink(logFile(id)).catch(() => {
        /* already gone */
      }),
    ),
  )
}
