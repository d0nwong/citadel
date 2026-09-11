/**
 * Node-only. Imported exclusively from inside server-function handlers — never
 * from a module a client component pulls in.
 *
 * DATABASE_URL comes from web/.env, which bun loads for us. The fallback is the
 * stack `just up postgres` brings up, so a fresh clone needs no configuration.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://foundry:foundry@localhost:5432/foundry'

// One pool per process. Vite reloads this module on edit, so keep it small.
const sql = postgres(DATABASE_URL, { max: 8 })

export const db = drizzle(sql, { schema })
