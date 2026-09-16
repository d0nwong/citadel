/**
 * Test-only. Tests that need Postgres register through these, so a checkout
 * with no database (a forge sandbox) skips them in a second instead of
 * failing each one on a refused connection.
 *
 * A set DATABASE_URL (CI, or web/.env) means a database is expected: nothing
 * is skipped, and an unreachable one fails loudly. Only the unset fallback is
 * probed.
 */
import { afterAll, beforeAll, test } from 'bun:test'
import postgres from 'postgres'
import { DATABASE_URL } from './client'

async function reachable(): Promise<boolean> {
  if (process.env.DATABASE_URL) return true
  const probe = postgres(DATABASE_URL, { max: 1, connect_timeout: 2, onnotice: () => {} })
  try {
    await probe`select 1`
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 0 })
  }
}

export const hasDb = await reachable()
if (!hasDb) console.warn(`no database at ${new URL(DATABASE_URL).host} — skipping tests that need one (CI runs them)`)

export const dbTest = test.skipIf(!hasDb)

export function dbBeforeAll(fn: () => Promise<unknown>): void {
  if (hasDb) beforeAll(fn)
}

export function dbAfterAll(fn: () => Promise<unknown>): void {
  if (hasDb) afterAll(fn)
}
