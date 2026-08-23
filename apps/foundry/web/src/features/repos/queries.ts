import { queryOptions } from '@tanstack/react-query'
import { listRepos } from './api'

export const repoQueries = {
  all: ['repos'] as const,
  list: () => queryOptions({ queryKey: [...repoQueries.all], queryFn: listRepos }),
}
