/**
 * Node-only. The credentials, as `KEY=value` lines in citadel's one `.env` at the repo root
 * (gitignored, mode 600): the Claude credential, the MCP gateway token, the trigger-API
 * bearer and the upstream keys (LINEAR_API_KEY, SLACK_TOKEN, TRELLO_API_KEY, TRELLO_TOKEN).
 * Read fresh by every caller (a job launch, a scan tick, an API request), so a new value
 * takes effect without a restart.
 * In a container there is no file: the same keys arrive as environment variables, and a key
 * the file lacks comes from there.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** citadel's root `.env`; the dev server runs from `apps/foundry/web/`, as job-runner's `RUNNER_SCRIPT` already assumes. `CITADEL_ENV` points elsewhere. */
export const ENV_FILE = process.env.CITADEL_ENV ?? path.resolve(process.cwd(), '..', '..', '..', '.env')

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

/** The keys Foundry reads, which the environment supplies when the file does not have them. */
export const CREDENTIAL_KEYS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'MCP_GATEWAY_TOKEN',
  'FOUNDRY_MCP_SERVERS',
  'FOUNDRY_API_TOKEN',
  'LINEAR_API_KEY',
  'SLACK_TOKEN',
  'TRELLO_API_KEY',
  'TRELLO_TOKEN',
] as const

/** The file's values over the environment's, for the keys Foundry reads. */
export async function readCredentials(
  file: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const k of CREDENTIAL_KEYS) {
    const v = env[k]
    if (v) {
      out[k] = v
    }
  }
  return { ...out, ...(await readEnvFile(file)) }
}

export const readFoundryEnv = (): Promise<Record<string, string>> => readCredentials(ENV_FILE)

/**
 * The container's whole environment (CTD-204's AC1): the Claude credential and, when
 * configured, the MCP gateway token — and nothing else of `cred`, no matter what else it
 * carries (`LINEAR_API_KEY`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, or a git/GitHub/Bitbucket/
 * database credential sitting in the same `.env`). Reaches Linear or Trello only by proxy
 * through the gateway, never directly — `FOUNDRY_MCP_SERVERS` narrows what box-init
 * registers there. Pure, so it is tested without docker or a database.
 */
export function forgeEnv(cred: Record<string, string>, mcpUrl: string): Record<string, string> {
  const env: Record<string, string> = {}
  if (cred.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = cred.CLAUDE_CODE_OAUTH_TOKEN
  else if (cred.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = cred.ANTHROPIC_API_KEY
  else throw new Error('no Claude credential for the forge — run: foundry auth')
  if (cred.MCP_GATEWAY_TOKEN) {
    env.FOUNDRY_MCP_TOKEN = cred.MCP_GATEWAY_TOKEN
    env.FOUNDRY_MCP_URL = mcpUrl
    env.FOUNDRY_MCP_SERVERS = cred.FOUNDRY_MCP_SERVERS || 'linear,slack'
  }
  return env
}
