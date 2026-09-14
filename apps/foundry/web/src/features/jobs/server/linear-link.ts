/**
 * Node-only. What's left of the host's Linear-specific edge after CTD-204 and CTD-205 moved
 * fetching, claiming and linking a ticket into `@citadel/tickets`: scanning text for ticket
 * ids, and `linkPrToTicket`, which now reaches whichever provider a ticket id belongs to
 * through the package's `link` (`job-runner.ts`'s `hostTickets`) instead of calling Linear's
 * GraphQL API directly. `ticketIdsInTask` is also used by `task-context.ts` to find a job's
 * linked tickets.
 *
 * On PR links: GitHub PRs need none of this — Linear's own GitHub integration reads the
 * `Closes LIA-24` magic word out of the PR description and files the link itself, and Trello
 * has no Bitbucket integration of its own either. So for a Bitbucket-origin PR the host closes
 * that gap itself, on either provider, by writing the link through the package
 * (`job-runner.ts`'s Bitbucket-only call site). The ticket is read from the PR body *and* the
 * job's own task text: an agent only reliably writes the `Closes LIA-24` line when told to, so
 * the task — whatever the user actually typed when they queued the job — is the more
 * dependable source. A bare id (`LIA-24`, no magic word) only counts there; in a PR body,
 * prose like `part of feature-123` would false-positive (spec S-17). One-shot, not a sync —
 * merging or closing the PR on Bitbucket sends nothing back, so the ticket's status is still
 * the user's to move.
 */
import { trim1 } from '@/shared/lib/format'
import type { LinkInput, Ticket } from '@citadel/tickets'

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
 * `linked` is what got attached; `unknown` is a candidate id no provider
 * recognises — worth a quiet log line, not a failure, since a bare id can
 * false-positive on ordinary text (`ISO-8601`); `failed` is a real error
 * per id, e.g. the network, a missing credential, or a declined write.
 */
export type LinkResult = {
  linked: Array<string>
  unknown: Array<string>
  failed: Array<{ id: string; reason: string }>
}

/* ------------------------------------------------------------------ */
/* PR links                                                            */
/* ------------------------------------------------------------------ */

/** What `linkPrToTicket` needs from a ticket source — `job-runner.ts`'s `hostTickets`, routed through the tickets package to whichever provider a key names. */
export interface TicketLinker {
  get(key: string): Promise<Ticket | null>
  link(key: string, input: LinkInput): Promise<void>
}

/**
 * Every ticket id the PR body or the job's task names (CTD-205 AC2), checked against its own
 * provider and linked there. One id's failure does not sink the rest — a job can (and often
 * does) name more than one ticket, and a typo, a missing credential, or a declined write on
 * one shouldn't cost the others.
 */
export async function linkPrToTicket(
  tickets: TicketLinker,
  opts: { prUrl: string; title: string; body: string; task: string },
): Promise<LinkResult> {
  const ids = [...new Set([...ticketIdsIn(opts.body), ...ticketIdsInTask(opts.task)])]

  const linked: Array<string> = []
  const unknown: Array<string> = []
  const failed: Array<{ id: string; reason: string }> = []

  for (const id of ids) {
    let ticket: Ticket | null
    try {
      ticket = await tickets.get(id)
    } catch (e) {
      failed.push({ id, reason: trim1(e instanceof Error ? e.message : String(e), 300) })
      continue
    }
    if (!ticket) {
      unknown.push(id)
      continue
    }

    try {
      await tickets.link(id, { kind: 'pr', url: opts.prUrl, title: trim1(opts.title, 100) })
      linked.push(id)
    } catch (e) {
      failed.push({ id, reason: trim1(e instanceof Error ? e.message : String(e), 300) })
    }
  }
  return { linked, unknown, failed }
}
