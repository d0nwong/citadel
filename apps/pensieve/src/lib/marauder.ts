/**
 * What both sides of the wire need to know about the map of the work (LIA-154/155) and
 * about the one thing Pensieve writes onto it: a decision on an Unsorted entry
 * (LIA-160).
 *
 * `workstreams/<slug>.json` is argus's record and `marauder/*.md` are the pages rendered
 * from it; both are the sweep's, and nothing here writes either. What this app writes is
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

/** How far one side has got, as `record.ts` names them, in order. */
export const STAGES = [
  "asked",
  "decided",
  "building",
  "landed",
  "verified",
  "shipped",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * What a click does to an Unsorted entry. `attach` moves it onto an open workstream,
 * `new` opens one from it, `dismiss` drops it with a reason, and `stage` says where a
 * side really is — the file format carries all four, and this page offers the first
 * three (a stage correction is said on the workstream, not in the triage list).
 */
export const MARAUDER_ACTIONS = ["attach", "new", "dismiss", "stage"] as const;
export type MarauderAction = (typeof MARAUDER_ACTIONS)[number];

/**
 * One decision file's contents. `id` is the Unsorted entry's own id — a Slack `ts`, a
 * `fe#417`, a `split/<slug>` — carried verbatim, since that is what ingest matches the
 * queue on; the file's *name* is the slug below, which the id alone cannot be.
 */
export interface MarauderDecision {
  action: MarauderAction;
  /** ISO timestamp of the click. */
  at: string;
  /** Who decided; there is one Pensieve user, so this is a constant until there is not. */
  by: string;
  id: string;
  /** `new` only — the name the workstream is opened under. */
  name?: string;
  reason?: string;
  /** `stage` only — which side, and where it really is. */
  side?: Side;
  /** `attach` and `stage` — the workstream the entry lands on. */
  slug?: string;
  stage?: Stage;
}

/**
 * Who a decision is `by`. There is one Pensieve user, and no sign-in to ask — so a constant
 * until there is one, which is what the sweep's own corrections record for a hand attach.
 */
export const PENSIEVE_USER = "Liam Leung";

/** A workstream slug, as `record.ts` validates it: lower-case words joined by hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isSlug = (v: unknown): v is string =>
  typeof v === "string" && SLUG_RE.test(v);

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

/** The draft a click makes, before it is a decision. */
export interface MarauderDraft {
  action: string;
  id: string;
  name?: string;
  reason?: string;
  side?: string;
  slug?: string;
  stage?: string;
}

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

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
  if (!(MARAUDER_ACTIONS as readonly string[]).includes(action)) {
    return `"${draft.action}" is not one of ${MARAUDER_ACTIONS.join(", ")}`;
  }
  if (action === "attach" && !isSlug(trimmed(draft.slug))) {
    return "choose the workstream it belongs to";
  }
  if (action === "new" && !trimmed(draft.name)) {
    return "a new workstream needs a name";
  }
  if (action === "dismiss" && !trimmed(draft.reason)) {
    return "say why — the reason is all a later reader has for why this is not on a workstream";
  }
  if (action === "stage") {
    if (!isSlug(trimmed(draft.slug))) {
      return "a stage correction names the workstream it is about";
    }
    if (!(SIDES as readonly string[]).includes(trimmed(draft.side))) {
      return `the side is ${SIDES.join(" or ")}`;
    }
    if (!(STAGES as readonly string[]).includes(trimmed(draft.stage))) {
      return `the stage is one of ${STAGES.join(", ")}`;
    }
  }
  return undefined;
}
