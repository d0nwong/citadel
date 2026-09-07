/**
 * Node-only. The one tool Ask's session can call that is not a read of the checkout:
 * `propose_decision` (LIA-111).
 *
 * It is bridged, which decides its shape. `chat({ tools })` makes the adapter provision an
 * MCP server named `tanstack`; the session sees `mcp__tanstack__propose_decision` and the
 * bridge calls `execute` here in Pensieve's process — with no approval gate, because the
 * Claude Code adapter supports neither client-side nor approval-gated tools
 * (`docs/adapters/claude-code.md`). A tool that always executes must therefore be
 * read-only: this one checks the verdict and answers a proposal. The write is a click, on
 * the card the chat renders from this tool's part (`features/ask/components/decision-card`).
 *
 * The bridge hands `execute` the raw MCP arguments — the engine validates nothing on this
 * path — so the schema is applied here rather than trusted.
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { PROPOSE_DECISION } from "../lib/ask-tools";
import { POINT_ID_RE } from "../lib/points";
import type { VerdictSources } from "./verdict";
import { checkVerdict } from "./verdict";

/** Long enough for the skill's "≤ 140 characters" sentence and an edit of it, not for an essay. */
const REASON_MAX = 280;

const inputSchema = z.object({
  action: z.enum(["ignored", "sent"]),
  point: z.string().regex(POINT_ID_RE),
  reason: z.string().max(REASON_MAX).optional(),
  repo: z.string().optional(),
});

const proposalSchema = z.object({
  action: z.enum(["ignored", "sent"]),
  point: z.string(),
  reason: z.string().optional(),
  repo: z.string().optional(),
  subject: z.string(),
  ticket: z.string().optional(),
});

const outputSchema = z.union([
  z.object({
    note: z.string(),
    ok: z.literal(true),
    proposal: proposalSchema,
  }),
  z.object({ error: z.string(), ok: z.literal(false) }),
]);

export type Proposal = z.infer<typeof proposalSchema>;
export type ProposeDecisionOutput = z.infer<typeof outputSchema>;

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
  const parsed = inputSchema.safeParse(args);
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
  inputSchema,
  name: PROPOSE_DECISION,
  outputSchema,
}).server<AskToolContext>((args, { context }) =>
  proposeDecision(args, context ?? {})
);
