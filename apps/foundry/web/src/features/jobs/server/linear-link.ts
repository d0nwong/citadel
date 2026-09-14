/**
 * Node-only. The host's remaining Linear edge, now that fetching a ticket
 * and claiming it live in `@citadel/tickets` (CTD-204): scanning text for
 * ticket ids, and filing a pull request back onto Linear as an attachment.
 * Only the runner's Bitbucket path (`linkPrToTicket`) uses this file now.
 *
 * Runs on the HOST for the same reason `bb` does: LINEAR_API_KEY never enters
 * a forge. Containers reach Linear through the MCP gateway and nowhere else.
 * The key is read fresh per use (`linearApiKey`), so a new key in argus's `.env`
 * takes effect without a restart.
 *
 * On PR links: GitHub PRs need none of this — Linear's own GitHub integration
 * reads the `Closes LIA-24` magic word out of the PR description and files
 * the link itself. Linear has no Bitbucket integration, so an identical
 * description lands on a forge nothing is watching; the host closes that gap
 * by creating the attachment through Linear's API. The ticket is read from
 * the PR body *and* the job's own task text: an agent only reliably writes
 * the `Closes LIA-24` line when told to, so the task — whatever the user
 * actually typed when they queued the job — is the more dependable source. A
 * bare id (`LIA-24`, no magic word) only counts there; in a PR body, prose
 * like `part of feature-123` would false-positive. One-shot, not a sync —
 * merging or closing the PR on Bitbucket sends nothing back, so the ticket's
 * status is still the user's to move.
 */
import { trim1 } from '@/shared/lib/format'
import { readFoundryEnv } from './foundry-env'

const API = 'https://api.linear.app/graphql'

/**
 * The host's personal API key, from citadel's `.env` (`readFoundryEnv`). `process.env` is
 * the fallback for headless setups and tests. Undefined means Linear was never
 * configured — every caller degrades from there rather than failing a job.
 */
export async function linearApiKey(): Promise<string | undefined> {
  const cred = await readFoundryEnv()
  return cred.LINEAR_API_KEY ?? process.env.LINEAR_API_KEY ?? undefined
}

/**
 * Linear's magic words, closing and non-closing alike, as its GitHub and
 * GitLab integrations read them: whatever would have linked the ticket there
 * should link it here. Case-insensitive for the word, not for the id — the id
 * is checked separately so `part of feature-123` cannot pass for a ticket.
 */
const MAGIC =
  /\b(?:close[sd]?|closing|fix(?:e[sd]|ing)?|resolve[sd]?|resolving|complete[sd]?|completing|implement(?:s|ed|ing)?|refs?|references?|part of|related to|contributes to|towards)\s+([A-Za-z][A-Za-z0-9]*-\d+)\b/gi

/** A pasted Linear issue link, e.g. `linear.app/liamai/issue/LIA-24/…` — no magic word needed, the URL is the reference. */
const LINEAR_URL = /linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/gi

/** A ticket id on its own, e.g. a task typed as `LIA-24: fix the thing`. Task text only — see the header comment. */
const BARE_ID = /\b([A-Z][A-Z0-9]*-\d+)\b/g

const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/

function idsMatching(text: string, pattern: RegExp): Array<string> {
  const ids: Array<string> = []
  // `matchAll` clones the regex, so the shared `g` lastIndex is not a hazard.
  for (const m of text.matchAll(pattern)) {
    if (TICKET_ID.test(m[1])) ids.push(m[1])
  }
  return ids
}

/** Ticket ids a magic word or a Linear URL points at, in the order they appear, deduped. */
export function ticketIdsIn(text: string): Array<string> {
  return [...new Set([...idsMatching(text, MAGIC), ...idsMatching(text, LINEAR_URL)])]
}

/** `ticketIdsIn` plus bare ids — for task text, where an id with no magic word is still unambiguous. */
export function ticketIdsInTask(text: string): Array<string> {
  return [...new Set([...ticketIdsIn(text), ...idsMatching(text, BARE_ID)])]
}

/**
 * `linked` is what got attached; `unknown` is a candidate id Linear doesn't
 * recognise — worth a quiet log line, not a failure, since a bare id can
 * false-positive on ordinary text (`ISO-8601`); `failed` is a real error
 * per id, e.g. the network or a declined attachment.
 */
export type LinkResult = {
  linked: Array<string>
  unknown: Array<string>
  failed: Array<{ id: string; reason: string }>
}

interface GqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

/**
 * A personal API key (`lin_api_…`, what argus's `.env` holds) goes in
 * Authorization raw — no `Bearer`, which is the OAuth form. GraphQL errors
 * arrive with HTTP 200, so the body is checked whatever the status says.
 */
export async function gql<T>(apiKey: string, query: string, variables: Record<string, string>): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: apiKey },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  const json = (await res.json().catch(() => ({}))) as GqlResponse<T>
  const problem = json.errors?.map((e) => e.message ?? 'unknown error').join('; ')
  if (problem) throw new Error(problem)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!json.data) throw new Error('no data in response')
  return json.data
}

/* ------------------------------------------------------------------ */
/* PR links                                                            */
/* ------------------------------------------------------------------ */

/**
 * `issue(id:)` takes the human identifier as well as the UUID — the only
 * thing `linkPrToTicket` needs, `attachmentLinkURL` addressing by uuid. Null
 * means Linear has no such issue — either a null result or, on some
 * lookups, a "not found" GraphQL error, which is the same answer worded
 * differently. Anything else (network, auth, a bad key) throws.
 */
async function issueUuid(apiKey: string, identifier: string): Promise<string | null> {
  try {
    const found = await gql<{ issue: { id: string } | null }>(apiKey, 'query($id: String!) { issue(id: $id) { id } }', { id: identifier })
    return found.issue?.id ?? null
  } catch (e) {
    if (/not found/i.test(e instanceof Error ? e.message : String(e))) return null
    throw e
  }
}

/**
 * `attachmentLinkURL` wants the UUID, so resolve the identifier (`issueUuid`)
 * and then attach. Attachments are keyed on the URL, so a re-run that opens a
 * fresh PR adds a second link rather than replacing the first, and re-filing
 * the same URL is a no-op.
 *
 * One id's failure does not sink the rest — a job can (and often does) name
 * more than one ticket, and a typo in one shouldn't cost the others.
 */
export async function linkPrToTicket(
  apiKey: string,
  opts: { prUrl: string; title: string; body: string; task: string },
): Promise<LinkResult> {
  const ids = [...new Set([...ticketIdsIn(opts.body), ...ticketIdsInTask(opts.task)])]

  const linked: Array<string> = []
  const unknown: Array<string> = []
  const failed: Array<{ id: string; reason: string }> = []

  for (const id of ids) {
    let issueId: string
    try {
      const found = await issueUuid(apiKey, id)
      if (!found) {
        unknown.push(id)
        continue
      }
      issueId = found
    } catch (e) {
      failed.push({ id, reason: trim1(e instanceof Error ? e.message : String(e), 300) })
      continue
    }

    try {
      const done = await gql<{ attachmentLinkURL: { success: boolean } }>(
        apiKey,
        `mutation($issueId: String!, $url: String!, $title: String!) {
          attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success }
        }`,
        { issueId, url: opts.prUrl, title: trim1(opts.title, 100) },
      )
      if (!done.attachmentLinkURL.success) {
        failed.push({ id, reason: 'Linear declined the attachment' })
        continue
      }
      linked.push(id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failed.push({ id, reason: trim1(msg, 300) })
    }
  }
  return { linked, unknown, failed }
}
