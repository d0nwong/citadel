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

const TICKET_ID = /^[A-Z][A-Z0-9]*-\d+$/

/** Ticket ids a magic word points at, in the order they appear, deduped. */
export function ticketIdsIn(text: string): Array<string> {
  const ids = new Set<string>()
  // `matchAll` clones the regex, so the shared `g` lastIndex is not a hazard.
  for (const m of text.matchAll(MAGIC)) {
    if (TICKET_ID.test(m[1])) ids.add(m[1])
  }
  return [...ids]
}

/** `linked` lists what was attached — empty when the body named no ticket, which is not a failure. */
export type LinkResult = { linked: Array<string> } | { linked: null; reason: string }

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
 */
export async function linkPrToTicket(
  apiKey: string,
  opts: { prUrl: string; title: string; body: string },
): Promise<LinkResult> {
  const ids = ticketIdsIn(opts.body)
  if (ids.length === 0) return { linked: [] }

  const linked: Array<string> = []
  for (const id of ids) {
    try {
      const found = await gql<{ issue: { id: string } | null }>(
        apiKey,
        'query($id: String!) { issue(id: $id) { id } }',
        { id },
      )
      if (!found.issue) return { linked: null, reason: `Linear has no issue ${id}` }

      const done = await gql<{ attachmentLinkURL: { success: boolean } }>(
        apiKey,
        `mutation($issueId: String!, $url: String!, $title: String!) {
          attachmentLinkURL(issueId: $issueId, url: $url, title: $title) { success }
        }`,
        { issueId: found.issue.id, url: opts.prUrl, title: trim1(opts.title, 100) },
      )
      if (!done.attachmentLinkURL.success) return { linked: null, reason: `Linear declined the attachment on ${id}` }
      linked.push(id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { linked: null, reason: `could not attach the PR to ${id}: ${trim1(msg, 300)}` }
    }
  }
  return { linked }
}
