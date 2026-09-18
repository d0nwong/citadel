import { createFileRoute } from '@tanstack/react-router'

/**
 * `GET /api/blueprints` — the blueprints a job may run, the set `POST /api/jobs`
 * accepts as `blueprintId`. Thin like the other api routes — features/jobs/server/job-api.ts
 * owns auth and the read, imported inside the handler so node-only code stays
 * out of the client bundle.
 */
export const Route = createFileRoute('/api/blueprints')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleListBlueprints } = await import('@/features/jobs/server/job-api')
        return handleListBlueprints(request)
      },
    },
  },
})
