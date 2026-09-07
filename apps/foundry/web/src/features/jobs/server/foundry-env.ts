/**
 * Node-only. The credentials `foundry auth` stores, as `KEY=value` lines in
 * the checkout's own `.env` (gitignored, mode 600): the Claude credential,
 * FOUNDRY_MCP_TOKEN, SLACK_TOKEN, LINEAR_API_KEY, FOUNDRY_API_TOKEN. Read
 * fresh by every caller (a job launch, a scan tick, an API request), so
 * `foundry auth …` takes effect without a restart.
 */
import { readFile } from 'node:fs/promises'
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

export const readFoundryEnv = (): Promise<Record<string, string>> => readEnvFile(ENV_FILE)
