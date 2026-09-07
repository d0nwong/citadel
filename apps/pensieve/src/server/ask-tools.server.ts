/**
 * Node-only. The tools Argus's session can call that are not a read of the checkout:
 * `propose_decision` (LIA-111) and `propose_ticket` (LIA-113).
 *
 * It is bridged, which decides its shape. `chat({ tools })` makes the adapter provision an
 * MCP server named `tanstack`; the session sees `mcp__tanstack__propose_decision` and the
 * bridge calls `execute` here in Pensieve's process — with no approval gate, because the
 * Claude Code adapter supports neither client-side nor approval-gated tools
 * (`docs/adapters/claude-code.md`). A tool that always executes must therefore be
 * read-only: each one checks a draft and answers a proposal. The write is a click, on the
 * card the chat renders from the tool's part (`features/ask/components/decision-card`,
 * `features/ask/components/ticket-card`).
 *
 * The bridge hands `execute` the raw MCP arguments — the engine validates nothing on this
 * path — so the schema is applied here rather than trusted.
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { PROPOSE_DECISION, PROPOSE_TICKET } from "../lib/ask-tools";
import { POINT_ID_RE } from "../lib/points";
import { TEAM_NAME } from "./linear";
import type { TicketSources } from "./ticket";
import { checkDraft } from "./ticket";
import type { VerdictSources } from "./verdict";
import { checkVerdict } from "./verdict";

/** Long enough for the skill's "≤ 140 characters" sentence and an edit of it, not for an essay. */
const REASON_MAX = 280;

const decisionInput = z.object({
  action: z.enum(["ignored", "sent"]),
  point: z.string().regex(POINT_ID_RE),
  reason: z.string().max(REASON_MAX).optional(),
  repo: z.string().optional(),
});

const decisionProposal = z.object({
  action: z.enum(["ignored", "sent"]),
  point: z.string(),
  reason: z.string().optional(),
  repo: z.string().optional(),
  subject: z.string(),
  ticket: z.string().optional(),
});

const decisionOutput = z.union([
  z.object({
    note: z.string(),
    ok: z.literal(true),
    proposal: decisionProposal,
  }),
  z.object({ error: z.string(), ok: z.literal(false) }),
]);

export type Proposal = z.infer<typeof decisionProposal>;
export type ProposeDecisionOutput = z.infer<typeof decisionOutput>;

/** Said back to the session on every accepted proposal, so it cannot report the verdict as done. */
export const PROPOSAL_NOTE =
  "shown to Liam as a card; nothing is written until he confirms";

/** The context `askStream` puts on `chat()`; the tool uses it for the log line. */
export interface AskToolContext {
  point?: string;
  threadId?: string;
}

/**
 * Check the verdict and answer a proposal, or say why there is none. Writes nothing — not
 * `decisions/`, not Foundry. The one trace a bridged call leaves is the log line, since the
 * run itself happens inside the harness.
 */
export async function proposeDecision(
  args: unknown,
  context: AskToolContext = {},
  sources?: VerdictSources
): Promise<ProposeDecisionOutput> {
  const parsed = decisionInput.safeParse(args);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return {
      error: `propose_decision: ${issue ? `${issue.path.join(".") || "input"} — ${issue.message}` : "unusable input"}`,
      ok: false,
    };
  }
  const { action, point, reason, repo } = parsed.data;
  const check = await checkVerdict(point, action, { reason, repo }, sources);
  const where = context.threadId ? ` · thread ${context.threadId}` : "";
  if (!check.ok) {
    console.log(
      `[ask] propose_decision ${action} ${point}${where} · refused: ${check.error}`
    );
    return { error: check.error, ok: false };
  }
  console.log(`[ask] propose_decision ${action} ${point}${where} · proposed`);
  return {
    note: PROPOSAL_NOTE,
    ok: true,
    proposal: {
      action,
      point: check.point.id,
      subject: check.point.subject,
      ...(check.point.ticket ? { ticket: check.point.ticket } : {}),
      ...("reason" in check ? { reason: check.reason } : {}),
      // Empty when neither the call nor the point record named one; the card collects it.
      ...("repo" in check && check.repo ? { repo: check.repo } : {}),
    },
  };
}

/**
 * The definition `chat({ tools })` takes. `@tanstack/ai` converts the Zod schema to JSON
 * Schema before the adapter sees it, which is what the bridge advertises over MCP.
 */
export const proposeDecisionTool = toolDefinition({
  description:
    "Propose a verdict on a Needs-you point for Liam to confirm. Checks the point against reports/points.json, decisions/ and Foundry's availability and answers a proposal that Pensieve shows as a card with a Confirm button — or { ok: false, error } when the verdict cannot be given. It writes nothing: the decision is recorded only when Liam presses Confirm, so never say the point has been ignored or sent. Call it once per verdict.",
  inputSchema: decisionInput,
  name: PROPOSE_DECISION,
  outputSchema: decisionOutput,
}).server<AskToolContext>((args, { context }) =>
  proposeDecision(args, context ?? {})
);

// ── propose_ticket (LIA-113) ───────────────────────────────────────────────────

/**
 * Only the shapes, not the limits: a title over 80 characters and a body missing a section
 * are AC4 refusals with a sentence each, and `checkDraft` owns those. A `max()` here would
 * answer them as a schema error instead.
 */
const ticketInput = z.object({
  description: z.string(),
  project: z.string(),
  title: z.string(),
});

const ticketProposal = z.object({
  description: z.string(),
  project: z.string(),
  projectId: z.string().optional(),
  team: z.string(),
  title: z.string(),
  /** False when no project list could be read — the card says the project is unverified. */
  verified: z.boolean(),
});

const ticketOutput = z.union([
  z.object({
    note: z.string(),
    ok: z.literal(true),
    proposal: ticketProposal,
  }),
  z.object({ error: z.string(), ok: z.literal(false) }),
]);

export type TicketProposal = z.infer<typeof ticketProposal>;
export type ProposeTicketOutput = z.infer<typeof ticketOutput>;

/** Said back on every accepted draft, so the session cannot report the ticket as filed. */
export const TICKET_NOTE =
  "shown to Liam as a card; nothing is filed until he presses File";

/**
 * Check a drafted issue and answer a proposal, or say why there is none. Reads the team's
 * projects and nothing else — it never calls `issueCreate`. The write is Liam's press of
 * File on the card the chat renders from this tool's part.
 */
export async function proposeTicket(
  args: unknown,
  context: AskToolContext = {},
  sources?: TicketSources
): Promise<ProposeTicketOutput> {
  const parsed = ticketInput.safeParse(args);
  const where = context.threadId ? ` · thread ${context.threadId}` : "";
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const error = `propose_ticket: ${issue ? `${issue.path.join(".") || "input"} — ${issue.message}` : "unusable input"}`;
    console.log(`[ask] propose_ticket${where} · refused: ${error}`);
    return { error, ok: false };
  }
  const check = await checkDraft(parsed.data, sources);
  if (!check.ok) {
    console.log(`[ask] propose_ticket${where} · refused: ${check.error}`);
    return { error: check.error, ok: false };
  }
  const { draft } = check;
  console.log(
    `[ask] propose_ticket "${draft.title}" → ${draft.project.name}${where} · proposed`
  );
  return {
    note: TICKET_NOTE,
    ok: true,
    proposal: {
      description: draft.description,
      project: draft.project.name,
      team: TEAM_NAME,
      title: draft.title,
      verified: draft.project.verified,
      ...(draft.project.id ? { projectId: draft.project.id } : {}),
    },
  };
}

export const proposeTicketTool = toolDefinition({
  description:
    "Propose a new Linear issue for Liam to file. Takes a draft written per the linear-ticket skill — title under 80 characters, description the five-section body (Summary, Background, Scope / Out of Scope, Acceptance Criteria, Technical Notes, with Pending only between the last two), project a project name on team Liamai — checks it and answers a proposal that Pensieve shows as a card with a File button, or { ok: false, error } when the draft cannot be filed. It writes nothing: the issue exists only when Liam presses File, so never say the ticket has been filed or created. Call it once per ticket, for one plain issue — no sub-issues, blockers or labels.",
  inputSchema: ticketInput,
  name: PROPOSE_TICKET,
  outputSchema: ticketOutput,
}).server<AskToolContext>((args, { context }) =>
  proposeTicket(args, context ?? {})
);
