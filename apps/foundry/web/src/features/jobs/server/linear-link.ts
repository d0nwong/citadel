/**
 * Node-only. Filing a pull request back onto its Linear ticket.
 *
 * GitHub PRs need none of this: Linear's own GitHub integration reads the
 * `Closes LIA-24` magic word out of the PR description and files the link
 * itself. Linear has no Bitbucket integration, so an identical description
 * lands on a forge nothing is watching — the host closes that gap by creating
 * the attachment through Linear's API. Only the Bitbucket path calls in here;
 * the GitHub one is left exactly as the integration expects to find it.
 *
 * The ticket is read from the PR body *and* the job's own task text: an agent
 * only reliably writes the `Closes LIA-24` line when told to, so the task —
 * whatever the user actually typed when they queued the job — is the more
 * dependable source. A bare id (`LIA-24`, no magic word) only counts there;
 * in a PR body, prose like `part of feature-123` would false-positive.
 *
 * Runs on the HOST for the same reason `bb` does: LINEAR_API_KEY never enters
 * a forge. Containers reach Linear through the MCP gateway and nowhere else.
 *
 * One-shot, not a sync — merging or closing the PR on Bitbucket sends nothing
 * back, so the ticket's status is still the user's to move.
 */

const API = 'https://api.linear.app/graphql'

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

const trim1 = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

interface GqlResponse<T> {
  data?: T
  errors?: Array<{ message?: string }>
}

/**
 * A personal API key (`lin_api_…`, what `foundry auth --linear` stores) goes in
 * Authorization raw — no `Bearer`, which is the OAuth form. GraphQL errors
 * arrive with HTTP 200, so the body is checked whatever the status says.
 */
async function gql<T>(apiKey: string, query: string, variables: Record<string, string>): Promise<T> {
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

/**
 * `issue(id:)` takes the human identifier as well as the UUID, but
 * `attachmentLinkURL` wants the UUID — so resolve, then attach. Attachments
 * are keyed on the URL, so a re-run that opens a fresh PR adds a second link
 * rather than replacing the first, and re-filing the same URL is a no-op.
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
      const found = await gql<{ issue: { id: string } | null }>(
        apiKey,
        'query($id: String!) { issue(id: $id) { id } }',
        { id },
      )
      if (!found.issue) {
        unknown.push(id)
        continue
      }
      issueId = found.issue.id
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Linear's GraphQL layer errors rather than nulling on some lookups —
      // treat "not found" the same as a null result; anything else is real.
      if (/not found/i.test(msg)) unknown.push(id)
      else failed.push({ id, reason: trim1(msg, 300) })
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
