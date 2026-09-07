import { createServerFn } from '@tanstack/react-start'
import type { AdapterInfo, Forge } from './types'

/**
 * Real data — the forge inventory comes from docker labels. The node-only
 * scan module is imported inside each handler so it never reaches the client
 * bundle, same as jobs and repos.
 */

export const listForges = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<Forge>> => {
  const { listForges: scan } = await import('./server/forge-scan')
  return scan()
})

export const listAdapters = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<AdapterInfo>> => {
  const { listAdapters: scan } = await import('./server/forge-scan')
  return scan()
})
