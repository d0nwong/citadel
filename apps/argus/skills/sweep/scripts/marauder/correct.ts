#!/usr/bin/env bun
/**
 * The corrections (LIA-158) — fixing what ingest got wrong, once.
 *
 * Accuracy here comes from accretion, not from a better classifier. When a person moves an
 * item onto the workstream it belongs to, they are making the one judgment that matters,
 * and the correction has to leave a rule behind: the thread root, so every later reply
 * attaches on its own; the identifiers, so the next message naming that field attaches;
 * the person, as a tiebreaker. Without that, the same thread is judged again on every
 * reply.
 *
 *   marauder attach <id> <slug>    move an unsorted item onto a workstream, and learn from it
 *   marauder suggest <id> <slug>   leave it unsorted, but say where it probably goes
 *   marauder new <id> --name       open a workstream from a proposal
 *   marauder dismiss <id> --reason drop an unsorted item that goes nowhere
 *   marauder split <slug> --into   cut one workstream in two
 *   marauder stage <slug> fe|be    say where a side really is, and why
 *   marauder propose-split <slug>  queue a split for a person to accept
 *
 * Every verb is a pure function of the loaded records, so the command does the reading and
 * writing and nothing here runs git. Every verb is idempotent: a correction already applied
 * changes no file. And no verb here calls a model — `check` prints, a reader judges,
 * `propose-split` writes what they judged.
 */

import { slug as slugify } from "../points.ts";
import { identifiers, tokenIn } from "./ingest-slack.ts";
import {
  USER,
  eventId,
  eventKeys,
  instantOf,
  type EventKind,
  type Milestones,
  type Side,
  type Stage,
  type UnsortedItem,
  type Workstream,
  type WorkstreamEvent,
} from "./record.ts";

export type State = { workstreams: Workstream[]; unsorted: UnsortedItem[]; milestones: Milestones };
export type Result = { state: State; changed: boolean; notes: string[] };

export type Who = { by: string; reason?: string; at: string };

const unchanged = (state: State, why: string): Result => ({ state, changed: false, notes: [why] });
const clone = (state: State): State => structuredClone(state);
const byAt = (a: { at: string }, b: { at: string }) => instantOf(a.at).localeCompare(instantOf(b.at));

// ---------------------------------------------------------------- learning from an item

const THREAD_IN_URL = /[?&]thread_ts=([\d.]+)/;
const TICKET = /\b(LIA-\d+)\b/gi;
const PR_REF = /\b((?:fe|be)#\d+)\b/gi;

export type Learned = { threads: string[]; tickets: string[]; prs: string[]; vocab: string[]; people: string[] };

/** everything about an item that would let the next one like it attach without a person */
export function learn(item: UnsortedItem): Learned {
  const text = item.text ?? item.summary;
  const ref = item.source?.ref ?? item.id;
  const isSlack = item.kind !== "landing" && !/^(fe|be)[#@]/.test(ref);
  const root = item.source?.url?.match(THREAD_IN_URL)?.[1] ?? (isSlack ? ref.split("#")[0]! : undefined);
  return {
    threads: root ? [root] : [],
    tickets: [...new Set([...text.matchAll(TICKET)].map((m) => m[1]!.toUpperCase()))],
    prs: [...new Set([...`${ref} ${text}`.matchAll(PR_REF)].map((m) => m[1]!.toLowerCase()))],
    vocab: identifiers(text),
    people: item.summary.match(/^([^:]{2,30}):/)?.[1]?.trim() && !item.summary.startsWith("You") ? [item.summary.split(":")[0]!.trim()] : [],
  };
}

/**
 * Fold what was learned into the workstream's keys. A token another workstream already
 * claims is left out and said out loud: adding it would make the vocabulary rung ambiguous
 * for both of them, which is worse than not learning it at all.
 */
function teach(w: Workstream, learned: Learned, others: Workstream[]): string[] {
  const notes: string[] = [];
  const add = (into: string[], values: string[], what: string, taken?: (v: string) => Workstream | undefined) => {
    for (const v of values) {
      if (into.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
      const owner = taken?.(v);
      if (owner) {
        notes.push(`${what} "${v}" is left out — ${owner.slug} already claims it`);
        continue;
      }
      into.push(v);
      notes.push(`learned ${what} ${v}`);
    }
  };
  add(w.keys.threads, learned.threads, "thread");
  add(w.keys.tickets, learned.tickets, "ticket");
  add(w.keys.prs, learned.prs, "PR");
  add(w.keys.vocab, learned.vocab, "vocabulary", (v) => others.find((o) => o.slug !== w.slug && o.keys.vocab.some((x) => x.toLowerCase() === v.toLowerCase())));
  add(w.keys.people, learned.people, "person");
  return notes;
}

const eventFrom = (item: UnsortedItem, kind: EventKind, how: "human" | "read", who: Who): WorkstreamEvent => ({
  at: item.at,
  kind,
  summary: item.summary,
  ...(item.source ? { source: item.source } : {}),
  attached: how === "human" ? { how, confidence: "certain", by: who.by } : { how, confidence: "guess" },
  ...(who.reason ? { action: who.reason } : {}),
});

// ---------------------------------------------------------------- attach

export type AttachOpts = Who & { kind?: EventKind; auto?: boolean };

/** move an unsorted item onto a workstream, and learn enough that the next one attaches itself */
export function attach(state: State, id: string, slug: string, opts: AttachOpts): Result {
  const next = clone(state);
  const item = next.unsorted.find((u) => u.id === id);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  if (!item) {
    const holder = next.workstreams.find((x) => x.events.some((e) => eventId(e) === id));
    return holder
      ? unchanged(state, `${id} is already on ${holder.slug}`)
      : unchanged(state, `nothing unsorted is called ${id}`);
  }
  if (w.events.some((e) => eventId(e) === id)) {
    next.unsorted = next.unsorted.filter((u) => u.id !== id);
    return { state: next, changed: true, notes: [`${id} was already on ${slug}; dropped it from the queue`] };
  }

  const kind = opts.kind ?? (item.kind === "new" ? "new-ask" : "contract-change");
  w.events = [...w.events, eventFrom(item, kind, opts.auto ? "read" : "human", opts)].sort(byAt);
  w.updated = instantOf(item.at) > instantOf(w.updated) ? item.at : w.updated;
  const notes = teach(w, learn(item), next.workstreams);
  next.unsorted = next.unsorted.filter((u) => u.id !== id);
  return { state: next, changed: true, notes: [`${id} → ${slug} as ${kind}`, ...notes] };
}

/** leave it in the queue, but say where it probably goes */
export function suggest(state: State, id: string, slug: string): Result {
  const next = clone(state);
  const item = next.unsorted.find((u) => u.id === id);
  if (!item) return unchanged(state, `nothing unsorted is called ${id}`);
  if (!next.workstreams.some((x) => x.slug === slug)) return unchanged(state, `there is no workstream ${slug}`);
  if (item.suggest === slug) return unchanged(state, `${id} already suggests ${slug}`);
  item.suggest = slug;
  return { state: next, changed: true, notes: [`${id} suggests ${slug}`] };
}

// ---------------------------------------------------------------- dismiss

/**
 * Drop an item that belongs on no workstream — chat, a duplicate, a question already
 * answered in its thread. The reason is required, because the item leaves the queue and the
 * reason is then the only record of why it is nowhere.
 *
 * Nothing is learned from a dismissal. A rule taught here would attach the next message
 * like this one to a workstream, and the judgment just made was that there is no such
 * workstream.
 */
export function dismiss(state: State, id: string, opts: Who): Result {
  const reason = opts.reason?.trim();
  if (!reason) return unchanged(state, `dismissing ${id} needs a reason`);
  const next = clone(state);
  if (!next.unsorted.some((u) => u.id === id)) return unchanged(state, `nothing unsorted is called ${id}`);
  next.unsorted = next.unsorted.filter((u) => u.id !== id);
  return { state: next, changed: true, notes: [`${id} dismissed — ${reason}`] };
}

// ---------------------------------------------------------------- new

export type NewOpts = Who & { name: string; features?: string[]; driver?: string; slug?: string };

/** open a workstream from a proposal, with the item that proposed it as its first event */
export function newFrom(state: State, id: string, opts: NewOpts): Result {
  const next = clone(state);
  const item = next.unsorted.find((u) => u.id === id);
  const slug = opts.slug ?? slugify(opts.name);
  if (next.workstreams.some((w) => w.slug === slug)) {
    if (!item) return unchanged(state, `${slug} already exists`);
    return attach(state, id, slug, { ...opts, kind: "new-ask" });
  }
  if (!item) return unchanged(state, `nothing unsorted is called ${id}`);

  const kind: EventKind = item.kind === "new" ? "new-ask" : "contract-change";
  const w: Workstream = {
    slug,
    name: opts.name,
    features: opts.features ?? item.features ?? [],
    ...(opts.driver ? { driver: opts.driver } : {}),
    wants: [],
    done: `${opts.name} — say here what done means, in one sentence.`,
    stage: { fe: kind === "new-ask" ? "asked" : "decided" },
    overlay: null,
    parked: false,
    milestone: null,
    keys: { tickets: [], prs: [], threads: [], vocab: [], people: [] },
    open_questions: [],
    facts: [],
    events: [eventFrom(item, kind, "human", opts)],
    opened: item.at.slice(0, 10),
    updated: item.at,
  };
  const notes = teach(w, learn(item), next.workstreams);
  next.workstreams = [...next.workstreams, w];
  next.unsorted = next.unsorted.filter((u) => u.id !== id);
  return { state: next, changed: true, notes: [`opened ${slug}`, ...notes] };
}

// ---------------------------------------------------------------- split

export type SplitOpts = Who & { into: string; name: string; events: string[] };

/** cut one workstream in two, taking the keys that only the moved events brought with them */
export function split(state: State, slug: string, opts: SplitOpts): Result {
  const next = clone(state);
  const from = next.workstreams.find((w) => w.slug === slug);
  if (!from) return unchanged(state, `there is no workstream ${slug}`);
  if (next.workstreams.some((w) => w.slug === opts.into)) return unchanged(state, `${opts.into} already exists`);

  const wanted = new Set(opts.events);
  const ids = eventKeys(from);
  const moving = from.events.filter((_, i) => wanted.has(ids[i]!));
  if (!moving.length) return unchanged(state, `none of those events is on ${slug}`);
  const staying = from.events.filter((_, i) => !wanted.has(ids[i]!));
  if (!staying.length) return unchanged(state, `that would move every event, which is a rename, not a split`);

  const refsOf = (events: WorkstreamEvent[]) => new Set(events.flatMap((e) => [e.source?.ref, e.ticket].filter(Boolean) as string[]));
  const movedRefs = refsOf(moving);
  const keptRefs = refsOf(staying);
  const onlyMoved = (k: string) => movedRefs.has(k) && !keptRefs.has(k);
  const movedText = moving.map((e) => e.summary).join(" ");

  const into: Workstream = {
    slug: opts.into,
    name: opts.name,
    features: [...from.features],
    ...(from.driver ? { driver: from.driver } : {}),
    wants: [...from.wants],
    done: `${opts.name} — say here what done means, in one sentence.`,
    stage: { ...from.stage },
    overlay: null,
    parked: false,
    milestone: from.milestone ?? null,
    keys: {
      tickets: from.keys.tickets.filter(onlyMoved),
      prs: from.keys.prs.filter(onlyMoved),
      threads: from.keys.threads.filter((t) => moving.some((e) => e.source?.ref?.startsWith(t))),
      vocab: from.keys.vocab.filter((v) => tokenIn(movedText, v)),
      people: [...from.keys.people],
    },
    open_questions: [],
    facts: [],
    events: [...moving, note(`Split out of ${from.name}.`, opts, moving.at(-1)!.at)].sort(byAt),
    opened: moving[0]!.at.slice(0, 10),
    updated: moving.at(-1)!.at,
  };

  from.events = [...staying, note(`Split ${opts.name} out of this.`, opts, opts.at)].sort(byAt);
  from.keys = {
    tickets: from.keys.tickets.filter((k) => !into.keys.tickets.includes(k)),
    prs: from.keys.prs.filter((k) => !into.keys.prs.includes(k)),
    threads: from.keys.threads.filter((k) => !into.keys.threads.includes(k)),
    vocab: from.keys.vocab.filter((k) => !into.keys.vocab.includes(k)),
    people: from.keys.people,
  };
  from.updated = opts.at;
  next.workstreams = [...next.workstreams, into];
  next.unsorted = next.unsorted.filter((u) => !(u.kind === "split" && u.slug === slug));
  return { state: next, changed: true, notes: [`${moving.length} events moved to ${opts.into}`] };
}

const note = (summary: string, who: Who, at: string): WorkstreamEvent => ({
  at,
  kind: "chat",
  summary,
  attached: { how: "human", confidence: "certain", by: who.by },
  ...(who.reason ? { action: who.reason } : {}),
});

// ---------------------------------------------------------------- stage

/** say where a side really is, over what a landing implied, and say why */
export function setStage(state: State, slug: string, side: Side, stage: Stage, who: Who): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  if (w.stage[side] === stage) return unchanged(state, `${slug} already has ${side} at ${stage}`);
  w.stage[side] = stage;
  w.events = [...w.events, { ...note(`${who.reason ?? `${who.by} set the ${side === "fe" ? "frontend" : "backend"} to ${stage}.`}`, who, who.at), side, action: `stage ${side} → ${stage}` }].sort(byAt);
  w.updated = who.at;
  return { state: next, changed: true, notes: [`${slug} ${side} → ${stage}`] };
}

// ---------------------------------------------------------------- propose a split

export type Group = { name: string; events: string[] };

/** queue a split for a person to accept; nothing here ever cuts a workstream on its own */
export function proposeSplit(state: State, slug: string, groups: Group[], who: Who): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  if (groups.length < 2) return unchanged(state, "a split needs at least two groupings");
  if (next.unsorted.some((u) => u.kind === "split" && u.slug === slug)) return unchanged(state, `${slug} already has a split waiting`);
  next.unsorted = [
    ...next.unsorted,
    {
      id: `split/${slug}`,
      kind: "split",
      slug,
      summary: `${w.name} reads as ${groups.length} separate things: ${groups.map((g) => g.name).join("; ")}.`,
      groups,
      candidates: [],
      ...(who.reason ? { why: who.reason } : {}),
      suggest: null,
      needs: "ask",
      at: who.at,
    },
  ].sort(byAt);
  return { state: next, changed: true, notes: [`proposed a split of ${slug} into ${groups.length}`] };
}

export const defaultWho = (reason?: string, at = new Date().toISOString()): Who => ({ by: USER.name, reason, at });

// ---------------------------------------------------------------- what the ticket pass writes back

/**
 * Pair an open question with the Pending bullet it is waiting on. Stored once, so the
 * deletion later is an exact string rather than a second reading of the same two texts.
 */
export function pairPending(state: State, slug: string, question: string, bullet: string): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  const q = w.open_questions.find((x) => x.q === question || x.q.startsWith(question));
  if (!q) return unchanged(state, `${slug} has no open question like "${question}"`);
  if (q.pending_ref === bullet) return unchanged(state, "that pairing is already recorded");
  q.pending_ref = bullet;
  return { state: next, changed: true, notes: [`paired "${q.q.slice(0, 40)}…" with ${bullet.slice(0, 50)}`] };
}

/**
 * The question is answered: it comes off the record, and the event that answered it says
 * what it did to the ticket. A bullet is never left annotated — a kept bullet reads as
 * still open, which is the failure this replaces.
 */
export function resolveQuestion(state: State, slug: string, question: string, ticket: string, who: Who): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  const before = w.open_questions.length;
  w.open_questions = w.open_questions.filter((x) => !(x.q === question || x.q.startsWith(question)));
  if (w.open_questions.length === before) return unchanged(state, `${slug} has no open question like "${question}"`);
  const answered = [...w.events].reverse().find((e) => e.kind === "answers-question" && (!e.ticket || e.ticket === ticket));
  if (answered) answered.action = `pending deleted on ${ticket}`;
  w.updated = who.at;
  return { state: next, changed: true, notes: [`${slug}: answered, and the bullet on ${ticket} is gone`] };
}

/** a filed ticket belongs to the ask that caused it and to the workstream it is on */
export function recordTicket(state: State, slug: string, id: string, ticket: string): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  const ids = eventKeys(w);
  const i = ids.indexOf(id);
  const already = w.keys.tickets.includes(ticket) && (i === -1 || w.events[i]!.ticket === ticket);
  if (already) return unchanged(state, `${ticket} is already on ${slug}`);
  if (i !== -1) w.events[i]!.ticket = ticket;
  if (!w.keys.tickets.includes(ticket)) w.keys.tickets.push(ticket);
  return { state: next, changed: true, notes: [`${ticket} recorded on ${slug}`] };
}

/** a ticket Foundry is running gets no edit; the diff waits for the reader instead */
export function recordHeld(state: State, slug: string, event: WorkstreamEvent): Result {
  const next = clone(state);
  const w = next.workstreams.find((x) => x.slug === slug);
  if (!w) return unchanged(state, `there is no workstream ${slug}`);
  if (w.events.some((e) => e.kind === "directed-at-person" && e.ticket === event.ticket && e.action === event.action))
    return unchanged(state, `${slug} already says those edits are waiting on you`);
  w.events = [...w.events, event].sort(byAt);
  w.updated = event.at;
  return { state: next, changed: true, notes: [`${slug}: ${event.ticket} is held, and the diff is on the board`] };
}
