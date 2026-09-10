#!/usr/bin/env bun
/**
 * marauder huddle <ts> --points <file> — a meeting, read, becomes its key points.
 *
 * A huddle canvas is a meeting, not a message, and a meeting is read, not split. The
 * sweep reads the notes and writes down what the meeting settled, asked for or dated —
 * one sentence per thing, in the team's own words, each with the workstream it belongs
 * to when the reader would bet on it. This verb takes that reading and records it. It
 * never calls a model and never opens a workstream: a point that belongs nowhere is a
 * proposal in the queue, and small talk is not recorded at all.
 *
 * A second reading of the same notes replaces the first: every point recorded under that
 * huddle goes unless a person placed it. That is what makes a re-read safe, and what
 * clears a queue an older, bullet-by-bullet split left behind.
 */

import { CONFIDENCE, UNREAD_CANVAS, slackCandidates, type SlackItem } from "./ingest-slack.ts";
import { learn, teach, type Result, type State, type Who } from "./correct.ts";
import { checkStyle, whenLabel } from "./render.ts";
import {
  EVENT_KINDS,
  instantOf,
  serializeWorkstream,
  slug as slugify,
  type EventKind,
  type UnsortedItem,
  type Workstream,
  type WorkstreamEvent,
} from "./record.ts";

/** one thing the meeting settled, asked for or dated, as the reader wrote it down */
export type Point = {
  kind: EventKind;
  /** the open workstream it belongs to; null when the reader would not bet on one */
  slug?: string | null;
  /** the sentence, in the house voice — a person does something, about twenty words: the page adds the date in front */
  summary: string;
  /** who an ask is aimed at; `you` is the reader */
  to?: string[];
  /** why it belongs where it was put, in one clause */
  why?: string;
  /** the bullet(s) it came from, verbatim, so a correction can learn their vocabulary */
  text?: string;
  /** a deadline's name and owner; a slug-less decision or ask's proposed workstream name */
  name?: string;
  date?: string;
  owner?: string;
};

export type Notes = { url?: string; points: Point[] };

export const NOTHING_TO_RECORD = "the huddle notes say nothing about the work — dismiss them";

const isoOf = (ts: string) => new Date(Number(ts) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** everything wrong with the reading, named by point; an empty list means it can be recorded */
export function validatePoints(notes: Notes, workstreams: Workstream[], ts = "0"): string[] {
  const out: string[] = [];
  // the page prints the sentence after its date, and the ceiling is on the printed line
  const asPrinted = (summary: string) => `**${whenLabel(isoOf(ts))}** — ${summary}`;
  if (!Array.isArray(notes.points)) return ["the file has no points array"];
  notes.points.forEach((p, i) => {
    const at = `point ${i + 1}`;
    if (!EVENT_KINDS.includes(p.kind)) out.push(`${at}: "${p.kind}" is not a kind (${EVENT_KINDS.join(", ")})`);
    if (typeof p.summary !== "string" || !p.summary.trim()) out.push(`${at}: has no summary`);
    else {
      if (/slackbot/i.test(p.summary)) out.push(`${at}: names Slackbot, and a person said this`);
      if (!/[.!?]$/.test(p.summary.trim())) out.push(`${at}: the summary is not a sentence — it needs a full stop`);
      for (const s of checkStyle(p.summary)) if (!/ceiling/.test(s.rule)) out.push(`${at}: ${s.rule}`);
      for (const s of checkStyle(asPrinted(p.summary))) if (/ceiling/.test(s.rule)) out.push(`${at}: ${s.rule} once the page puts the date in front`);
    }
    if (p.slug) {
      const w = workstreams.find((x) => x.slug === p.slug);
      if (!w) out.push(`${at}: there is no workstream ${p.slug}`);
      else if (w.parked) out.push(`${at}: ${p.slug} is parked`);
    }
    if (p.kind === "deadline") {
      if (!p.date || !DATE.test(p.date)) out.push(`${at}: a deadline needs a date as YYYY-MM-DD`);
      if (!p.owner) out.push(`${at}: a deadline needs an owner`);
      if (!p.name) out.push(`${at}: a deadline needs a name (Launch, Demo, …)`);
    }
    if (p.to && (!Array.isArray(p.to) || p.to.some((t) => typeof t !== "string"))) out.push(`${at}: "to" must be a list of names`);
  });
  return out;
}

const isHolder = (u: UnsortedItem, ts: string) =>
  u.id === ts ||
  u.id.startsWith(`${ts}#`) ||
  (u.why?.startsWith(UNREAD_CANVAS) === true && (u.source?.url ?? "").includes(`thread_ts=${ts}`));

const proposedName = (summary: string) => {
  const s = words(summary.replace(/[.!?]+$/, "")).slice(0, 10).join(" ");
  return s[0]!.toUpperCase() + s.slice(1);
};

/** the meeting's key points onto the record: events, proposals, milestones — and nothing for chat */
export function applyHuddle(state: State, ts: string, notes: Notes, who: Who): Result {
  const problems = validatePoints(notes, state.workstreams, ts);
  if (problems.length) throw new Error(`the points cannot be recorded as written\n${problems.map((p) => `  ${p}`).join("\n")}`);

  const next = structuredClone(state);
  const notesOf = (s: State) => `${s.workstreams.map(serializeWorkstream).join("\n")}\n${JSON.stringify(s.unsorted)}\n${JSON.stringify(s.milestones)}`;
  const before = notesOf(next);
  const lines: string[] = [];
  const at = isoOf(ts);
  const url = notes.url ?? state.unsorted.find((u) => isHolder(u, ts))?.source?.url;
  const isPoint = (ref?: string) => ref?.startsWith(`${ts}#`) === true;

  // the reading before this one goes — every point under these notes that a person did
  // not place themselves; an event on the notes as a whole was never a point, and stays
  for (const w of next.workstreams) {
    const kept = w.events.filter((e) => !(isPoint(e.source?.ref) && e.attached.how !== "human"));
    if (kept.length !== w.events.length) lines.push(`${w.slug}: ${w.events.length - kept.length} earlier reading(s) of these notes replaced`);
    w.events = kept;
  }
  const holders = next.unsorted.filter((u) => isHolder(u, ts));
  next.unsorted = next.unsorted.filter((u) => !isHolder(u, ts));

  let recorded = 0;
  notes.points.forEach((p, i) => {
    const id = `${ts}#${i + 1}`;
    if (p.kind === "chat") {
      lines.push(`${id} — not about the work, not recorded`);
      return;
    }
    const source = { type: "huddle" as const, ref: id, ...(url ? { url } : {}) };
    const item: SlackItem = { id, ts, at, author: "", authorIsUser: false, mentionsUser: false, to: p.to ?? [], text: p.text ?? p.summary, permalink: url ?? "", day: at.slice(0, 10) };

    let action: string | undefined = p.why;
    if (p.kind === "deadline") {
      const slug = `${slugify(p.name!)}-${p.date!}`;
      if (!next.milestones[slug]) {
        next.milestones[slug] = { name: p.name!, date: p.date!, owner: p.owner! };
        lines.push(`${id} → milestone ${slug}`);
      }
      action = `milestone ${slug}`;
      recorded++;
      if (!p.slug) return;
    }

    if (p.slug) {
      const w = next.workstreams.find((x) => x.slug === p.slug)!;
      // the ladder's own answer outranks the reader's guess only when the two agree
      const ladder = slackCandidates(item, next.workstreams);
      const agreed = ladder.length === 1 && ladder[0]!.slug === p.slug ? ladder[0]! : null;
      const event: WorkstreamEvent = {
        at,
        kind: p.kind,
        summary: p.summary,
        ...(p.to?.length ? { to: p.to } : {}),
        source,
        attached: agreed ? { how: agreed.how, confidence: CONFIDENCE[agreed.how] } : { how: "read", confidence: "guess" },
        ...(action ? { action } : {}),
      };
      w.events = [...w.events, event].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at)));
      w.updated = instantOf(at) > instantOf(w.updated) ? at : w.updated;
      // the notes' thread, the tickets and the identifiers the point names — what `attach` would learn
      const learned = learn({ id, kind: "slack", summary: p.summary, text: p.text, source, candidates: [], suggest: null, at });
      lines.push(`${id} → ${p.slug} as ${p.kind} · ${event.attached.how}/${event.attached.confidence}`, ...teach(w, { ...learned, people: [] }, next.workstreams));
      recorded++;
      return;
    }

    const proposes = p.kind === "contract-change" || p.kind === "new-ask";
    const name = proposes ? (p.name ?? proposedName(p.summary)) : undefined;
    next.unsorted.push({
      id,
      kind: proposes ? "new" : "slack",
      summary: p.summary,
      ...(name ? { name } : {}),
      ...(p.text ? { text: p.text } : {}),
      ...(p.to?.length ? { to: p.to } : {}),
      source,
      candidates: [],
      why: p.why ?? "nothing claims it",
      suggest: null,
      needs: "read",
      at,
    });
    lines.push(proposes ? `${id} → proposed workstream "${name}"` : `${id} → unsorted · ${p.why ?? "nothing claims it"}`);
    recorded++;
  });

  // a meeting with nothing in it for the record is unusual enough to ask about
  if (!recorded && holders.length) {
    const holder = holders[0]!;
    next.unsorted.push({ ...holder, why: NOTHING_TO_RECORD, needs: "ask", candidates: [], suggest: null });
    lines.push(`${holder.id} stays in the queue — ${NOTHING_TO_RECORD}`);
  } else if (holders.length) lines.push(`${holders.length} queue entr${holders.length === 1 ? "y" : "ies"} for these notes cleared`);
  next.unsorted.sort((a, b) => a.at.localeCompare(b.at));

  const changed = notesOf(next) !== before;
  return { state: changed ? next : state, changed, notes: changed ? lines : ["these notes are already recorded exactly like this"] };
}

/** read the points file, refusing anything that is not the shape above */
export async function readNotes(path: string): Promise<Notes> {
  const f = Bun.file(path);
  if (!(await f.exists())) throw new Error(`no points file at ${path}`);
  const raw = (await f.json()) as unknown;
  if (Array.isArray(raw)) return { points: raw as Point[] };
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as Notes).points)) throw new Error(`${path} is not { url?, points: [...] }`);
  return raw as Notes;
}
