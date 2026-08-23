import { queryOptions } from '@tanstack/react-query'
import { getJob, listJobs } from './api'

export const jobQueries = {
  all: ['jobs'] as const,
  list: () =>
    queryOptions({
      queryKey: [...jobQueries.all],
      queryFn: () => listJobs(),
      refetchInterval: 1000,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...jobQueries.all, id],
      queryFn: () => getJob({ data: id }),
      refetchInterval: 1000,
    }),
}
