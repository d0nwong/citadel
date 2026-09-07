import { createFileRoute } from '@tanstack/react-router'

/**
 * `GET /api/repos` — the tracked repos, the set `POST /api/jobs` accepts as
 * `repo`. Thin like the other api routes — features/jobs/server/job-api.ts
 * owns auth and the read, imported inside the handler so node-only code stays
 * out of the client bundle.
 */
export const Route = createFileRoute('/api/repos')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleListRepos } = await import('@/features/jobs/server/job-api')
        return handleListRepos(request)
      },
    },
  },
})
