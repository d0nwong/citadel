import { REPOS, clone, latency } from '@/mocks/foundry-store'
import type { Repo } from './types'

export async function listRepos(): Promise<Array<Repo>> {
  await latency(30)
  return clone(REPOS)
}
