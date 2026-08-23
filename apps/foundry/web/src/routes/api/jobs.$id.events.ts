import { createFileRoute } from '@tanstack/react-router'

/**
 * The forge container's callback: log lines and step transitions, POSTed with
 * the job's Bearer token. Thin on purpose — everything real happens in
 * features/jobs/server/job-events.ts, imported inside the handler so node-only
 * code stays out of the client bundle.
 */
export const Route = createFileRoute('/api/jobs/$id/events')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { handleJobEvent } = await import('@/features/jobs/server/job-events')
        return handleJobEvent(params.id, request)
      },
    },
  },
})
