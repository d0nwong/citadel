/**
 * Node-only. The credentials `foundry auth` stores, as `KEY=value` lines in
 * two files: ~/.foundry/env for foundry's own (the Claude credential,
 * FOUNDRY_MCP_TOKEN) and ~/.config/liamai/env — `LIAMAI_ENV` overrides the
 * path — for the keys argus and Pensieve read too (SLACK_TOKEN,
 * LINEAR_API_KEY, FOUNDRY_API_TOKEN). Both are read fresh by every caller (a
 * job launch, a scan tick, an API request), so `foundry auth …` takes effect
 * without a restart; on a clash the shared file wins.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { FOUNDRY_HOME } from './job-logs'

export const ENV_FILE = path.join(FOUNDRY_HOME, 'env')
export const SHARED_ENV_FILE = process.env.LIAMAI_ENV ?? path.join(homedir(), '.config', 'liamai', 'env')

async function parseEnvFile(file: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    for (const line of (await readFile(file, 'utf8')).split('\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* no file — preflight reports it */
  }
  return out
}

/** Both files merged, the shared one over foundry's own. Paths are explicit so the tests need no real home. */
export async function readEnvFiles(own: string, shared: string): Promise<Record<string, string>> {
  return { ...(await parseEnvFile(own)), ...(await parseEnvFile(shared)) }
}

export const readFoundryEnv = (): Promise<Record<string, string>> => readEnvFiles(ENV_FILE, SHARED_ENV_FILE)
