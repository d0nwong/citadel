/**
 * Node-only. The completion webhooks: a service that triggered a job over
 * the API (`job-api.ts`) can hand over a `callbackUrl` instead of polling.
 * The host POSTs it one signed `job.settled` event when the job leaves the
 * open set — succeeded, failed, cancelled or pr_ready, whichever path
 * settled it — and, when a `pr_ready` job's PR later merges or closes
 * (S-46), one further signed `job.pr_closed` naming the job's new status and
 * the PR's state. `job.settled` stays one per job; the watcher's move fires
 * `job.pr_closed` instead, never a second `job.settled` (S-29, S-52).
 *
 * Signed, not authenticated: the body carries an HMAC-SHA256 under the same
 * install token the caller used to reach us, GitHub-style, so the receiver
 * verifies with a secret it already holds and the token itself never leaves
 * the host. Best effort — a dead receiver costs an `err` line in the job's
 * log, never its status and never the queue pump.
 */
import { createHmac } from 'node:crypto'
import { apiToken } from './auth'
import { appendLogs } from './job-logs'
import { getJob } from './job-store'
import type { Job } from '../types'

export const EVENT_HEADER = 'x-foundry-event'
export const SIGNATURE_HEADER = 'x-foundry-signature'
export const SETTLED_EVENT = 'job.settled'
export const PR_CLOSED_EVENT = 'job.pr_closed'

/** Waits before the 2nd and 3rd attempt: three tries in ~6s, then give up. */
const RETRY_DELAYS_MS = [1_000, 5_000]
const ATTEMPT_TIMEOUT_MS = 10_000

export interface SettledEvent {
  event: typeof SETTLED_EVENT
  job: Job
}

export interface PrClosedEvent {
  event: typeof PR_CLOSED_EVENT
  job: Job
  prState: 'merged' | 'closed'
}

/** `sha256=<hex>` over the raw body — what the receiver recomputes. */
export const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

export interface WebhookDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  secret: () => Promise<string | undefined>
  retryDelays: Array<number>
  timeoutMs: number
}

const realDeps = (): WebhookDeps => ({
  fetch: globalThis.fetch,
  secret: apiToken,
  retryDelays: RETRY_DELAYS_MS,
  timeoutMs: ATTEMPT_TIMEOUT_MS,
})

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Sign and POST one event body to the job's callback, retrying as both
 * events do. Resolves once the delivery has succeeded or every attempt is
 * spent; callers fire-and-forget it, so nothing here may throw.
 */
async function deliver(jobId: string, url: string, eventName: string, body: string, deps: WebhookDeps): Promise<void> {
  const headers: Record<string, string> = { 'content-type': 'application/json', [EVENT_HEADER]: eventName }
  const secret = await deps.secret()
  if (secret) headers[SIGNATURE_HEADER] = sign(secret, body)
  else await appendLogs(jobId, [{ stream: 'err', text: 'callback sent unsigned — no FOUNDRY_API_TOKEN configured' }])

  const host = safeHost(url)
  let lastFailure = ''
  for (let attempt = 0; attempt <= deps.retryDelays.length; attempt++) {
    if (attempt > 0) await sleep(deps.retryDelays[attempt - 1]!)
    try {
      const res = await deps.fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(deps.timeoutMs),
      })
      if (res.ok) {
        await appendLogs(jobId, [{ stream: 'sys', text: `callback delivered to ${host} (${res.status}${attempt > 0 ? `, attempt ${attempt + 1}` : ''})` }])
        return
      }
      lastFailure = `HTTP ${res.status}`
    } catch (e) {
      lastFailure = e instanceof Error ? e.message : String(e)
    }
  }
  await appendLogs(jobId, [
    { stream: 'err', text: `callback to ${host} failed after ${deps.retryDelays.length + 1} attempts: ${lastFailure}` },
  ])
}

/**
 * Fire the job's `job.settled` callback, if it has one. Reads the row fresh
 * so the body reflects the settle that just happened, whichever code path
 * made it.
 */
export async function notifyCallback(jobId: string, deps: WebhookDeps = realDeps()): Promise<void> {
  try {
    const detail = await getJob(jobId)
    const url = detail?.callbackUrl
    if (!detail || !url) return
    const { logs: _logs, ...job } = detail

    const body = JSON.stringify({ event: SETTLED_EVENT, job } satisfies SettledEvent)
    await deliver(jobId, url, SETTLED_EVENT, body, deps)
  } catch (e) {
    // Reading the row or the log file failed; there is no one left to tell.
    console.error(`[webhook] ${jobId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Fire the job's `job.pr_closed` callback, if it has one — the watcher's
 * move of a `pr_ready` job once its PR merges or closes (S-46, S-52). Reads
 * the row fresh so `job.status` reflects the move that just committed.
 */
export async function notifyPrClosed(jobId: string, prState: 'merged' | 'closed', deps: WebhookDeps = realDeps()): Promise<void> {
  try {
    const detail = await getJob(jobId)
    const url = detail?.callbackUrl
    if (!detail || !url) return
    const { logs: _logs, ...job } = detail

    const body = JSON.stringify({ event: PR_CLOSED_EVENT, job, prState } satisfies PrClosedEvent)
    await deliver(jobId, url, PR_CLOSED_EVENT, body, deps)
  } catch (e) {
    console.error(`[webhook] ${jobId}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The log line names the receiver's host, never its full URL (it may carry a secret path). */
function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'callback'
  }
}
