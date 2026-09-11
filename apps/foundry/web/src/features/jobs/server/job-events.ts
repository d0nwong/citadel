/**
 * Node-only. The receiving end of the container's callbacks: authenticate the
 * per-job token, translate Claude's stream-json NDJSON into the job's JSONL
 * log, and hand the pipeline back to the host when the container reports commit.
 *
 * The runner ships lines raw and unparsed on purpose — this file is where the
 * mapping lives, in one typed, testable place, instead of in bash.
 */
import { z } from 'zod'
import { tokenMatches } from './auth'
import { appendLogs } from './job-logs'
import * as store from './job-store'
import type { LogStream } from '../types'

/**
 * What image/forge-run.sh POSTs. A zod schema rather than an interface so the
 * same object feeds the published OpenAPI document (openapi.ts) — the runner
 * is the only caller, but the route is served on the public origin and is
 * documented as internal there. Unknown keys are stripped, not rejected.
 */
export const EventPayloadSchema = z.object({
  step: z
    .union([
      z.literal('agent'),
      z.literal('commit'),
      z.object({ index: z.number().int().positive(), name: z.string() }).describe('Labels a blueprint step\'s lines with its name.'),
    ])
    .optional()
    .describe("'commit' hands the pipeline back to the host. The object form labels a blueprint step's lines — a plain job never sends it."),
  ndjson: z.array(z.string()).optional().describe('Raw stream-json lines from `claude -p --output-format stream-json`.'),
  stderr: z.array(z.string()).optional(),
  sys: z.array(z.string()).optional().describe("The runner's own progress lines."),
  outcome: z.enum(['committed', 'no-changes']).optional().describe('Sent with `step: "commit"`.'),
  exitCode: z.number().int().nonnegative().optional().describe("The agent's exit code, sent with `step: \"commit\"`."),
})

export type EventPayload = z.output<typeof EventPayloadSchema>

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export async function handleJobEvent(jobId: string, request: Request): Promise<Response> {
  const job = await store.getJobRow(jobId)
  if (!job || !tokenMatches(job.token, request.headers.get('authorization'))) {
    // One answer for "no such job" and "bad token": don't confirm ids exist.
    return json(401, { error: 'unauthorized' })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid json' })
  }
  const parsed = EventPayloadSchema.safeParse(body)
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? 'invalid payload' })
  const payload = parsed.data

  const lines: Array<{ stream: LogStream; text: string }> = []
  for (const s of payload.sys ?? []) lines.push({ stream: 'sys', text: s })
  for (const s of payload.stderr ?? []) lines.push({ stream: 'err', text: trim(s, 2000) })
  for (const raw of payload.ndjson ?? []) lines.push(...mapClaudeEvent(raw))
  // A step label is a prefix on the text, not a field: every record in the
  // JSONL stays the same shape, and the sheet reads `[plan] …` the way it reads
  // anything else.
  const label = typeof payload.step === 'object' ? `[${payload.step.name}] ` : ''
  await appendLogs(jobId, label ? lines.map((l) => ({ ...l, text: label + l.text })) : lines)

  if (payload.step === 'commit' && payload.outcome) {
    // Move step *before* answering: the runner's curl returns only after this
    // write, and the container exits after curl — so the `docker wait` watcher
    // can never observe an exited container still marked step=agent unless the
    // report genuinely never arrived. exitCode lands now too, so a finish
    // resumed after a restart (see reconcile) knows how the agent did.
    await store.patchJob(jobId, {
      step: payload.outcome === 'committed' ? 'push' : 'done',
      exitCode: payload.exitCode ?? 0,
    })
    const { finishJob } = await import('./job-runner')
    void finishJob(jobId, payload.outcome, payload.exitCode ?? 0)
  }

  return json(200, { ok: true })
}

/* ------------------------------------------------------------------ */
/* stream-json → log lines                                            */
/* ------------------------------------------------------------------ */

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** A tool_result's content is a string, or blocks of `{type:'text', text}`. */
function resultText(c: unknown): string {
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return ''
  const parts: Array<string> = []
  for (const p of c) {
    if (typeof p === 'object' && p !== null && 'text' in p && typeof (p as { text: unknown }).text === 'string') {
      parts.push((p as { text: string }).text)
    }
  }
  return parts.join('\n')
}

/** The one identifying parameter of a tool call, for a readable `tool` line. */
function toolDetail(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const o = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'description']) {
    if (typeof o[key] === 'string' && o[key] !== '') return trim(o[key] as string, 120)
  }
  return ''
}

interface ClaudeEvent {
  type?: string
  subtype?: string
  session_id?: string
  model?: string
  message?: { content?: Array<Record<string, unknown>> }
  num_turns?: number
  total_cost_usd?: number
  is_error?: boolean
  result?: string
}

/**
 * One NDJSON line → zero or more log lines. Unrecognised event types are
 * dropped (forward-compatible, not noisy); unparseable lines pass through as
 * plain output rather than being lost.
 */
export function mapClaudeEvent(raw: string): Array<{ stream: LogStream; text: string }> {
  let ev: ClaudeEvent
  try {
    ev = JSON.parse(raw) as ClaudeEvent
  } catch {
    return raw.trim() === '' ? [] : [{ stream: 'out', text: trim(raw, 2000) }]
  }

  switch (ev.type) {
    case 'system':
      if (ev.subtype !== 'init') return []
      return [{ stream: 'sys', text: `session ${ev.session_id ?? '?'} · ${ev.model ?? '?'}` }]

    case 'assistant': {
      const out: Array<{ stream: LogStream; text: string }> = []
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          out.push({ stream: 'out', text: trim(block.text, 4000) })
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const detail = toolDetail(block.input)
          out.push({ stream: 'tool', text: detail ? `${block.name}: ${detail}` : block.name })
        }
      }
      return out
    }

    case 'user': {
      // Only errors are interesting; successful tool results are usually huge.
      const out: Array<{ stream: LogStream; text: string }> = []
      for (const block of ev.message?.content ?? []) {
        if (block.type !== 'tool_result' || block.is_error !== true) continue
        const text = resultText(block.content)
        if (text.trim() !== '') out.push({ stream: 'err', text: trim(text, 600) })
      }
      return out
    }

    case 'result': {
      const cost = typeof ev.total_cost_usd === 'number' ? ` · $${ev.total_cost_usd.toFixed(2)}` : ''
      const turns = typeof ev.num_turns === 'number' ? `${ev.num_turns} turns` : 'done'
      if (!ev.is_error) return [{ stream: 'sys', text: `agent finished in ${turns}${cost}` }]
      const detail = ev.result ? ` — ${trim(ev.result, 300)}` : ''
      return [{ stream: 'err', text: `agent errored after ${turns}${cost}${detail}` }]
    }

    default:
      return []
  }
}
