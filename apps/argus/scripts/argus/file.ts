/**
 * `argus file <feature> <P-n>`: the ticket a proposal would become, as data. The reader
 * wrote the proposal's title and body in the house format; this adds where it goes: the
 * Alden team, and the project named after the feature when the team has one ("admin/usage"
 * is "Admin - Usage"). Pensieve files it through Linear and then runs `argus ticket` with
 * the key. Nothing here writes.
 */

import type { Ask, Ledger } from "./schema.ts";
import { readLedger } from "./write.ts";

export const TEAM_KEY = "ALD";

const word = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** `admin/usage` -> `Admin - Usage`, `meetings` -> `Meetings`, `entities-meetings` -> `Entities Meetings` */
export const projectNameFor = (feature: string): string =>
  feature
    .split("/")
    .map((part) => part.split("-").map(word).join(" "))
    .join(" - ");

export type Draft = {
  feature: string;
  proposal: string;
  title: string;
  body: string;
  asks: string[];
  team: string;
  project: string;
};

export async function draftFor(feature: string, proposalId: string): Promise<Draft> {
  const l = await readLedger(feature);
  if (!l) throw new Error(`${feature}: no ledger`);
  const p = l.proposals.find((x) => x.id === proposalId);
  if (!p) {
    const filed = l.tickets.find((t) => t.asks.some((a) => l.proposals.every((q) => !q.asks.includes(a))));
    throw new Error(`${feature}: no proposal ${proposalId}${filed ? "; it may already be filed" : ""}`);
  }
  return { feature, proposal: p.id, title: p.title, body: p.body, asks: p.asks, team: TEAM_KEY, project: projectNameFor(feature) };
}

const TITLE_MAX = 80;

/** `[FE]` unless the ask reads as backend work */
const tag = (a: Ask) => (/\b(api|endpoint|route|backend|server|swagger|migration|prisma)\b/i.test(a.text) ? "[BE]" : "[FE]");

/** the house-format body a person can file now and fill later, written from the ask and its trail */
export function bodyForAsk(l: Ledger, a: Ask): string {
  const origin = a.origin.kind === "ticket" ? `Linear ${a.origin.key}` : `[the thread](${a.origin.url})`;
  const trail = a.history.map((h) => `- ${h.at}: ${h.status}`).join("\n");
  const pending = (a.blockers ?? []).filter((b) => !b.cleared).map((b) =>
    b.kind === "landing" ? `- ${b.ref || "a backend PR"} on ${b.branch}, deployed` : b.kind === "answer" ? `- ${b.from}: ${b.question}` : `- ${b.key} done`,
  );
  const rules = (a.requirements ?? []).map((id) => l.requirements.find((r) => r.id === id)).filter(Boolean).map((r) => `- ${r!.text}`);
  return [
    "## Summary", "", a.text, "",
    "## Background", "", `${a.by} asked on ${a.at}, in ${origin}.${rules.length ? " Rules it touches:" : ""}`, ...(rules.length ? ["", ...rules] : []), ...(trail ? ["", "What has happened since:", "", trail] : []), "",
    "## Scope / Out of Scope", "", "In scope:", "", "- To fill: the surface or file that changes", "", "Out of scope:", "", "- To fill", "",
    "## Acceptance Criteria", "", "- [ ] To fill: one observable outcome per line", "",
    ...(pending.length ? ["## Pending", "", ...pending, ""] : []),
    "## Technical Notes", "", "- To fill: file and function at the ledger's sha", "",
  ].join("\n");
}

/** the ticket an ask would become, with no proposal in between */
export async function draftForAsk(feature: string, askId: string): Promise<Draft> {
  const l = await readLedger(feature);
  if (!l) throw new Error(`${feature}: no ledger`);
  const a = l.asks.find((x) => x.id === askId);
  if (!a) throw new Error(`${feature}: no ask ${askId}`);
  if (a.ticket) throw new Error(`${askId} already has ${a.ticket}`);
  const raw = `${tag(a)} ${a.text.replace(/[.!?]+$/, "")}`;
  const title = raw.length > TITLE_MAX ? `${raw.slice(0, TITLE_MAX - 1).trimEnd()}…` : raw;
  return { feature, proposal: a.id, title, body: bodyForAsk(l, a), asks: [a.id], team: TEAM_KEY, project: projectNameFor(feature) };
}
