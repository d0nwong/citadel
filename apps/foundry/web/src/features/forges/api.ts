import { FORGES, clone, latency } from '@/mocks/foundry-store'
import type { Forge } from './types'

export async function listForges(): Promise<Array<Forge>> {
  await latency(30)
  return clone(FORGES)
}
