/**
 * `bun run db:migrate` — applies everything in ./migrations, then does the
 * one-time hand-over from the file the repo picker used to write.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { DATABASE_URL, db } from './client'
import { repos } from './schema'

const LEGACY_FILE = path.join(homedir(), '.foundry', 'repos.json')

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
await migrate(db, { migrationsFolder: './src/db/migrations' })
await importLegacyRepos()
console.log('done')

process.exit(0)
