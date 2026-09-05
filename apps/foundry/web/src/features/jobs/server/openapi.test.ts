/**
 * The published document against three things it must agree with: the
 * OpenAPI 3.1 schema, the route files under routes/api/, and the parser the
 * handlers use (LIA-90). No database — the document is built from code.
 */
import { expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Validator } from '@seriousme/openapi-schema-validator'
import { TriggerPayloadSchema } from './job-api'
import { EventPayloadSchema } from './job-events'
import { EVENT_HEADER, SETTLED_EVENT, SIGNATURE_HEADER } from './job-webhook'
import { openapiDocument } from './openapi'

const ROUTES_DIR = path.resolve(import.meta.dir, '../../../routes/api')

/** The two routes that publish the document are not part of the API it describes. */
const NOT_DOCUMENTED = new Set(['/api/openapi.json', '/api/reference'])

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/**
 * `jobs.$id.events.ts` → `/api/jobs/{id}/events`, the way the router
 * generator reads a file name: `.` splits segments except inside `[]`, which
 * is an escaped literal; `$name` is a param.
 */
function routePath(file: string): string {
  const segments = file
    .replace(/\.tsx?$/, '')
    .split(/(?<!\[)\.(?!\])/)
    .map((s) => s.replace(/\[(.*?)\]/g, '$1'))
    .map((s) => (s.startsWith('$') ? `{${s.slice(1)}}` : s))
  return `/api/${segments.join('/')}`
}

/** The handler methods a route file declares — `handlers: { GET: …, POST: … }`. */
async function routeMethods(file: string): Promise<Array<string>> {
  const src = await readFile(path.join(ROUTES_DIR, file), 'utf8')
  const block = /handlers:\s*\{([\s\S]*?)\n\s*\}/.exec(src)?.[1] ?? ''
  return [...block.matchAll(/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS):/gm)].map((m) => m[1]!.toLowerCase())
}

type Doc = Awaited<ReturnType<typeof openapiDocument>>
type Paths = Record<string, Record<string, Record<string, unknown>>>
const paths = (doc: Doc) => doc.paths as Paths
const schemas = (doc: Doc) => (doc.components as { schemas: Record<string, Record<string, unknown>> }).schemas

test('AC1 — an OpenAPI 3.1 document that validates with no errors', async () => {
  const doc = await openapiDocument()
  expect(doc.openapi).toMatch(/^3\.1\./)
  const result = await new Validator().validate(doc)
  expect(result.errors).toBeUndefined()
  expect(result.valid).toBe(true)
})

test('AC2/AC6 — every route file has a path and method in the document, and nothing else does', async () => {
  const doc = await openapiDocument()
  const files = (await readdir(ROUTES_DIR)).filter((f) => /\.tsx?$/.test(f))
  const expected = new Map<string, Array<string>>()
  for (const file of files) {
    const p = routePath(file)
    if (NOT_DOCUMENTED.has(p)) continue
    expected.set(p, await routeMethods(file))
  }

  // Both directions: a route without a spec entry fails here, and so does a
  // spec path whose file was removed or renamed.
  expect([...expected.keys()].sort()).toEqual(Object.keys(paths(doc)).sort())

  for (const [p, methods] of expected) {
    expect(methods.length).toBeGreaterThan(0)
    const documented = Object.keys(paths(doc)[p]!).filter((k) => (HTTP_METHODS as ReadonlyArray<string>).includes(k))
    expect(documented.sort()).toEqual(methods.sort())
  }
})

test('AC3 — POST /api/jobs documents the body, every status, and the job.settled callback', async () => {
  const doc = await openapiDocument()
  const create = paths(doc)['/api/jobs']!.post as {
    requestBody: { content: Record<string, { schema: { $ref: string } }> }
    responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>
    callbacks: Record<string, Record<string, { post: Record<string, unknown> }>>
    security: Array<Record<string, unknown>>
  }
  expect(create.requestBody.content['application/json']!.schema.$ref).toBe('#/components/schemas/TriggerPayload')
  expect(Object.keys(create.responses).sort()).toEqual(['202', '400', '401', '409', '503'])
  expect(create.responses['202']!.content!['application/json']!.schema.$ref).toBe('#/components/schemas/Job')
  for (const status of ['400', '401', '503']) {
    expect(create.responses[status]!.content!['application/json']!.schema.$ref).toBe('#/components/schemas/Error')
  }
  expect(create.responses['409']!.content!['application/json']!.schema.$ref).toBe('#/components/schemas/Conflict')
  expect(create.security).toEqual([{ installToken: [] }])

  // The callback lives on the operation, keyed by the body field that names the receiver.
  const [expr, callback] = Object.entries(create.callbacks.jobSettled!)[0]!
  expect(expr).toBe('{$request.body#/callbackUrl}')
  const post = callback.post as {
    parameters: Array<{ name: string; in: string; schema: Record<string, unknown> }>
    requestBody: { content: Record<string, { schema: { $ref: string } }> }
  }
  const headers = Object.fromEntries(post.parameters.filter((p) => p.in === 'header').map((p) => [p.name, p.schema]))
  expect(headers[EVENT_HEADER]).toEqual({ type: 'string', enum: [SETTLED_EVENT] })
  expect(headers[SIGNATURE_HEADER]).toMatchObject({ type: 'string', pattern: expect.stringContaining('sha256=') })
  expect(post.requestBody.content['application/json']!.schema.$ref).toBe('#/components/schemas/SettledEvent')
  expect(schemas(doc).SettledEvent).toMatchObject({
    required: ['event', 'job'],
    properties: { event: { const: SETTLED_EVENT }, job: { properties: { id: expect.anything(), status: expect.anything() } } },
  })
})

test('AC4 — what the document marks invalid, the parser rejects with the same reason', async () => {
  const doc = await openapiDocument()
  const payload = schemas(doc).TriggerPayload as {
    required: Array<string>
    properties: Record<string, { anyOf?: Array<{ maxLength?: number }>; format?: string }>
  }

  expect(payload.required).toEqual(['repo', 'instructions'])
  expect(TriggerPayloadSchema.safeParse({ instructions: 'x' }).error?.issues[0]?.message).toMatch(/^repo is required/)
  expect(TriggerPayloadSchema.safeParse({ repo: 'x' }).error?.issues[0]?.message).toMatch(/^instructions is required/)

  expect(payload.properties.ticketId!.anyOf?.some((s) => s.maxLength === 64)).toBe(true)
  expect(TriggerPayloadSchema.safeParse({ repo: 'x', instructions: 'y', ticketId: 'a'.repeat(65) }).error?.issues[0]?.message).toBe(
    'ticketId is too long',
  )

  expect(payload.properties.callbackUrl!.format).toBe('uri')
  expect(TriggerPayloadSchema.safeParse({ repo: 'x', instructions: 'y', callbackUrl: 'ftp://x' }).error?.issues[0]?.message).toBe(
    'callbackUrl must be http or https',
  )

  // The document is built from the very objects the handlers parse with, so
  // a caller-visible shape the parser accepts is always in the document.
  expect(Object.keys(payload.properties).sort()).toEqual(Object.keys(TriggerPayloadSchema.shape).sort())
  expect(Object.keys((schemas(doc).EventPayload as { properties: object }).properties).sort()).toEqual(
    Object.keys(EventPayloadSchema.shape).sort(),
  )
})

test('the events route accepts exactly what image/forge-run.sh sends', () => {
  const cases = [
    { sys: ['agent starting — 1 step(s), timeout 1800s'] },
    { ndjson: ['{"type":"system","subtype":"init"}'], step: { index: 1, name: 'plan' } },
    { stderr: ['boom'] },
    { step: 'commit', outcome: 'committed', exitCode: 0 },
    { step: 'commit', outcome: 'no-changes', exitCode: 1 },
  ]
  for (const body of cases) expect(EventPayloadSchema.safeParse(body).success).toBe(true)
  expect(EventPayloadSchema.safeParse({ step: 'commit', outcome: 'exploded' }).success).toBe(false)
  expect(EventPayloadSchema.safeParse({ sys: 'not an array' }).success).toBe(false)
})
