/**
 * Node-only. The scanner's window onto Linear — every query and mutation the
 * tick needs, behind the `LinearPort` interface so tick tests can stub the
 * whole edge with plain objects.
 *
 * Auth rides the same personal API key `linkTicket` uses (raw key, no
 * `Bearer`), through the exported `gql` helper. The claim itself — viewer,
 * started state, the `issueUpdate` — lives in `linear-link.ts` since LIA-92,
 * shared with the trigger API; this port only adds the candidate scan and
 * the repair path's state check. Runs on the HOST only: LINEAR_API_KEY never
 * enters a forge — containers reach Linear through the MCP gateway and
 * nowhere else.
 */
import { claimIssue, gql, startedStateId, viewerId } from '@/features/jobs/server/linear-link'

export interface CandidateIssue {
  /** Linear's uuid — what mutations address. */
  id: string
  /** The human identifier, e.g. "LIA-52" — what the claim is keyed on. */
  identifier: string
  title: string
  url: string
  /** description ?? '' — the job brief, all sections. */
  body: string
  teamId: string
  projectName: string | null
  blockedBy: Array<{ identifier: string; stateType: string }>
}

/** What one scan tick needs from Linear — the seam the tick tests stub. */
export interface LinearPort {
  fetchCandidates(): Promise<Array<CandidateIssue>>
  viewerId(): Promise<string>
  startedStateId(teamId: string): Promise<string>
  /** Assign + move to In Progress. Idempotent — the repair path re-applies it. */
  claimIssue(issueId: string, assigneeId: string, stateId: string): Promise<void>
  /** State *type* (unstarted | started | …) — the repair path's staleness check. */
  issueStateType(issueId: string): Promise<string>
}

interface CandidatesData {
  issues: {
    nodes: Array<{
      id: string
      identifier: string
      title: string
      url: string
      description: string | null
      team: { id: string }
      project: { name: string } | null
      inverseRelations: {
        nodes: Array<{ type: string; issue: { identifier: string; state: { type: string } | null } }>
      }
    }>
  }
}

/**
 * Open issues carrying the label. The label is the entire opt-in; the state
 * filter only encodes "open" — it keeps tickets the scanner already claimed
 * (now In Progress, label kept) out of the conflict path, and never re-ignites
 * a completed or cancelled one. `first: 50` dwarfs the per-tick claim budget.
 */
const CANDIDATES = `query($team: String!, $label: String!) {
  issues(first: 50, filter: {
    team:   { name: { eq: $team } },
    labels: { some: { name: { eq: $label } } },
    state:  { type: { in: ["triage", "backlog", "unstarted"] } }
  }) {
    nodes {
      id identifier title url description
      team { id }
      project { name }
      inverseRelations(first: 50) {
        nodes { type issue { identifier state { type } } }
      }
    }
  }
}`

export function makeLinearPort(apiKey: string, opts?: { team?: string; label?: string }): LinearPort {
  const team = opts?.team ?? 'Liamai'
  const label = opts?.label ?? 'agent-ready'

  return {
    async fetchCandidates() {
      const data = await gql<CandidatesData>(apiKey, CANDIDATES, { team, label })
      return data.issues.nodes.map((n) => ({
        id: n.id,
        identifier: n.identifier,
        title: n.title,
        url: n.url,
        body: n.description ?? '',
        teamId: n.team.id,
        projectName: n.project?.name ?? null,
        // An inverseRelation of type "blocks" points from the blocker (issue)
        // at this candidate (relatedIssue). `relations` would be the issues
        // this candidate blocks — the wrong direction for a readiness check.
        blockedBy: n.inverseRelations.nodes
          .filter((r) => r.type === 'blocks')
          .map((r) => ({ identifier: r.issue.identifier, stateType: r.issue.state?.type ?? '' })),
      }))
    },

    viewerId: () => viewerId(apiKey),
    startedStateId: (teamId) => startedStateId(apiKey, teamId),
    claimIssue: (issueId, assigneeId, stateId) => claimIssue(apiKey, issueId, assigneeId, stateId),

    async issueStateType(issueId: string) {
      const data = await gql<{ issue: { state: { type: string } | null } }>(
        apiKey,
        'query($id: String!) { issue(id: $id) { state { type } } }',
        { id: issueId },
      )
      return data.issue.state?.type ?? ''
    },
  }
}
