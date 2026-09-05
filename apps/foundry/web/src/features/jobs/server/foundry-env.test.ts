/**
 * The credential reader merges ~/.foundry/env with the shared
 * ~/.config/liamai/env (LIA-98): both files are read, a key in both resolves
 * to the shared value, and either file may be missing.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readEnvFiles } from './foundry-env'

let root = ''
const own = () => path.join(root, 'own')
const shared = () => path.join(root, 'shared')

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'foundry-env-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readEnvFiles', () => {
  test('merges the keys of both files', async () => {
    await writeFile(own(), 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-x\nFOUNDRY_MCP_TOKEN=gw\n')
    await writeFile(shared(), 'SLACK_TOKEN=xoxp-x\nLINEAR_API_KEY=lin\n\n# comment\nnot a key\n')
    expect(await readEnvFiles(own(), shared())).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-x',
      FOUNDRY_MCP_TOKEN: 'gw',
      SLACK_TOKEN: 'xoxp-x',
      LINEAR_API_KEY: 'lin',
    })
  })

  test('a key in both files resolves to the shared value', async () => {
    await writeFile(own(), 'FOUNDRY_API_TOKEN=old\n')
    await writeFile(shared(), 'FOUNDRY_API_TOKEN=new\n')
    expect((await readEnvFiles(own(), shared())).FOUNDRY_API_TOKEN).toBe('new')
  })

  test('a missing file contributes nothing and is not an error', async () => {
    await writeFile(own(), 'FOUNDRY_MCP_TOKEN=gw\n')
    expect(await readEnvFiles(own(), path.join(root, 'absent'))).toEqual({ FOUNDRY_MCP_TOKEN: 'gw' })
    expect(await readEnvFiles(path.join(root, 'absent'), shared())).toEqual({ FOUNDRY_API_TOKEN: 'new' })
    expect(await readEnvFiles(path.join(root, 'absent'), path.join(root, 'absent2'))).toEqual({})
  })
})
