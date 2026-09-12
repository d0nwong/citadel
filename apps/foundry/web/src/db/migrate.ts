/**
 * `just migrate` — applies everything in ./migrations, wrapped in the
 * two one-time hand-overs from the files that used to hold this state (repos)
 * and the table that used to hold it (job logs).
 */
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { DATABASE_URL, db } from './client'
import { repos } from './schema'
import { LOGS_DIR, logFile } from '@/features/jobs/server/job-logs'

const LEGACY_FILE = path.join(homedir(), '.foundry', 'repos.json')

/**
 * Moves the `job_logs` rows to ~/.foundry/logs/<job-id>.jsonl before the
 * migration below drops the table (LIA-18) — old jobs keep their output in the
 * detail sheet. Runs *first* for that reason, and is a no-op once the table is
 * gone, so a fresh database and a second `db:migrate` both cost one cheap
 * `to_regclass`. A job that already has a file is left alone: never clobber the
 * log of a job that is running right now.
 */
async function exportLegacyJobLogs() {
  const [{ exists }] = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('foundry.job_logs') is not null as exists`,
  )
  if (!exists) return

  // `t` arrives as a string here: a raw `execute` skips the column-type
  // mapping drizzle applies to a schema-typed select, and the table this reads
  // is no longer in the schema to be typed by.
  const rows = await db.execute<{ job_id: string; t: string; stream: string; text: string }>(
    sql`select job_id, t, stream, text from foundry.job_logs order by job_id, id`,
  )

  const byJob = new Map<string, Array<string>>()
  for (const row of rows) {
    const line = JSON.stringify({ t: new Date(row.t).getTime(), stream: row.stream, text: row.text })
    const lines = byJob.get(row.job_id)
    if (lines) lines.push(line)
    else byJob.set(row.job_id, [line])
  }
  if (byJob.size === 0) return

  await mkdir(LOGS_DIR, { recursive: true })
  let written = 0
  for (const [jobId, lines] of byJob) {
    const file = logFile(jobId)
    if (await access(file).then(() => true, () => false)) continue
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8')
    written++
  }
  console.log(`exported ${written} job log(s) from foundry.job_logs to ${LOGS_DIR}`)
}

/**
 * Adopts ~/.foundry/repos.json into the repos table. Idempotent, and it leaves
 * the file alone — ~/.foundry is the CLI's state directory, not ours to delete.
 */
async function importLegacyRepos() {
  let tracked: Array<string>
  try {
    const parsed = JSON.parse(await readFile(LEGACY_FILE, 'utf8')) as { tracked?: Array<string> }
    tracked = parsed.tracked ?? []
  } catch {
    return // no file, or unreadable — nothing to adopt
  }
  if (tracked.length === 0) return

  const rows = tracked.map((p) => ({ path: p, name: path.basename(p) }))
  const inserted = await db.insert(repos).values(rows).onConflictDoNothing({ target: repos.path }).returning()
  if (inserted.length > 0) console.log(`imported ${inserted.length} repo(s) from ${LEGACY_FILE}`)
}

console.log(`migrating ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
await exportLegacyJobLogs()
await migrate(db, { migrationsFolder: './src/db/migrations' })
await importLegacyRepos()
console.log('done')

process.exit(0)
