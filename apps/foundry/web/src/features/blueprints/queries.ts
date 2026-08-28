import { queryOptions } from '@tanstack/react-query'
import { listBlueprints, listRevisions } from './api'

export const blueprintQueries = {
  all: ['blueprints'] as const,
  list: () => queryOptions({ queryKey: [...blueprintQueries.all], queryFn: () => listBlueprints(), staleTime: 30_000 }),
  /**
   * History is append-only, so it only ever changes when this client saves —
   * which invalidates `all` anyway. No polling, and `enabled` keeps it off
   * until the editor is actually open on an existing blueprint.
   */
  revisions: (id: string | undefined) =>
    queryOptions({
      queryKey: [...blueprintQueries.all, 'revisions', id],
      queryFn: () => listRevisions({ data: id! }),
      enabled: id !== undefined,
      staleTime: 30_000,
    }),
}
