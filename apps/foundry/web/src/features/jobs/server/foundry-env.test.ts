/**
 * The credential reader parses the one `.env` `foundry auth` writes: KEY=value
 * lines only, the last line for a key wins, and a missing file is empty rather
 * than an error.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readEnvFile } from './foundry-env'

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
