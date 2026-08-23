import { queryOptions } from '@tanstack/react-query'
import { listForges } from './api'

export const forgeQueries = {
  all: ['forges'] as const,
  list: () =>
    queryOptions({
      queryKey: [...forgeQueries.all],
      queryFn: listForges,
      refetchInterval: 2000,
    }),
}
