import { queryOptions } from '@tanstack/react-query'
import { listBlueprints } from './api'

export const blueprintQueries = {
  all: ['blueprints'] as const,
  list: () => queryOptions({ queryKey: [...blueprintQueries.all], queryFn: () => listBlueprints(), staleTime: 30_000 }),
}
