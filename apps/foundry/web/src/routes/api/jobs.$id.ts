import { createFileRoute } from '@tanstack/react-router'

/** `GET /api/jobs/:id` — poll a job triggered over the API; `?logs=1` adds its log. */
export const Route = createFileRoute('/api/jobs/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { handleGetJob } = await import('@/features/jobs/server/job-api')
        return handleGetJob(params.id, request)
      },
    },
  },
})
