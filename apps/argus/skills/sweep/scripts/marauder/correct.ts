#!/usr/bin/env bun
/**
 * The corrections — fixing what ingest got wrong, once (ARG-158, over features since ARG-164).
 *
 * Accuracy here comes from accretion, not from a better classifier. When a person moves an
 * item onto the feature it belongs to, they are making the one judgment that matters, and
 * the correction has to leave a rule behind: the thread root, so every later reply attaches
 * on its own; the tickets and identifiers, so the next message naming them attaches.
 * Without that, the same thread is judged again on every reply.
 *
 *   marauder attach <id> <feature>   move an unsorted item onto a feature, and learn from it
 *   marauder suggest <id> <feature>  leave it unsorted, but say where it probably goes
 *   marauder dismiss <id> --reason   drop an unsorted item that goes nowhere
 *
 * A feature with nothing going on has no record yet; attaching to it opens one. Every verb
 * is a pure function of the loaded state, so the command does the reading and writing and
 * nothing here runs git. Every verb is idempotent: a correction already applied changes no
 * file. And no verb here calls a model.
 */

import { identifiers } from "./ingest-slack.ts";
import {
  USER,
  addEvent,
  emptyWork,
  eventId,
  eventKeys,
  type EventKind,
  type State,
  type UnsortedItem,
  type Work,
  type WorkEvent,
} from "./record.ts";

export type { State };
export type Result = { state: State; changed: boolean; notes: string[] };

export type Who = { by: string; reason?: string; at: string };

const unchanged = (state: State, why: string): Result => ({ state, changed: false, notes: [why] });
const clone = (state: State): State => structuredClone(state);

/** the features a verb may name: every one some app has, and every one with a record */
export const knownFeatures = (state: State): Set<string> =>
  new Set([...(state.features ?? []).map((f) => f.feature), ...state.work.map((w) => w.feature)]);

/**
 * The feature's record, opened when it had none. A name no app has a directory for is
 * refused — a record for a feature that does not exist is how the old workstreams drifted.
 */
export function recordFor(state: State, feature: string, at: string): Work | null {
  const w = state.work.find((x) => x.feature === feature);
  if (w) return w;
  if (!knownFeatures(state).has(feature)) return null;
  const made = emptyWork(feature, at);
  state.work = [...state.work, made];
  return made;
}

const noFeature = (feature: string) => `there is no feature ${feature} — name its directory under features/, e.g. admin/usage`;

// ---------------------------------------------------------------- learning from an item

const THREAD_IN_URL = /[?&]thread_ts=([\d.]+)/;
const TICKET = /\b((?:ARG|ALD)-\d+)\b/gi;
const PR_REF = /\b((?:fe|be)#\d+)\b/gi;

export type Learned = { threads: string[]; tickets: string[]; prs: string[]; vocab: string[] };

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
  };
}

/**
 * Fold what was learned into the record's keys. A token another feature already claims is
 * left out and said out loud: adding it would make the vocabulary rung ambiguous for both
 * of them, which is worse than not learning it at all.
 */
export function teach(w: Work, learned: Learned, others: Work[]): string[] {
  const notes: string[] = [];
  const add = (into: string[], values: string[], what: string, taken?: (v: string) => Work | undefined) => {
    for (const v of values) {
      if (into.some((x) => x.toLowerCase() === v.toLowerCase())) continue;
      const owner = taken?.(v);
      if (owner) {
        notes.push(`${what} "${v}" is left out — ${owner.feature} already claims it`);
        continue;
      }
      into.push(v);
      notes.push(`learned ${what} ${v}`);
    }
  };
  add(w.keys.threads, learned.threads, "thread");
  add(w.keys.tickets, learned.tickets, "ticket");
  add(w.keys.prs, learned.prs, "PR");
  add(w.keys.vocab, learned.vocab, "vocabulary", (v) => others.find((o) => o.feature !== w.feature && o.keys.vocab.some((x) => x.toLowerCase() === v.toLowerCase())));
  return notes;
}

const eventFrom = (item: UnsortedItem, kind: EventKind, how: "human" | "read", who: Who): WorkEvent => ({
  at: item.at,
  kind,
  summary: item.summary,
  ...(item.to?.length ? { to: item.to } : {}),
  ...(item.source ? { source: item.source } : {}),
  attached: how === "human" ? { how, confidence: "certain", by: who.by } : { how, confidence: "guess" },
  ...(who.reason ? { action: who.reason } : {}),
});

// ---------------------------------------------------------------- attach

export type AttachOpts = Who & { kind?: EventKind; auto?: boolean };

/** move an unsorted item onto a feature, and learn enough that the next one attaches itself */
export function attach(state: State, id: string, feature: string, opts: AttachOpts): Result {
  const next = clone(state);
  const item = next.unsorted.find((u) => u.id === id);
  if (!knownFeatures(next).has(feature)) return unchanged(state, noFeature(feature));
  if (!item) {
    const holder = next.work.find((x) => x.events.some((e) => eventId(e) === id));
    return holder
      ? unchanged(state, `${id} is already on ${holder.feature}`)
      : unchanged(state, `nothing unsorted is called ${id}`);
  }
  const w = recordFor(next, feature, item.at)!;
  if (w.events.some((e) => eventId(e) === id)) {
    next.unsorted = next.unsorted.filter((u) => u.id !== id);
    return { state: next, changed: true, notes: [`${id} was already on ${feature}; dropped it from the queue`] };
  }

  const kind = opts.kind ?? (item.to?.length ? "directed-at-person" : "contract-change");
  addEvent(w, eventFrom(item, kind, opts.auto ? "read" : "human", opts));
  const notes = teach(w, learn(item), next.work);
  next.unsorted = next.unsorted.filter((u) => u.id !== id);
  return { state: next, changed: true, notes: [`${id} → ${feature} as ${kind}`, ...notes] };
}

/** leave it in the queue, but say where it probably goes */
export function suggest(state: State, id: string, feature: string): Result {
  const next = clone(state);
  const item = next.unsorted.find((u) => u.id === id);
  if (!item) return unchanged(state, `nothing unsorted is called ${id}`);
  if (!knownFeatures(next).has(feature)) return unchanged(state, noFeature(feature));
  if (item.suggest === feature) return unchanged(state, `${id} already suggests ${feature}`);
  item.suggest = feature;
  return { state: next, changed: true, notes: [`${id} suggests ${feature}`] };
}

// ---------------------------------------------------------------- dismiss

/**
 * Drop an item that belongs to no feature — chat, a duplicate, a question already answered
 * in its thread. The reason is required, because the item leaves the queue and the reason
 * is then the only record of why it is nowhere.
 *
 * Nothing is learned from a dismissal. A rule taught here would attach the next message
 * like this one to a feature, and the judgment just made was that there is no such feature.
 */
export function dismiss(state: State, id: string, opts: Who): Result {
  const reason = opts.reason?.trim();
  if (!reason) return unchanged(state, `dismissing ${id} needs a reason`);
  const next = clone(state);
  if (!next.unsorted.some((u) => u.id === id)) return unchanged(state, `nothing unsorted is called ${id}`);
  next.unsorted = next.unsorted.filter((u) => u.id !== id);
  return { state: next, changed: true, notes: [`${id} dismissed — ${reason}`] };
}

export const defaultWho = (reason?: string, at = new Date().toISOString()): Who => ({ by: USER.name, reason, at });

// ---------------------------------------------------------------- what the ticket pass writes back

const onRecord = (state: State, feature: string) => state.work.find((x) => x.feature === feature);
const noRecord = (feature: string) => `${feature} has nothing going on, so there is nothing on its record to change`;

/**
 * Pair an open question with the Pending bullet it is waiting on. Stored once, so the
 * deletion later is an exact string rather than a second reading of the same two texts.
 */
export function pairPending(state: State, feature: string, question: string, bullet: string): Result {
  const next = clone(state);
  const w = onRecord(next, feature);
  if (!w) return unchanged(state, noRecord(feature));
  const q = w.open_questions.find((x) => x.q === question || x.q.startsWith(question));
  if (!q) return unchanged(state, `${feature} has no open question like "${question}"`);
  if (q.pending_ref === bullet) return unchanged(state, "that pairing is already recorded");
  q.pending_ref = bullet;
  return { state: next, changed: true, notes: [`paired "${q.q.slice(0, 40)}…" with ${bullet.slice(0, 50)}`] };
}

/**
 * The question is answered: it comes off the record, and the event that answered it says
 * what it did to the ticket. A bullet is never left annotated — a kept bullet reads as
 * still open, which is the failure this replaces.
 */
export function resolveQuestion(state: State, feature: string, question: string, ticket: string, who: Who): Result {
  const next = clone(state);
  const w = onRecord(next, feature);
  if (!w) return unchanged(state, noRecord(feature));
  const before = w.open_questions.length;
  w.open_questions = w.open_questions.filter((x) => !(x.q === question || x.q.startsWith(question)));
  if (w.open_questions.length === before) return unchanged(state, `${feature} has no open question like "${question}"`);
  const answered = [...w.events].reverse().find((e) => e.kind === "answers-question" && (!e.ticket || e.ticket === ticket));
  if (answered) answered.action = `pending deleted on ${ticket}`;
  w.updated = who.at;
  return { state: next, changed: true, notes: [`${feature}: answered, and the bullet on ${ticket} is gone`] };
}

/** the prefix a confirmation writes onto the event it confirms; the ticket pass reads it */
export const CONFIRMED = "confirmed:";

/**
 * The user saying yes to what one event asked them (ARG-161, for ARG-162's Verify button).
 *
 * A `directed-at-person` event is the one thing the loop computes and then refuses to
 * apply — a held edit on a ticket Foundry is running. The confirmation is the fact that
 * lifts that refusal for exactly the edit the event named, so it is stamped on the event
 * itself. Idempotent: a second confirmation of the same event changes nothing, which is
 * what makes replaying a decision file safe.
 */
export function confirmEvent(state: State, id: string, who: Who): Result {
  const next = clone(state);
  for (const w of next.work) {
    const i = eventKeys(w).indexOf(id);
    if (i === -1) continue;
    const e = w.events[i]!;
    if (e.action?.startsWith(CONFIRMED)) return unchanged(state, `${id} is already confirmed`);
    e.action = `${CONFIRMED} ${who.reason ?? "make the edit it named"} — ${who.by}`;
    w.updated = who.at;
    return { state: next, changed: true, notes: [`${w.feature}: ${who.by} confirmed ${id}`] };
  }
  return unchanged(state, `no event ${id} on any feature`);
}

/** a filed ticket belongs to the ask that caused it and to the feature it is on */
export function recordTicket(state: State, feature: string, id: string, ticket: string): Result {
  const next = clone(state);
  const w = onRecord(next, feature);
  if (!w) return unchanged(state, noRecord(feature));
  const ids = eventKeys(w);
  const i = ids.indexOf(id);
  const already = w.keys.tickets.includes(ticket) && (i === -1 || w.events[i]!.ticket === ticket);
  if (already) return unchanged(state, `${ticket} is already on ${feature}`);
  if (i !== -1) w.events[i]!.ticket = ticket;
  if (!w.keys.tickets.includes(ticket)) w.keys.tickets.push(ticket);
  return { state: next, changed: true, notes: [`${ticket} recorded on ${feature}`] };
}

/** a ticket Foundry is running gets no edit; the diff waits for the reader instead */
export function recordHeld(state: State, feature: string, event: WorkEvent): Result {
  const next = clone(state);
  const w = onRecord(next, feature);
  if (!w) return unchanged(state, noRecord(feature));
  if (w.events.some((e) => e.kind === "directed-at-person" && e.ticket === event.ticket && e.action === event.action))
    return unchanged(state, `${feature} already says those edits are waiting on you`);
  addEvent(w, event);
  w.updated = event.at;
  return { state: next, changed: true, notes: [`${feature}: ${event.ticket} is held, and the diff is on the board`] };
}
