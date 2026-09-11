import { createFileRoute } from '@tanstack/react-router'

/**
 * The trigger API: `POST /api/jobs` with the instructions in the body queues
 * a job on the same pipeline the ignite dialog uses. Thin on
 * purpose — features/jobs/server/job-api.ts owns auth, validation and the
 * insert, imported inside the handler so node-only code stays out of the
 * client bundle.
 */
export const Route = createFileRoute('/api/jobs')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleTriggerJob } = await import('@/features/jobs/server/job-api')
        return handleTriggerJob(request)
      },
    },
  },
})
