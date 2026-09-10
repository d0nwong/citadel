/**
 * What both sides of the wire need to know about the map of the work (LIA-154/155) and
 * about the one thing Pensieve writes onto it: a decision on an Unsorted entry
 * (LIA-160).
 *
 * `<app>/features/<dir>/work.json` is argus's record (ARG-164) and the `board.md` pages are
 * rendered from it; both are the sweep's, and nothing here writes either. What this app writes is
 * `decisions/marauder/<id>.json`, which `marauder ingest` reads back, applies through its
 * correction functions and leaves in place as history.
 *
 * `server/decisions.ts` builds the file path from the id and is node-only; the Unsorted
 * page needs the same id rule to address a row and the same pre-flight refusals to keep a
 * click that cannot land from being made — so all of it lives here, where nothing
 * node-only is imported.
 */

/** The decision group that carries a verdict on an Unsorted entry rather than on a point. */
export const MARAUDER_GROUP = "marauder";

/** The two sides of a piece of work, as `record.ts` names them. */
export const SIDES = ["fe", "be"] as const;
export type Side = (typeof SIDES)[number];

/**
 * What a click does. `attach` moves an Unsorted entry onto a feature and `dismiss` drops it
 * with a reason — the two an Unsorted row offers (ARG-167). `new` and `stage` went with the
 * workstreams: a feature is never opened by hand, it is a directory, and argus refuses both.
 *
 * `verified` is the odd one, and it is not about the queue at all: its `id` names an
 * event on a feature's record, and it is the user answering what a `directed-at-person`
 * event asked them — the go-ahead for the one edit that event named, which the next ingest
 * stamps onto the event and the ticket pass then makes (LIA-161, LIA-162 AC3).
 */
export const MARAUDER_ACTIONS = ["attach", "dismiss", "verified"] as const;
export type MarauderAction = (typeof MARAUDER_ACTIONS)[number];

/** The two an Unsorted row offers; `verified` is said on the feature page. */
export const UNSORTED_ACTIONS = ["attach", "dismiss"] as const;

/** The verbs that went with the workstreams — refused by name, in argus's own words. */
export const RETIRED_ACTIONS = ["new", "stage", "split"] as const;

/**
 * One decision file's contents. `id` is the Unsorted entry's own id — a Slack `ts`, a
 * `fe#417` — or, for `verified`, an event's key on its feature's record; carried verbatim,
 * since that is what ingest matches on. The file's *name* is the slug below, which the id
 * alone cannot be.
 */
export interface MarauderDecision {
  action: MarauderAction;
  /** ISO timestamp of the click. */
  at: string;
  /** Who decided; there is one Pensieve user, so this is a constant until there is not. */
  by: string;
  /** `attach` only — the feature it lands on, as its directory under `features/`. */
  feature?: string;
  id: string;
  reason?: string;
}

/**
 * Who a decision is `by`. There is one Pensieve user, and no sign-in to ask — so a constant
 * until there is one, which is what the sweep's own corrections record for a hand attach.
 */
export const PENSIEVE_USER = "Liam Leung";

/**
 * A feature, as its directory under an app's `features/` — `admin/invoicing`, `tasks`.
 * Every segment starts with a letter or digit, so `..`, `.` and an absolute path can never
 * match: this is the guard on the route, on Ask's `?feature=` and on an attach.
 */
export const FEATURE_RE = /^[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*$/;
export const isFeature = (v: unknown): v is string =>
  typeof v === "string" && FEATURE_RE.test(v);

/**
 * The file name a decision on `id` is written under. An Unsorted id is whatever named the
 * thing it came from — `1788927279211769.42`, `fe#417`, `split/usage-page` — and none of
 * those is a path segment, so it is folded to the one shape every decision file's name
 * has. The id itself travels inside the file, so nothing is lost in the fold.
 */
export const decisionSlug = (id: string): string =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** `marauder/<slug>` — the id `decisionPath` maps to `decisions/marauder/<slug>.json`. */
export const marauderId = (id: string) =>
  `${MARAUDER_GROUP}/${decisionSlug(id)}`;

export const MARAUDER_ID_RE = new RegExp(
  `^${MARAUDER_GROUP}/[a-z0-9]+(?:-[a-z0-9]+)*$`
);

export const isMarauderId = (id: unknown): id is string =>
  typeof id === "string" && MARAUDER_ID_RE.test(id);

/**
 * How an event is named — argus `skills/sweep/scripts/marauder/record.ts` `eventId` /
 * `eventKeys`, rule for rule. An event has no id of its own: it is named by the source it
 * came from, or by the instant it happened when it came from nowhere, and two rulings out
 * of one huddle share a source, so the second gets a `~2` and the third a `~3`.
 *
 * Both sides have to derive the same name from the same events, in the same order, or a
 * Verify would confirm the wrong event — which is why this is a copy of the rule rather
 * than a key read off the record: the record does not carry one.
 */
export const eventId = (e: { at: string; source?: { ref: string } }) =>
  e.source?.ref ?? e.at;

export function eventKeys(
  events: ReadonlyArray<{ at: string; source?: { ref: string } }>
): string[] {
  const counts = new Map<string, number>();
  return events.map((e) => {
    const base = eventId(e);
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

/**
 * The prefix a confirmation writes onto the event's `action` (argus `correct.ts`
 * `CONFIRMED`). An event already wearing it has been answered, so it is never offered a
 * second Verify — the same refusal the correction gives.
 */
export const CONFIRMED = "confirmed:";

/** The user's own token in an event's `to` list, as `record.ts` writes it. */
export const USER_TOKEN = "you";

/**
 * Whether this event is one the user can answer: a `directed-at-person` event aimed at
 * them that nobody has confirmed yet. That is the whole of what Verify is offered on
 * (AC3) — every other event is a fact, and a fact is not a question.
 */
export const needsVerify = (e: {
  action?: string;
  kind: string;
  to?: string[];
}): boolean =>
  e.kind === "directed-at-person" &&
  (e.to ?? []).includes(USER_TOKEN) &&
  !e.action?.startsWith(CONFIRMED);

/** The draft a click makes, before it is a decision. */
export interface MarauderDraft {
  action: string;
  feature?: string;
  id: string;
  reason?: string;
}

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The one sentence a reasonless dismiss is refused with, on the row, the card and the server. */
export const DISMISS_NEEDS_REASON =
  "say why — the reason is all a later reader has for why this is not on a feature";

/**
 * Why this click cannot be written, in the sentence the row shows and the server refuses
 * with — one set of words for both, so a button that is pressed anyway is refused in the
 * language its own form used. `undefined` means it may be written.
 *
 * `dismiss` is the one that needs an argument: the reason is what a later reader has for
 * why the entry is not on a workstream, and there is nothing else in the file that says.
 */
export function checkDraft(draft: MarauderDraft): string | undefined {
  const id = trimmed(draft.id);
  if (!id) {
    return "the entry has no id";
  }
  if (!decisionSlug(id)) {
    return `"${draft.id}" is not an entry id`;
  }
  const action = trimmed(draft.action) as MarauderAction;
  if ((RETIRED_ACTIONS as readonly string[]).includes(action)) {
    return `"${action}" went with the workstreams — attach the entry to a feature instead`;
  }
  if (!(MARAUDER_ACTIONS as readonly string[]).includes(action)) {
    return `"${draft.action}" is not one of ${MARAUDER_ACTIONS.join(", ")}`;
  }
  if (action === "attach" && !isFeature(trimmed(draft.feature))) {
    return "choose the feature it belongs to";
  }
  if (action === "dismiss" && !trimmed(draft.reason)) {
    return DISMISS_NEEDS_REASON;
  }
  // `verified` needs nothing but the id: the event's own text is what is being agreed to,
  // and a note is the user's to add or leave out.
  return undefined;
}
