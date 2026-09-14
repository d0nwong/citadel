/**
 * The credential reader parses the one `.env` `foundry auth` writes: KEY=value
 * lines only, the last line for a key wins, and a missing file is empty rather
 * than an error. A key the file lacks comes from the environment, as in a container.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { forgeEnv, readCredentials, readEnvFile } from './foundry-env'

let root = ''
const env = () => path.join(root, 'env')

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'foundry-env-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readEnvFile', () => {
  test('reads KEY=value lines and skips everything else', async () => {
    await writeFile(
      env(),
      'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-x\nFOUNDRY_MCP_TOKEN=gw\n\n# comment\nnot a key\nSLACK_TOKEN=xoxp-x\nLINEAR_API_KEY=lin\n',
    )
    expect(await readEnvFile(env())).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-x',
      FOUNDRY_MCP_TOKEN: 'gw',
      LINEAR_API_KEY: 'lin',
      SLACK_TOKEN: 'xoxp-x',
    })
  })

  test('the last line for a key wins', async () => {
    await writeFile(env(), 'FOUNDRY_API_TOKEN=old\nFOUNDRY_API_TOKEN=new\n')
    expect((await readEnvFile(env())).FOUNDRY_API_TOKEN).toBe('new')
  })

  test('a missing file is empty and not an error', async () => {
    expect(await readEnvFile(path.join(root, 'absent'))).toEqual({})
  })
})

describe('readCredentials', () => {
  test("the file's value wins; a key it lacks comes from the environment", async () => {
    const file = path.join(root, 'creds')
    await writeFile(file, 'MCP_GATEWAY_TOKEN=gw\nLINEAR_API_KEY=lin\n')
    expect(await readCredentials(file, { CLAUDE_CODE_OAUTH_TOKEN: 'env-claude', HOME: '/x', LINEAR_API_KEY: 'env-lin' })).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'env-claude',
      LINEAR_API_KEY: 'lin',
      MCP_GATEWAY_TOKEN: 'gw',
    })
  })

  test('with no file (a container) the environment supplies the credentials, and nothing else of it', async () => {
    expect(await readCredentials(path.join(root, 'absent'), { PATH: '/bin', SLACK_TOKEN: 'xoxp' })).toEqual({ SLACK_TOKEN: 'xoxp' })
  })

  // CTD-203 AC1 — TRELLO_API_KEY and TRELLO_TOKEN are read the way LINEAR_API_KEY already is.
  test('reads both Trello keys from the file, and a rewritten value is what the next read answers', async () => {
    const file = path.join(root, 'trello')
    await writeFile(file, 'TRELLO_API_KEY=key-1\nTRELLO_TOKEN=tok-1\n')
    expect(await readCredentials(file, {})).toEqual({ TRELLO_API_KEY: 'key-1', TRELLO_TOKEN: 'tok-1' })

    await writeFile(file, 'TRELLO_API_KEY=key-1\nTRELLO_TOKEN=tok-2\n')
    expect(await readCredentials(file, {})).toEqual({ TRELLO_API_KEY: 'key-1', TRELLO_TOKEN: 'tok-2' })
  })

  test('an environment-only TRELLO_TOKEN is read too, as in a container', async () => {
    expect(await readCredentials(path.join(root, 'absent'), { TRELLO_TOKEN: 'tok-env' })).toEqual({ TRELLO_TOKEN: 'tok-env' })
  })
})

// CTD-204 AC1 — with every upstream credential on the host, the container's env carries
// none of them, nor any git, GitHub, Bitbucket or database credential.
describe('forgeEnv', () => {
  const withEverything: Record<string, string> = {
    ANTHROPIC_API_KEY: 'sk-ant-x',
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oauth',
    DATABASE_URL: 'postgresql://u:p@host/db',
    FOUNDRY_API_TOKEN: 'ftok',
    GH_TOKEN: 'gh-x',
    GITHUB_TOKEN: 'gh-y',
    LINEAR_API_KEY: 'lin',
    MCP_GATEWAY_TOKEN: 'gw',
    SLACK_TOKEN: 'xoxp',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    TRELLO_API_KEY: 'trello-key',
    TRELLO_TOKEN: 'trello-tok',
  }

  test('carries only the Claude credential and the gateway token — nothing upstream, git, GitHub, Bitbucket or database', () => {
    expect(forgeEnv(withEverything, 'http://gateway.test')).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oauth',
      FOUNDRY_MCP_TOKEN: 'gw',
      FOUNDRY_MCP_URL: 'http://gateway.test',
      FOUNDRY_MCP_SERVERS: 'linear,slack',
    })
  })

  test('ANTHROPIC_API_KEY is the fallback when there is no OAuth token', () => {
    const { CLAUDE_CODE_OAUTH_TOKEN: _drop, ...rest } = withEverything
    expect(forgeEnv(rest, 'http://gateway.test').ANTHROPIC_API_KEY).toBe('sk-ant-x')
  })

  test('with no MCP_GATEWAY_TOKEN, none of the gateway fields are set', () => {
    const { MCP_GATEWAY_TOKEN: _drop, ...rest } = withEverything
    expect(forgeEnv(rest, 'http://gateway.test')).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oauth' })
  })

  test('FOUNDRY_MCP_SERVERS in the credentials narrows the default list', () => {
    expect(forgeEnv({ ...withEverything, FOUNDRY_MCP_SERVERS: 'linear' }, 'http://gateway.test').FOUNDRY_MCP_SERVERS).toBe('linear')
  })

  test('no Claude credential at all throws, naming what to run', () => {
    const { CLAUDE_CODE_OAUTH_TOKEN: _a, ANTHROPIC_API_KEY: _b, ...rest } = withEverything
    expect(() => forgeEnv(rest, 'http://gateway.test')).toThrow('foundry auth')
  })
})
