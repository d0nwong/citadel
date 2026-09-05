import { createFileRoute } from '@tanstack/react-router'

/**
 * `GET /api/openapi.json` — the OpenAPI 3.1 document for the trigger API.
 * Unauthenticated on purpose: it reveals shape, not data. Thin like the other
 * api routes — features/jobs/server/openapi.ts builds it, imported inside the
 * handler so node-only code stays out of the client bundle.
 */
export const Route = createFileRoute('/api/openapi.json')({
  server: {
    handlers: {
      GET: async () => {
        const { openapiDocument } = await import('@/features/jobs/server/openapi')
        return Response.json(await openapiDocument())
      },
    },
  },
})
