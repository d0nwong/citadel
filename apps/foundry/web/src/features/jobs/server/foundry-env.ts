/**
 * Node-only. `KEY=value` lines of ~/.foundry/env — the credentials `foundry
 * auth` stores. Read fresh by every caller (a job launch, a scan tick, an API
 * request), so `foundry auth …` takes effect without a restart.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FOUNDRY_HOME } from './job-logs'

export const ENV_FILE = path.join(FOUNDRY_HOME, 'env')

export async function readFoundryEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    for (const line of (await readFile(ENV_FILE, 'utf8')).split('\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* no file — preflight reports it */
  }
  return out
}
