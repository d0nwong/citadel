import { ADAPTERS, FORGES, clone, latency } from '@/mocks/foundry-store'
import type { AdapterInfo, Forge } from './types'

export async function listForges(): Promise<Array<Forge>> {
  await latency(30)
  return clone(FORGES)
}

export async function listAdapters(): Promise<Array<AdapterInfo>> {
  await latency(20)
  return clone(ADAPTERS)
}
