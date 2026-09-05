/**
 * Node-only. The OpenAPI 3.1 document for Foundry's HTTP surface, served at
 * `GET /api/openapi.json` and rendered by Scalar at `GET /api/reference`.
 *
 * Split on purpose (LIA-90): the *paths* are written by hand here, because
 * routes change rarely and visibly; the *schemas* are generated from the zod
 * objects the handlers parse with (job-api.ts, job-events.ts), because field
 * shapes change often and silently. A field the parser rejects can therefore
 * never appear in the spec, and openapi.test.ts holds the path list against
 * the files under routes/api/.
 */
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import {
  ConflictSchema,
  ErrorSchema,
  JobDetailSchema,
  JobSchema,
  TriggerPayloadSchema,
} from './job-api'
import { EventPayloadSchema } from './job-events'
import { EVENT_HEADER, SETTLED_EVENT, SIGNATURE_HEADER } from './job-webhook'

/** The completion webhook's body — `{ event, job }`, as job-webhook.ts sends it. */
const SettledEventSchema = z
  .object({ event: z.literal(SETTLED_EVENT), job: JobSchema })
  .describe('POSTed once to `callbackUrl` when the job leaves the open set — succeeded, failed or cancelled.')

/** The `200` from the forge's events route. */
const AckSchema = z.object({ ok: z.literal(true) })

/**
 * A component schema: zod's 2020-12 output minus the per-document `$schema`
 * key, which OpenAPI 3.1 carries once at the top level as `jsonSchemaDialect`.
 * Request bodies are described by their *input* shape (what the caller sends,
 * before trims and defaults); responses by their *output* shape.
 */
function component(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' })
  return rest
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const jsonBody = (name: string, description?: string) => ({
  ...(description ? { description } : {}),
  required: true,
  content: { 'application/json': { schema: ref(name) } },
})
const jsonResponse = (description: string, name: string) => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
})

const errorResponses = {
  unauthorized: jsonResponse('Missing or wrong bearer token.', 'Error'),
  notConfigured: jsonResponse('The trigger API has no token configured — `foundry auth --api` on the host.', 'Error'),
}

/** The install version, from the root package.json release-please bumps; the spec version tracks it. */
async function installVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(new URL('../../../../../package.json', import.meta.url), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function openapiDocument(): Promise<Record<string, unknown>> {
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'Foundry trigger API',
      version: await installVersion(),
      summary: 'Queue a job on a tracked repo, follow it to a PR, or be told when it settles.',
      description: [
        'Anything that can make an HTTP request — CI, a Slack bot, another agent, a shell script — can queue a job here with the instructions in the body.',
        'Everything after the insert is the same pipeline the ignite dialog uses: blueprints, repo notes, branch naming, push and PR.',
        '',
        '**Auth.** One install-wide bearer token, `FOUNDRY_API_TOKEN` in `~/.config/liamai/env`, minted by `foundry auth --api` (`--rotate` replaces it).',
        'With none configured the API answers `503` rather than opening up: the dev server listens on the LAN, and a job runs Claude against your repos and pushes with your credentials.',
        '',
        '**Errors** are `{ error }` with a message written for the caller.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'The Foundry web server this document was fetched from.' }],
    tags: [
      { name: 'jobs', description: 'Trigger and follow jobs.' },
      {
        name: 'internal',
        description: 'Served on the same origin, but for the forge container only: the per-job token is minted by the runner and never leaves the job.',
      },
    ],
    paths: {
      '/api/jobs': {
        post: {
          operationId: 'triggerJob',
          tags: ['jobs'],
          summary: 'Queue a job',
          description: [
            'Inserts the queued row and returns it; the runner\'s cap and queue pump take it from there.',
            'Lead `instructions` with a one-line summary — the first line is the fallback commit subject and PR title, and its first three words name the branch.',
            'A leading `LIA-123:` also gets the PR linked to the ticket on Bitbucket origins.',
          ].join(' '),
          security: [{ installToken: [] }],
          requestBody: jsonBody('TriggerPayload'),
          responses: {
            '202': jsonResponse('Queued. The job as soon as its row exists — poll `GET /api/jobs/{id}` or wait for the callback.', 'Job'),
            '400': jsonResponse('Malformed JSON, a field the schema rejects, an untracked or ambiguous `repo`, or an unknown `blueprintId`.', 'Error'),
            '401': errorResponses.unauthorized,
            '409': jsonResponse('`ticketId` already has a job. The holder is named when it still exists.', 'Conflict'),
            '503': errorResponses.notConfigured,
          },
          callbacks: {
            jobSettled: {
              '{$request.body#/callbackUrl}': {
                post: {
                  operationId: 'jobSettled',
                  summary: 'The job settled',
                  description: [
                    'Sent once when the job leaves the open set — succeeded, failed or cancelled, whichever path settled it.',
                    'Signed, not authenticated: the body carries an HMAC-SHA256 under the same install token the caller used to reach Foundry, so the receiver verifies with a secret it already holds.',
                    'Best effort — three attempts, 1s then 5s apart, 10s each; a dead receiver costs an `err` line in the job\'s log, never its status.',
                  ].join(' '),
                  parameters: [
                    {
                      name: EVENT_HEADER,
                      in: 'header',
                      required: true,
                      description: 'The event name.',
                      schema: { type: 'string', enum: [SETTLED_EVENT] },
                    },
                    {
                      name: SIGNATURE_HEADER,
                      in: 'header',
                      required: false,
                      description:
                        '`sha256=<hex>` — HMAC-SHA256 of the raw body keyed with `FOUNDRY_API_TOKEN`. Absent only when the host has no token configured, in which case the job\'s log says so.',
                      schema: { type: 'string', pattern: '^sha256=[0-9a-f]{64}$' },
                    },
                  ],
                  requestBody: jsonBody('SettledEvent'),
                  responses: {
                    '2XX': { description: 'Acknowledged. Any 2xx counts as delivered; anything else is retried.' },
                  },
                },
              },
            },
          },
        },
      },
      '/api/jobs/{id}': {
        get: {
          operationId: 'getJob',
          tags: ['jobs'],
          summary: 'Fetch a job',
          description: 'The job — status, step, branch, `prUrl`, `exitCode`, `diff` — and, with `?logs=1`, its log lines.',
          security: [{ installToken: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, description: 'The job id, as returned by `POST /api/jobs`.', schema: { type: 'string', format: 'uuid' } },
            {
              name: 'logs',
              in: 'query',
              required: false,
              description: '`1` to include the log lines (`JobDetail`); anything else, or absent, returns the bare `Job`.',
              schema: { type: 'string', enum: ['1'] },
            },
          ],
          responses: {
            '200': {
              description: 'The job. `JobDetail` when `logs=1`, otherwise `Job`.',
              content: { 'application/json': { schema: { oneOf: [ref('Job'), ref('JobDetail')] } } },
            },
            '401': errorResponses.unauthorized,
            '404': jsonResponse('No such job — including ids that are not uuids.', 'Error'),
            '503': errorResponses.notConfigured,
          },
        },
      },
      '/api/jobs/{id}/events': {
        post: {
          operationId: 'reportJobEvent',
          tags: ['internal'],
          summary: 'Report log lines and step transitions (forge container only)',
          description: [
            'The forge container\'s callback. Log lines are appended to the job\'s log; `step: "commit"` with an `outcome` hands the pipeline back to the host, which pushes and opens the PR.',
            'Authenticated with the per-job token the runner mints, not the install token.',
          ].join(' '),
          security: [{ jobToken: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody('EventPayload'),
          responses: {
            '200': jsonResponse('Recorded.', 'Ack'),
            '400': jsonResponse('Malformed JSON or a body the schema rejects.', 'Error'),
            '401': jsonResponse('No such job or wrong token — one answer for both, so ids are not confirmed to exist.', 'Error'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        installToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'The install-wide `FOUNDRY_API_TOKEN`, minted by `foundry auth --api`.',
        },
        jobToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'The per-job token the runner hands the forge container. Internal.',
        },
      },
      schemas: {
        TriggerPayload: component(TriggerPayloadSchema, 'input'),
        Job: component(JobSchema, 'output'),
        JobDetail: component(JobDetailSchema, 'output'),
        Error: component(ErrorSchema, 'output'),
        Conflict: component(ConflictSchema, 'output'),
        SettledEvent: component(SettledEventSchema, 'output'),
        EventPayload: component(EventPayloadSchema, 'input'),
        Ack: component(AckSchema, 'output'),
      },
    },
  }
}
