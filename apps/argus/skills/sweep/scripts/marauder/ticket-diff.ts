#!/usr/bin/env bun
/**
 * ticket-diff — what a tick's events make a Linear ticket say (ARG-159, over features since ARG-164).
 *
 * The old worker read the digest and patched a ticket message by message: it could not
 * reliably tell which ticket a thread concerned. A feature's record gives it the events
 * that concern the ticket and the questions still open on it, so the pass compares those
 * with the ticket's Pending and Technical Notes and makes the body match. What is settled
 * about the feature is its docs' business, not this file's: a fact reaches the docs through
 * a journal entry, never through a second record here.
 *
 * This file is pure and calls nothing: it takes a feature's record, the events this tick
 * brought it, and a ticket body, and returns the edits to apply, the things only a person
 * may decide, and the questions nobody has paired to a bullet yet. The worker holds the
 * Linear key and applies them; argus holds no key and never will.
 *
 * The write policy is the sweep's Autonomy section: verified facts edit the body in place,
 * inference is reported, and nothing here closes a ticket, ticks an acceptance criterion,
 * or writes a dated paragraph.
 */

import {
  USER,
  eventId,
  instantOf,
  type Milestones,
  type OpenQuestion,
  type Work,
  type WorkEvent,
} from "./record.ts";

/** the marker a claim carries in Pending until a landing on the base branch clears it */
export const UNVERIFIED = "announced on Slack, unverified against the base branch";

export type TicketState = {
  key: string;
  body: string;
  /** the Linear status name, as Linear spells it */
  state: string;
  /** a `sent` decision names this ticket, so Foundry is executing it */
  hasJob: boolean;
};

export type Edit =
  | { kind: "delete-pending"; old_string: string; why: string }
  | { kind: "add-pending"; text: string; why: string }
  | { kind: "add-note"; text: string; why: string }
  | { kind: "due-date"; value: string; why: string };

export type Flag = { why: string; detail: string };

export type TicketPlan = {
  ticket: string;
  edits: Edit[];
  flags: Flag[];
  /** Foundry is executing it, so nothing is applied and the diff goes to the reader */
  inFlight: boolean;
  /** open questions on this ticket that nobody has paired to a Pending bullet */
  unpaired: OpenQuestion[];
  /** questions this plan answers, to drop off the record once the edits land */
  resolves: string[];
  /** asks with no ticket anywhere on the feature's record, for the worker to file */
  fileAsks: { id: string; title: string; permalink?: string }[];
};

// ---------------------------------------------------------------- the body

const HEADING = /^##\s+(.+?)\s*$/;

/** one section of a house-format ticket, by the heading it starts with */
export function section(body: string, name: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l) && new RegExp(`^${name}\\b`, "i").test(l.match(HEADING)![1]!));
  if (start === -1) return [];
  let end = start + 1;
  while (end < lines.length && !HEADING.test(lines[end]!)) end++;
  return lines.slice(start + 1, end);
}

export const bullets = (lines: string[]) => lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.trim());

/** backticks and emphasis are formatting, so the same sentence reads the same either way */
const flat = (text: string) => text.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();
const says = (body: string, text: string) => flat(body).includes(flat(text));

/**
 * The body minus Pending. A claim's own bullet quotes the claim, and that bullet is what a
 * landing deletes — so it must not count as the body already saying the fact.
 */
export function withoutPending(body: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l) && /^Pending\b/i.test(l.match(HEADING)![1]!));
  if (start === -1) return body;
  let end = start + 1;
  while (end < lines.length && !HEADING.test(lines[end]!)) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

// ---------------------------------------------------------------- the action table

const backedBy = (w: Work, e: WorkEvent) =>
  w.events.some((x) => x.kind === "verified-landing" && (!e.side || x.side === e.side) && instantOf(x.at) >= instantOf(e.at));

/** the Pending bullet a claim leaves behind, carrying the reference that later clears it */
export const claimBullet = (e: WorkEvent) =>
  `- ${e.summary.replace(/\.$/, "")} (${eventId(e)}) — ${UNVERIFIED}`;

export type TicketInput = {
  work: Work;
  ticket: TicketState;
  /** the events this tick brought to the feature */
  events: WorkEvent[];
  milestones: Milestones;
};

/**
 * The whole pass for one ticket. Each event kind decides its own action, and the ones that
 * need a person — a close, an acceptance criterion, the ask itself — come back as flags
 * rather than edits.
 */
export function planTicket({ work: w, ticket, events, milestones }: TicketInput): TicketPlan {
  const edits: Edit[] = [];
  const flags: Flag[] = [];
  const resolves: string[] = [];
  const fileAsks: TicketPlan["fileAsks"] = [];
  const mine = events.filter((e) => !e.ticket || e.ticket === ticket.key);
  const pending = bullets(section(ticket.body, "Pending"));
  const settled = withoutPending(ticket.body);

  // an answered question deletes the bullet it was waiting on, and leaves the answer behind
  for (const e of mine.filter((x) => x.kind === "answers-question")) {
    for (const q of w.open_questions.filter((x) => x.ticket === ticket.key)) {
      const bullet = q.pending_ref && pending.find((b) => b === q.pending_ref || b.includes(q.pending_ref!));
      if (!bullet) continue;
      edits.push({ kind: "delete-pending", old_string: bullet, why: `${e.summary} answers it` });
      edits.push({ kind: "add-note", text: e.summary, why: `the answer to "${q.q}"` });
      resolves.push(q.q);
    }
  }

  // a claim is a claim until the branch says otherwise; a landing is what clears it
  for (const e of mine.filter((x) => x.kind === "contract-change" || x.kind === "claimed-landing")) {
    const bullet = claimBullet(e);
    if (backedBy(w, e)) {
      const stale = pending.find((b) => b.includes(`(${eventId(e)})`) && b.includes(UNVERIFIED));
      if (stale) edits.push({ kind: "delete-pending", old_string: stale, why: "a landing on the base branch backs it now" });
      if (!says(settled, e.summary)) edits.push({ kind: "add-note", text: e.summary, why: "verified against the base branch" });
    } else if (!pending.some((b) => b.includes(`(${eventId(e)})`))) {
      edits.push({ kind: "add-pending", text: bullet, why: "nothing on the base branch backs it yet" });
    }
  }

  for (const e of mine.filter((x) => x.kind === "verified-landing")) {
    const stale = pending.find((b) => b.includes(UNVERIFIED) && (b.includes(`(${eventId(e)})`) || (e.ticket === ticket.key && b.includes(String(e.side)))));
    if (stale) edits.push({ kind: "delete-pending", old_string: stale, why: `${eventId(e)} is on the base branch` });
  }

  // a date the team set is the ticket's due date, and nothing else about the ticket moves
  for (const e of mine.filter((x) => x.kind === "deadline")) {
    const stone = w.milestone ? milestones[w.milestone] : undefined;
    if (stone) edits.push({ kind: "due-date", value: stone.date, why: `${e.summary}` });
  }

  // an ask with no ticket anywhere on the record is a ticket to file, titled in its own words
  if (!w.keys.tickets.length)
    for (const e of mine.filter((x) => x.kind === "new-ask" && !x.ticket))
      fileAsks.push({ id: eventId(e), title: e.summary.replace(/\.$/, ""), ...(e.source?.url ? { permalink: e.source.url } : {}) });

  for (const q of w.open_questions.filter((x) => x.ticket === ticket.key && !x.pending_ref))
    flags.push({ why: "no Pending bullet is paired with this question yet", detail: q.q });

  const inFlight = /in progress/i.test(ticket.state) && ticket.hasJob;
  if (inFlight)
    flags.push({ why: `${ticket.key} is being executed, so nothing was applied`, detail: `${edits.length} edit(s) held` });

  return {
    ticket: ticket.key,
    edits: dedupe(edits),
    flags,
    inFlight,
    unpaired: w.open_questions.filter((x) => x.ticket === ticket.key && !x.pending_ref),
    resolves: [...new Set(resolves)],
    fileAsks,
  };
}

const dedupe = (edits: Edit[]) => {
  const seen = new Set<string>();
  return edits.filter((e) => {
    const k = JSON.stringify(e);
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

// ---------------------------------------------------------------- what the record records back

/** the event a held ticket leaves for the reader, with the diff nobody applied */
export const heldEvent = (plan: TicketPlan, at: string): WorkEvent => ({
  at,
  kind: "directed-at-person",
  summary: `Foundry is running ${plan.ticket}, so ${plan.edits.length} edit${plan.edits.length === 1 ? "" : "s"} to it are waiting on you.`,
  to: [USER.token],
  source: { type: "ticket", ref: plan.ticket, url: `https://linear.app/liamai/issue/${plan.ticket}` },
  attached: { how: "ref", confidence: "certain" },
  ticket: plan.ticket,
  action: plan.edits.map((e) => `${e.kind}: ${"text" in e ? e.text : "old_string" in e ? e.old_string : e.value}`).join(" · "),
});

/** what the worker prints for the reader of a tick */
export function formatPlan(plan: TicketPlan): string {
  const out = [`## ${plan.ticket}${plan.inFlight ? " — held, Foundry is running it" : ""}`];
  for (const e of plan.edits) out.push(`   ${e.kind.padEnd(15)} ${"text" in e ? e.text : "old_string" in e ? e.old_string : e.value}\n     why: ${e.why}`);
  for (const f of plan.flags) out.push(`   needs you       ${f.why}\n     ${f.detail}`);
  for (const a of plan.fileAsks) out.push(`   file a ticket   ${a.title} (${a.id})`);
  if (plan.edits.length + plan.flags.length + plan.fileAsks.length === 0) out.push("   nothing to do");
  return out.join("\n");
}
