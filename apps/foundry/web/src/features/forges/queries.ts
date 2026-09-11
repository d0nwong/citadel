import { queryOptions } from '@tanstack/react-query'
import { listAdapters, listForges } from './api'

export const forgeQueries = {
  all: ['forges'] as const,
  list: () =>
    queryOptions({
      queryKey: [...forgeQueries.all],
      queryFn: () => listForges(),
      refetchInterval: 2000,
    }),
  adapters: () =>
    queryOptions({
      queryKey: [...forgeQueries.all, 'adapters'],
      queryFn: () => listAdapters(),
    }),
}
