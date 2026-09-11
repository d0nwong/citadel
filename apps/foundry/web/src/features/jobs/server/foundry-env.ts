/**
 * Node-only. The credentials `foundry auth` stores, as `KEY=value` lines in
 * the checkout's own `.env` (gitignored, mode 600): the Claude credential,
 * FOUNDRY_MCP_TOKEN, FOUNDRY_API_TOKEN. The upstream keys (LINEAR_API_KEY,
 * SLACK_TOKEN) are argus's: they live in argus's `.env`, beside the MCP gateway
 * argus runs, and are read from there, with a copy here only as a fallback.
 * Read fresh by every caller (a job launch, a scan tick, an API request), so
 * a new value takes effect without a restart.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** The repo root's `.env` — the dev server runs from `web/`, as job-runner's `RUNNER_SCRIPT` already assumes. */
export const ENV_FILE = path.resolve(process.cwd(), '..', '.env')

const ENV_LINE = /^([A-Z_][A-Z0-9_]*)=(.*)$/

/** One file, parsed; a missing file is `{}`. The path is explicit so the tests need no real checkout. */
export async function readEnvFile(file: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch {
    /* no file — preflight reports it */
  }
  for (const line of text.split('\n')) {
    const m = ENV_LINE.exec(line.trim())
    if (m) {
      out[m[1]] = m[2]
    }
  }
  return out
}

/** argus's `.env`, where the upstream keys live; `ARGUS_ENV` points elsewhere. */
export const ARGUS_ENV_FILE = process.env.ARGUS_ENV ?? path.join(homedir(), 'git/argus/.env')

/** The keys argus owns: the gateway's upstreams, which the host also calls directly (linear-link). */
export const ARGUS_KEYS = ['LINEAR_API_KEY', 'SLACK_TOKEN'] as const

/** foundry's own credentials, with argus's value for each key argus owns; foundry's copy only when argus has none. */
export async function readCredentials(foundryFile: string, argusFile: string): Promise<Record<string, string>> {
  const [own, argus] = await Promise.all([readEnvFile(foundryFile), readEnvFile(argusFile)])
  const out = { ...own }
  for (const k of ARGUS_KEYS) {
    if (argus[k]) {
      out[k] = argus[k]
    }
  }
  return out
}

export const readFoundryEnv = (): Promise<Record<string, string>> => readCredentials(ENV_FILE, ARGUS_ENV_FILE)
