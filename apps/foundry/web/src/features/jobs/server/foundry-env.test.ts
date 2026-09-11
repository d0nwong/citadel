/**
 * The credential reader parses the one `.env` `foundry auth` writes: KEY=value
 * lines only, the last line for a key wins, and a missing file is empty rather
 * than an error. The upstream keys come from argus's `.env` when it has them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readCredentials, readEnvFile } from './foundry-env'

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
  test("argus's value wins for the keys argus owns; foundry's own keys stay foundry's", async () => {
    const own = path.join(root, 'own')
    const argus = path.join(root, 'argus')
    await writeFile(own, 'FOUNDRY_MCP_TOKEN=gw\nLINEAR_API_KEY=stale\nSLACK_TOKEN=stale\n')
    await writeFile(argus, 'LINEAR_API_KEY=lin\nSLACK_TOKEN=xoxp\nMCP_GATEWAY_TOKEN=gw\nBITBUCKET_CONFIG=x\n')
    expect(await readCredentials(own, argus)).toEqual({ FOUNDRY_MCP_TOKEN: 'gw', LINEAR_API_KEY: 'lin', SLACK_TOKEN: 'xoxp' })
  })

  test("with no argus file, or a key argus lacks, foundry's copy is the fallback", async () => {
    const own = path.join(root, 'own2')
    await writeFile(own, 'LINEAR_API_KEY=mine\n')
    expect((await readCredentials(own, path.join(root, 'absent'))).LINEAR_API_KEY).toBe('mine')
    const argus = path.join(root, 'argus2')
    await writeFile(argus, 'SLACK_TOKEN=xoxp\n')
    expect(await readCredentials(own, argus)).toEqual({ LINEAR_API_KEY: 'mine', SLACK_TOKEN: 'xoxp' })
  })
})
