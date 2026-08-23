import { queryOptions } from '@tanstack/react-query'
import { discoverRepos, listRepos, listScanRoots } from './api'

/** Scanning the filesystem is not free, so these are not on a refetch interval. */
export const repoQueries = {
  all: ['repos'] as const,
  list: () => queryOptions({ queryKey: [...repoQueries.all], queryFn: () => listRepos(), staleTime: 30_000 }),
  discovered: () =>
    queryOptions({ queryKey: [...repoQueries.all, 'discovered'], queryFn: () => discoverRepos(), staleTime: 15_000 }),
  scanRoots: () =>
    queryOptions({ queryKey: [...repoQueries.all, 'roots'], queryFn: () => listScanRoots(), staleTime: Infinity }),
}
