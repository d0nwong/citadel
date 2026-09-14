/**
 * `argus file <feature> <P-n>`: the ticket a proposal would become, as data. The reader
 * wrote the proposal's title and body in the house format; this adds where it goes: the
 * Alden team, and the project named after the feature when the team has one ("admin/usage"
 * is "Admin - Usage"). Pensieve files it through Linear and then runs `argus ticket` with
 * the key. Nothing here writes.
 */

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

/**
 * the ticket an ask would become: the reader's proposal covering it, filed under the ask. An
 * ask with no proposal is refused — a body written from the ask alone is a stub nobody
 * researched, and Linear would take it as a finished ticket.
 */
export async function draftForAsk(feature: string, askId: string): Promise<Draft> {
  const l = await readLedger(feature);
  if (!l) throw new Error(`${feature}: no ledger`);
  const a = l.asks.find((x) => x.id === askId);
  if (!a) throw new Error(`${feature}: no ask ${askId}`);
  if (a.ticket) throw new Error(`${askId} already has ${a.ticket}`);
  const p = l.proposals.find((x) => x.asks.includes(askId));
  if (!p) throw new Error(`${askId} has no proposal yet; have the reader draft one before filing`);
  return { feature, proposal: a.id, title: p.title, body: p.body, asks: p.asks, team: TEAM_KEY, project: projectNameFor(feature) };
}
