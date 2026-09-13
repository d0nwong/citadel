/**
 * A clean settle removes the job's directory; a failed one, or any settle with
 * FOUNDRY_KEEP_WORKSPACES=1, leaves the clone on disk and says where it is.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanupWorkspace } from './workspace-cleanup'

let jobsDir = ''

beforeAll(async () => {
  jobsDir = await mkdtemp(path.join(tmpdir(), 'foundry-jobs-'))
})
afterAll(async () => {
  await rm(jobsDir, { recursive: true, force: true })
})

async function run(id: string, status: 'succeeded' | 'failed', keep = false) {
  await mkdir(path.join(jobsDir, id, 'work'), { recursive: true })
  const lines: Array<string> = []
  await cleanupWorkspace(id, status, { jobsDir, keep, log: async (stream, text) => void lines.push(`${stream}: ${text}`) })
  return lines
}

test('a succeeded job loses its whole directory', async () => {
  expect(await run('ok', 'succeeded')).toEqual(['sys: workspace removed'])
  expect(existsSync(path.join(jobsDir, 'ok'))).toBe(false)
})

test('a failed job keeps its workspace and names the path', async () => {
  expect(await run('bad', 'failed')).toEqual([`sys: workspace kept for inspection: ${path.join(jobsDir, 'bad', 'work')}`])
  expect(existsSync(path.join(jobsDir, 'bad', 'work'))).toBe(true)
})

test('FOUNDRY_KEEP_WORKSPACES keeps a succeeded job too', async () => {
  const lines = await run('kept', 'succeeded', true)
  expect(lines[0]).toStartWith('sys: workspace kept (FOUNDRY_KEEP_WORKSPACES=1)')
  expect(existsSync(path.join(jobsDir, 'kept', 'work'))).toBe(true)
})
