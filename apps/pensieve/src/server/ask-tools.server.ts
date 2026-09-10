/**
 * Node-only. The tools Argus's session can call that are not a read of the checkout:
 * `propose_decision` (LIA-111, retargeted by LIA-162) and `propose_ticket` (LIA-113).
 *
 * They are bridged, which decides their shape. `chat({ tools })` makes the adapter
 * provision an MCP server named `tanstack`; the session sees
 * `mcp__tanstack__propose_decision` and the bridge calls `execute` here in Pensieve's
 * process — with no approval gate, because the Claude Code adapter supports neither
 * client-side nor approval-gated tools (`docs/adapters/claude-code.md`). A tool that always
 * executes must therefore be read-only: each one checks a draft and answers a proposal. The
 * write is the user's click, on the card the chat renders from the tool's part
 * (`features/ask/components/decision-card`, `features/ask/components/ticket-card`).
 *
 * `propose_decision` used to be a verdict on a Needs-you point. Points went with the
 * sweep's rewire (LIA-161), and what it proposes now is one of the two things a person
 * actually does: a correction on an Unsorted entry — the four verbs the `ask` skill's
 * Correcting section names — or a send, handing a ticket to Foundry. One tool for both,
 * because the session picks between them inside one conversation, and the card is the same
 * card either way.
 *
 * The bridge hands `execute` the raw MCP arguments — the engine validates nothing on this
 * path — so the schema is applied here rather than trusted.
 */

import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { PROPOSE_DECISION, PROPOSE_TICKET } from "../lib/ask-tools";
import type { MarauderDraft } from "../lib/marauder";
import {
  checkDraft as checkCorrection,
  UNSORTED_ACTIONS,
} from "../lib/marauder";
import { TEAM_NAME } from "./linear";
import type { UnsortedItem } from "./marauder";
import { readUnsorted } from "./marauder";
import type { SendSources } from "./send";
import { checkSend } from "./send";
import type { TicketSources } from "./ticket";
import { checkDraft } from "./ticket";

/** Long enough for the skill's "≤ 140 characters" sentence and an edit of it, not for an essay. */
const REASON_MAX = 280;

/**
 * A correction names the queue entry it decides; a send names the ticket. `stage` is in the
 * action list even though the Unsorted page does not offer it — it is one of the four verbs
 * a person has (the `ask` skill's Correcting section), and it is said about a workstream
 * rather than about a row, which is exactly why a conversation is where it gets said.
 */
const decisionInput = z.object({
  action: z.enum(["attach", "new", "dismiss", "stage", "send"]),
  id: z.string().optional(),
  name: z.string().optional(),
  reason: z.string().max(REASON_MAX).optional(),
  repo: z.string().optional(),
  side: z.string().optional(),
  slug: z.string().optional(),
  stage: z.string().optional(),
  ticket: z.string().optional(),
});

const decisionProposal = z.object({
  action: z.enum(["attach", "new", "dismiss", "stage", "send"]),
  id: z.string().optional(),
  name: z.string().optional(),
  reason: z.string().optional(),
  repo: z.string().optional(),
  side: z.string().optional(),
  slug: z.string().optional(),
  stage: z.string().optional(),
  /** What the card shows as the thing being decided: the entry's summary, or the ticket. */
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

/** Said back on every accepted proposal, so the session cannot report the click as made. */
export const PROPOSAL_NOTE =
  "shown as a card; nothing is written until it is confirmed";

/** The context `askStream` puts on `chat()`; the tool uses it for the log line. */
export interface AskToolContext {
  threadId?: string;
  workstream?: string;
}

/** Where the correction half reads from; the send half has `SendSources` of its own. */
export interface CorrectionSources {
  unsorted: () => Promise<UnsortedItem[]>;
}

const correctionSources = (): CorrectionSources => ({
  unsorted: () => readUnsorted(),
});

/**
 * Check the correction and answer a proposal, or say why there is none. `checkDraft` is the
 * Unsorted page's own pre-flight, so a card refused here is refused in the words that page
 * would have used; on top of it, an `attach`, `new` or `dismiss` has to name an entry that
 * is actually in the queue — the one thing a session can get wrong that a click cannot.
 */
async function proposeCorrection(
  draft: MarauderDraft,
  sources: CorrectionSources
): Promise<ProposeDecisionOutput> {
  const error = checkCorrection(draft);
  if (error) {
    return { error, ok: false };
  }
  let subject = draft.name ?? draft.slug ?? draft.id;
  if ((UNSORTED_ACTIONS as readonly string[]).includes(draft.action)) {
    const item = (await sources.unsorted()).find((u) => u.id === draft.id);
    if (!item) {
      return {
        error: `"${draft.id}" is not in the unsorted queue — read workstreams/_unsorted.json for the id`,
        ok: false,
      };
    }
    subject = item.summary;
  }
  return {
    note: PROPOSAL_NOTE,
    ok: true,
    proposal: {
      action: draft.action as Proposal["action"],
      id: draft.id,
      subject,
      ...(draft.name ? { name: draft.name } : {}),
      ...(draft.reason ? { reason: draft.reason } : {}),
      ...(draft.side ? { side: draft.side } : {}),
      ...(draft.slug ? { slug: draft.slug } : {}),
      ...(draft.stage ? { stage: draft.stage } : {}),
    },
  };
}

/**
 * Check the send and answer a proposal. The repo may still be missing here — the card
 * collects it, the same way the workstream page's form does — so the check runs with
 * `repoRequired: false`; everything else it refuses on (a ticket already sent, a ticket
 * someone has started, Foundry unconfigured) is a refusal the button would give too.
 */
async function proposeSend(
  ticket: string,
  repo: string,
  sources?: SendSources
): Promise<ProposeDecisionOutput> {
  const check = await checkSend(ticket, repo, sources, { repoRequired: false });
  if (!check.ok) {
    return { error: check.error, ok: false };
  }
  return {
    note: PROPOSAL_NOTE,
    ok: true,
    proposal: {
      action: "send",
      subject: check.workstream?.name ?? check.ticket,
      ticket: check.ticket,
      ...(check.repo ? { repo: check.repo } : {}),
      ...(check.workstream ? { slug: check.workstream.slug } : {}),
    },
  };
}

/** The call routed to its half, with the optional fields spread only where they were given. */
function answerFor(
  d: z.infer<typeof decisionInput>,
  sources: { correction?: CorrectionSources; send?: SendSources }
): Promise<ProposeDecisionOutput> {
  if (d.action === "send") {
    return proposeSend(d.ticket ?? "", d.repo ?? "", sources.send);
  }
  return proposeCorrection(
    {
      action: d.action,
      id: d.id ?? "",
      ...(d.name ? { name: d.name } : {}),
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.side ? { side: d.side } : {}),
      ...(d.slug ? { slug: d.slug } : {}),
      ...(d.stage ? { stage: d.stage } : {}),
    },
    sources.correction ?? correctionSources()
  );
}

/**
 * Check whichever the call is and answer a proposal, or say why there is none. Writes
 * nothing — not `decisions/`, not Foundry. The one trace a bridged call leaves is the log
 * line, since the run itself happens inside the harness.
 */
export async function proposeDecision(
  args: unknown,
  context: AskToolContext = {},
  sources: { correction?: CorrectionSources; send?: SendSources } = {}
): Promise<ProposeDecisionOutput> {
  const where = context.threadId ? ` · thread ${context.threadId}` : "";
  const parsed = decisionInput.safeParse(args);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const error = `propose_decision: ${issue ? `${issue.path.join(".") || "input"} — ${issue.message}` : "unusable input"}`;
    console.log(`[ask] propose_decision${where} · refused: ${error}`);
    return { error, ok: false };
  }
  const d = parsed.data;
  const answer = await answerFor(d, sources);
  const what = d.action === "send" ? (d.ticket ?? "") : (d.id ?? "");
  console.log(
    `[ask] propose_decision ${d.action} ${what}${where} · ${answer.ok ? "proposed" : `refused: ${answer.error}`}`
  );
  return answer;
}

/**
 * The definition `chat({ tools })` takes. `@tanstack/ai` converts the Zod schema to JSON
 * Schema before the adapter sees it, which is what the bridge advertises over MCP.
 */
export const proposeDecisionTool = toolDefinition({
  description:
    'Propose one thing for the user to confirm on a card. Either a correction to what the loop got wrong — { id, action: "attach" | "new" | "dismiss" | "stage", slug?, name?, side?, stage?, reason }, where id is an entry\'s own id from workstreams/_unsorted.json — or a send — { action: "send", ticket: "LIA-nn", repo? } — handing a ticket to Foundry. It checks the draft against workstreams/, decisions/, Linear and Foundry\'s availability and answers a proposal Pensieve shows as a card with a Confirm button, or { ok: false, error } when it cannot be made. It writes nothing: the file is written only when the user confirms, so never say the entry has been attached, dismissed or opened, or that the ticket has been sent. Call it once per decision.',
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
