import { createServerFn } from '@tanstack/react-start'
import type { Blueprint, BlueprintInput } from './types'

/** Blueprints live in Postgres; the node-only store is imported inside each handler. */

export const listBlueprints = createServerFn({ method: 'GET' }).handler(async (): Promise<Array<Blueprint>> => {
  const store = await import('./server/blueprint-store')
  return store.listBlueprints()
})

export const createBlueprint = createServerFn({ method: 'POST' })
  .validator((input: BlueprintInput) => input)
  .handler(async ({ data }): Promise<Blueprint> => {
    const store = await import('./server/blueprint-store')
    return store.createBlueprint(data)
  })

export const updateBlueprint = createServerFn({ method: 'POST' })
  .validator((input: { id: string } & BlueprintInput) => input)
  .handler(async ({ data }): Promise<Blueprint> => {
    const store = await import('./server/blueprint-store')
    const { id, ...rest } = data
    return store.updateBlueprint(id, rest)
  })

export const deleteBlueprint = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    const store = await import('./server/blueprint-store')
    await store.deleteBlueprint(data)
  })
