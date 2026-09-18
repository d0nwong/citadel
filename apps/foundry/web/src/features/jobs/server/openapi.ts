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
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_MAX,
  JobDetailSchema,
  JobSchema,
  TrackedRepoSchema,
  TriggerPayloadSchema,
} from './job-api'
import { EventPayloadSchema } from './job-events'
import { EVENT_HEADER, PR_CLOSED_EVENT, SETTLED_EVENT, SIGNATURE_HEADER } from './job-webhook'

/** The completion webhook's body — `{ event, job }`, as job-webhook.ts sends it. */
const SettledEventSchema = z
  .object({ event: z.literal(SETTLED_EVENT), job: JobSchema })
  .describe('POSTed once to `callbackUrl` when the job leaves the open set — succeeded, failed, cancelled or pr_ready.')

/** The watcher's later move of a `pr_ready` job (S-46) — `{ event, job, prState }`, as job-webhook.ts sends it. */
const PrClosedEventSchema = z
  .object({ event: z.literal(PR_CLOSED_EVENT), job: JobSchema, prState: z.enum(['merged', 'closed']) })
  .describe('POSTed once a `pr_ready` job\'s PR merges or closes: `job` carries the status the job moved to (`succeeded` or `cancelled`), `prState` the PR\'s own outcome.')

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

/**
 * `instructions` or `ticketId`: a check on the zod object, which the JSON
 * Schema generator cannot see — so the either-or is added here, as the two
 * `required` lists the parser would accept.
 */
const TriggerPayloadComponent = {
  ...component(TriggerPayloadSchema, 'input'),
  anyOf: [{ required: ['instructions'] }, { required: ['ticketId'] }],
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
        '`GET /api/repos` lists what a job may target — every `name` it returns is accepted verbatim as `repo`.',
        '',
        '**Auth.** One install-wide bearer token, `FOUNDRY_API_TOKEN` in the repo root `.env`, minted by `foundry auth --api` (`--rotate` replaces it).',
        'With none configured the API answers `503` rather than opening up: the dev server listens on the LAN, and a job runs Claude against your repos and pushes with your credentials.',
        '',
        '**Errors** are `{ error }` with a message written for the caller.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'The Foundry web server this document was fetched from.' }],
    tags: [
      { name: 'jobs', description: 'Trigger and follow jobs.' },
      { name: 'repos', description: 'What a job may target — the curated set the Repos page maintains.' },
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
            'Or send a `ticketId` alone: the host fetches the Linear issue with its own key, composes the brief from it (`<KEY>: <title>`, the URL, the description), and once the row exists assigns the issue to that key\'s user and moves it to In Progress — the row first, then Linear, then ignition, and a Linear write that fails is an `err` line in the job\'s log, never a status change.',
            'Foundry never judges whether the ticket is ready; the caller decided that by sending it.',
            `Send an \`${IDEMPOTENCY_HEADER}\` to make the call safe to retry: a replay with the same key and body answers \`200\` with the job made the first time and queues nothing.`,
          ].join(' '),
          security: [{ installToken: [] }],
          parameters: [
            {
              name: IDEMPOTENCY_HEADER,
              in: 'header',
              required: false,
              description: [
                'A caller-chosen key, unique per intent (a retrying client keeps the key; a cockpit uses the id of the thing being sent).',
                'The same key with the same body is a replay: `200` with the existing job, nothing new queued. The same key with a different body is `422`.',
                'Bodies are compared as the raw bytes sent, so the same JSON serialised differently counts as different.',
                'A cancelled job releases its key — the next call with it queues a new job rather than replaying or refusing.',
              ].join(' '),
              schema: { type: 'string', minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX },
            },
          ],
          requestBody: jsonBody('TriggerPayload'),
          responses: {
            '200': jsonResponse(
              `Replayed. \`${IDEMPOTENCY_HEADER}\` already made this job, and the body is the one it was made with — its current state, as \`GET /api/jobs/{id}\` returns it. Nothing new was queued.`,
              'Job',
            ),
            '202': jsonResponse('Queued. The job as soon as its row exists — poll `GET /api/jobs/{id}` or wait for the callback.', 'Job'),
            '400': jsonResponse(
              `Malformed JSON, a field the schema rejects, neither \`instructions\` nor \`ticketId\`, an untracked or ambiguous \`repo\`, an unknown \`blueprintId\`, a \`ticketId\` Linear does not know, or an \`${IDEMPOTENCY_HEADER}\` that is empty or longer than ${IDEMPOTENCY_KEY_MAX} characters. Nothing was queued.`,
              'Error',
            ),
            '401': errorResponses.unauthorized,
            '409': jsonResponse('`ticketId` already has a job that still holds the claim, under a different (or no) idempotency key. A cancelled job does not hold it — the ticket can be triggered again. The holder is named when it still exists.', 'Conflict'),
            '422': jsonResponse(`\`${IDEMPOTENCY_HEADER}\` was already used with a different body. Nothing was queued.`, 'Error'),
            '502': jsonResponse('Linear could not be reached to fetch the `ticketId` before the insert. Nothing was queued; retry with the same idempotency key.', 'Error'),
            '503': jsonResponse(
              'Not configured on the host: no trigger API token (`foundry auth --api`), or — for a `ticketId` without `instructions` — no Linear key to compose the brief with (`LINEAR_API_KEY` in the argus `.env`). With `instructions` present, a missing Linear key only costs the claim, logged as an `err` line on the job.',
              'Error',
            ),
          },
          callbacks: {
            jobSettled: {
              '{$request.body#/callbackUrl}': {
                post: {
                  operationId: 'jobSettled',
                  summary: 'The job settled',
                  description: [
                    'Sent once when the job leaves the open set — succeeded, failed, cancelled or pr_ready, whichever path settled it.',
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
            jobPrClosed: {
              '{$request.body#/callbackUrl}': {
                post: {
                  operationId: 'jobPrClosed',
                  summary: 'The job\'s PR merged or closed',
                  description: [
                    'Sent once a `pr_ready` job\'s PR merges or closes: the watcher moves the job to `succeeded` (merged) or `cancelled` (closed) and this is the second event a sender sees for that job — `job.settled` stays one per job.',
                    'Signed and retried exactly as `job.settled` is; a failed delivery never changes the job.',
                  ].join(' '),
                  parameters: [
                    {
                      name: EVENT_HEADER,
                      in: 'header',
                      required: true,
                      description: 'The event name.',
                      schema: { type: 'string', enum: [PR_CLOSED_EVENT] },
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
                  requestBody: jsonBody('PrClosedEvent'),
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
      '/api/repos': {
        get: {
          operationId: 'listRepos',
          tags: ['repos'],
          summary: 'List the tracked repos',
          description: [
            'The repos a job may target, ordered by `name` — the same set `POST /api/jobs` resolves `repo` against, so every `name` here is accepted verbatim (a `path` always is; a `name` is, when no other tracked repo shares it).',
            'Nothing live and nothing of the host\'s: no checked-out branch, dirty flag, default branch, row id or notes.',
            'Read-only — repos are added and removed on the Repos page.',
          ].join(' '),
          security: [{ installToken: [] }],
          responses: {
            '200': {
              description: 'The tracked repos, ordered by `name`. `[]` when none are tracked.',
              content: { 'application/json': { schema: { type: 'array', items: ref('TrackedRepo') } } },
            },
            '401': errorResponses.unauthorized,
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
        TriggerPayload: TriggerPayloadComponent,
        Job: component(JobSchema, 'output'),
        JobDetail: component(JobDetailSchema, 'output'),
        Error: component(ErrorSchema, 'output'),
        Conflict: component(ConflictSchema, 'output'),
        TrackedRepo: component(TrackedRepoSchema, 'output'),
        SettledEvent: component(SettledEventSchema, 'output'),
        PrClosedEvent: component(PrClosedEventSchema, 'output'),
        EventPayload: component(EventPayloadSchema, 'input'),
        Ack: component(AckSchema, 'output'),
      },
    },
  }
}
