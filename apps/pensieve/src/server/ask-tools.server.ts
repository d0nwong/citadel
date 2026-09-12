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
import type { Unplaced } from "../lib/ledger";
import type { LedgerRef } from "./ledger";
import { listLedgers, readUnplaced } from "./ledger";
import type { TicketSources } from "./ticket";
import { checkDraft } from "./ticket";

/** Long enough for the skill's "≤ 140 characters" sentence and an edit of it, not for an essay. */
const REASON_MAX = 280;

/**
 * The four things a person does to the record from a conversation: close an ask, confirm
 * or contradict a requirement, place an unplaced message. Each names the feature's
 * directory and the id, and all but place carry a reason.
 */
const decisionInput = z.object({
  feature: z.string(),
  id: z.string(),
  reason: z.string().max(REASON_MAX).optional(),
  verb: z.enum(["close", "confirm", "contradict", "place"]),
});

const decisionProposal = z.object({
  feature: z.string(),
  id: z.string(),
  reason: z.string().optional(),
  /** What the card shows as the thing being decided: the ask's or rule's text, or the message. */
  subject: z.string(),
  verb: z.enum(["close", "confirm", "contradict", "place"]),
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
  feature?: string;
  threadId?: string;
}

/** Where the check reads from: the ledgers and the unplaced list, never a write. */
export interface DecisionSources {
  ledgers: () => Promise<LedgerRef[]>;
  unplaced: () => Promise<Unplaced[]>;
}

const decisionSources = (): DecisionSources => ({
  ledgers: async () => (await listLedgers()).ledgers,
  unplaced: () => readUnplaced(),
});

const NEEDS_REASON: Record<Proposal["verb"], string | null> = {
  close: "say how it got done — the record keeps the reason",
  confirm: "say who confirmed it, or how you know",
  contradict: "say who said otherwise, and what",
  place: null,
};

/**
 * Check the proposal against the record and answer it, or say why there is none: the
 * feature must have a ledger, the id must be an open ask, a live requirement or an
 * unplaced message, and the verbs that record a reason must carry one. What a click could
 * not get wrong, a session can — the id is the usual slip.
 */
async function answerFor(
  d: z.infer<typeof decisionInput>,
  sources: DecisionSources
): Promise<ProposeDecisionOutput> {
  const need = NEEDS_REASON[d.verb];
  if (need && !d.reason?.trim()) {
    return { error: `${d.verb}: ${need}`, ok: false };
  }
  if (d.verb === "place") {
    const entry = (await sources.unplaced()).find((u) => u.id === d.id);
    if (!entry) {
      return {
        error: `"${d.id}" is not in the unplaced list — read state/unplaced.json for the id`,
        ok: false,
      };
    }
    const ledgers = await sources.ledgers();
    if (!ledgers.some((l) => l.dir === d.feature)) {
      return {
        error: `"${d.feature}" has no ledger — name a feature directory such as admin/usage`,
        ok: false,
      };
    }
    return {
      note: PROPOSAL_NOTE,
      ok: true,
      proposal: {
        feature: d.feature,
        id: d.id,
        subject: entry.text.slice(0, 200),
        verb: "place",
      },
    };
  }
  const ref = (await sources.ledgers()).find((l) => l.dir === d.feature);
  if (!ref) {
    return {
      error: `"${d.feature}" has no ledger — name a feature directory such as admin/usage`,
      ok: false,
    };
  }
  if (d.verb === "close") {
    const ask = ref.ledger.asks.find((a) => a.id === d.id);
    if (!ask) {
      return {
        error: `${d.feature} has no ask ${d.id} — read its ledger.json for the ids`,
        ok: false,
      };
    }
    if (ask.status === "closed" || ask.status === "dropped") {
      return { error: `${d.id} is already ${ask.status}`, ok: false };
    }
    return {
      note: PROPOSAL_NOTE,
      ok: true,
      proposal: {
        feature: d.feature,
        id: d.id,
        reason: d.reason,
        subject: ask.text,
        verb: "close",
      },
    };
  }
  const req = ref.ledger.requirements.find((r) => r.id === d.id);
  if (!req) {
    return {
      error: `${d.feature} has no requirement ${d.id} — read its ledger.json for the ids`,
      ok: false,
    };
  }
  const target = d.verb === "confirm" ? "confirmed" : "contradicted";
  if (req.status === target) {
    return { error: `${d.id} is already ${target}`, ok: false };
  }
  return {
    note: PROPOSAL_NOTE,
    ok: true,
    proposal: {
      feature: d.feature,
      id: d.id,
      reason: d.reason,
      subject: req.text,
      verb: d.verb,
    },
  };
}

/**
 * The tool. It never writes: it checks and answers a proposal, and the card the chat
 * renders from the part is where the click lands. The log line is the only trace of the
 * call, since the run itself happens inside the harness.
 */
export async function proposeDecision(
  args: unknown,
  context: AskToolContext = {},
  sources: DecisionSources = decisionSources()
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
  console.log(
    `[ask] propose_decision ${d.verb} ${d.feature} ${d.id}${where} · ${answer.ok ? "proposed" : `refused: ${answer.error}`}`
  );
  return answer;
}

/**
 * The definition `chat({ tools })` takes. `@tanstack/ai` converts the Zod schema to JSON
 * Schema before the adapter sees it, which is what the bridge advertises over MCP.
 */
export const proposeDecisionTool = toolDefinition({
  description:
    'Propose one change to a feature\'s ledger for the user to confirm on a card: { verb: "close", feature, id: "A-n", reason } closes an ask; { verb: "confirm" | "contradict", feature, id: "R-n", reason } settles a requirement; { verb: "place", feature, id: "<message ts>" } puts an unplaced message on a feature. `feature` is the directory under features/, such as admin/usage. Nothing is written until the user confirms; never say it is done.',
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
  /** Omitted files on Alden, as before there was a second team (CTD-172). */
  team: z.string().optional(),
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
      team: draft.team.name,
      title: draft.title,
      verified: draft.project.verified,
      ...(draft.project.id ? { projectId: draft.project.id } : {}),
    },
  };
}

export const proposeTicketTool = toolDefinition({
  description:
    "Propose a new Linear issue for Liam to file. Takes a draft written per the linear-ticket skill — title under 80 characters, description the five-section body (Summary, Background, Scope / Out of Scope, Acceptance Criteria, Technical Notes, with Pending only between the last two), project a project name, and team only when the draft is about Pensieve, Argus or Foundry (team Citadel, project named after the app) — omit team for an alden-portal feature, which files on Alden as before. Checks it and answers a proposal that Pensieve shows as a card with a File button, or { ok: false, error } when the draft cannot be filed. It writes nothing: the issue exists only when Liam presses File, so never say the ticket has been filed or created. Call it once per ticket, for one plain issue — no sub-issues, blockers or labels.",
  inputSchema: ticketInput,
  name: PROPOSE_TICKET,
  outputSchema: ticketOutput,
}).server<AskToolContext>((args, { context }) =>
  proposeTicket(args, context ?? {})
);
