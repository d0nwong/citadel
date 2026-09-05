import { createFileRoute } from '@tanstack/react-router'

/** Pinned so the page cannot change under a reader; bump by hand. */
const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.67.0'

/**
 * `GET /api/reference` — the trigger API's reference page. Scalar reads
 * `/api/openapi.json` from the same origin and renders it client-side, so this
 * is a static HTML response with no React and no auth (like the document).
 */
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Foundry trigger API</title>
    <link rel="icon" href="data:," />
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="${SCALAR_SCRIPT}"></script>
  </body>
</html>
`

export const Route = createFileRoute('/api/reference')({
  server: {
    handlers: {
      GET: () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    },
  },
})
