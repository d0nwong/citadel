/**
 * The readiness sanity check behind the `agent-ready` label (LIA-52). The
 * label is the entire pickup contract — a human applied it on purpose — so
 * this guard never *selects* tickets, it only catches the two ways a labeled
 * ticket can still be visibly not ready: an unresolved blocker, or leftover
 * items in the house format's "Pending" section. A failed check skips the
 * ticket for this scan; the label stays and the next scan retries.
 *
 * Deliberately dependency-free so the tests need no I/O and the module can
 * never drag server-only imports into a client bundle by accident.
 */

export interface BlockedBy {
  identifier: string
  /** Linear state *type* (completed | canceled | started | …), not the name. */
  stateType: string
}

export interface ReadinessInput {
  body: string
  blockedBy: Array<BlockedBy>
}

export type Readiness = { ready: true } | { ready: false; reason: string }

/** A blocker only stops being one once its issue is completed or canceled. */
const RESOLVED = new Set(['completed', 'canceled'])

/**
 * House headings can be compound ("Scope / Out of Scope"), so the Pending
 * section is any heading whose text *starts with* "pending", at any depth.
 */
const PENDING_HEADING = /^#{1,6}\s*pending/i
const ANY_HEADING = /^#{1,6}\s/

/** The lines under the ticket's Pending heading, up to the next heading. */
function pendingSection(body: string): Array<string> | undefined {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => PENDING_HEADING.test(l.trim()))
  if (start === -1) return undefined
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => ANY_HEADING.test(l.trim()))
  return rest.slice(0, end === -1 ? rest.length : end)
}

export function assessReadiness(input: ReadinessInput): Readiness {
  // An unknown state type counts as unresolved — fail safe, not open.
  const blockers = input.blockedBy.filter((b) => !RESOLVED.has(b.stateType))
  if (blockers.length > 0) {
    return { ready: false, reason: `blocked by ${blockers.map((b) => b.identifier).join(', ')}` }
  }

  const pending = pendingSection(input.body)
  if (pending !== undefined && pending.some((l) => l.trim() !== '')) {
    return { ready: false, reason: 'non-empty Pending section' }
  }

  return { ready: true }
}
