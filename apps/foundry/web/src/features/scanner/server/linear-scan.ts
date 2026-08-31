/**
 * Node-only. The scanner's window onto Linear — every query and mutation the
 * tick needs, behind the `LinearPort` interface so tick tests can stub the
 * whole edge with plain objects.
 *
 * Auth rides the same personal API key `linkTicket` uses (raw key, no
 * `Bearer`), through the exported `gql` helper. Runs on the HOST only:
 * LINEAR_API_KEY never enters a forge — containers reach Linear through the
 * MCP gateway and nowhere else.
 */
import { gql } from '@/features/jobs/server/linear-link'

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

    async viewerId() {
      const data = await gql<{ viewer: { id: string } }>(apiKey, 'query { viewer { id } }', {})
      return data.viewer.id
    },

    async startedStateId(teamId: string) {
      const data = await gql<{ team: { states: { nodes: Array<{ id: string; name: string; type: string }> } } }>(
        apiKey,
        'query($teamId: String!) { team(id: $teamId) { states { nodes { id name type } } } }',
        { teamId },
      )
      const states = data.team.states.nodes
      const started = states.find((s) => s.type === 'started' && s.name.toLowerCase() === 'in progress')
        ?? states.find((s) => s.type === 'started')
      if (!started) throw new Error('team has no started-type state to move the ticket into')
      return started.id
    },

    async claimIssue(issueId: string, assigneeId: string, stateId: string) {
      await gql<{ issueUpdate: { success: boolean } }>(
        apiKey,
        `mutation($id: String!, $assigneeId: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { assigneeId: $assigneeId, stateId: $stateId }) { success }
        }`,
        { id: issueId, assigneeId, stateId },
      )
    },

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
