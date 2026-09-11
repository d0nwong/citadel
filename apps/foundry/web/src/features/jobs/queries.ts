import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { countJobs, getJob, listJobs } from './api'
import type { JobCursor, JobStatus } from './types'

const PAGE_SIZE = 50

export const jobQueries = {
  all: ['jobs'] as const,
  list: (status?: JobStatus) =>
    infiniteQueryOptions({
      queryKey: [...jobQueries.all, 'list', status ?? 'all'],
      queryFn: ({ pageParam }: { pageParam: JobCursor | null }) =>
        listJobs({ data: { cursor: pageParam ?? undefined, limit: PAGE_SIZE, status } }),
      initialPageParam: null as JobCursor | null,
      getNextPageParam: (last: Awaited<ReturnType<typeof listJobs>>) => last.nextCursor,
      refetchInterval: 1000,
    }),
  counts: () =>
    queryOptions({
      queryKey: [...jobQueries.all, 'counts'],
      queryFn: () => countJobs(),
      refetchInterval: 1000,
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...jobQueries.all, id],
      queryFn: () => getJob({ data: id }),
      refetchInterval: 1000,
    }),
}
