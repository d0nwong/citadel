/**
 * The ledger, as both sides of the wire see it. `<app>/features/<dir>/ledger.json` is
 * argus's record of one feature: the requirements the business asked for and whether
 * anyone confirmed them, the asks and what happened to each, the user's tickets with
 * their blockers, the landings, and the proposals waiting for a click. Argus's
 * `scripts/argus/schema.ts` is the source of these shapes; this file mirrors what the
 * pages read and derives the two lists the record never writes: what is on you, and
 * which tickets are ready.
 */

export type Repo = "fe" | "be";
export type RequirementStatus =
  | "assumed"
  | "confirmed"
  | "contradicted"
  | "retired";
export type AskStatus =
  | "asked"
  | "answered"
  | "built"
  | "acknowledged"
  | "closed"
  | "dropped";
export const STORY_KEYS = [
  "health",
  "gaps",
  "requirements",
  "architecture",
] as const;
export type StoryKey = (typeof STORY_KEYS)[number];

export type Evidence =
  | { kind: "slack"; url: string; quote?: string }
  | { kind: "pr"; repo: Repo; number: number; url: string }
  | { kind: "commit"; repo: Repo; sha: string; url?: string }
  | { kind: "file"; repo: Repo; sha: string; path: string; line?: number }
  | { kind: "ticket"; key: string; url?: string }
  | { kind: "assumption"; note?: string }
  | { kind: "user"; reason: string; at: string };

export interface StoryText {
  evidence: Evidence[];
  text: string;
}

export interface Requirement {
  at?: string;
  by?: string;
  code?: Extract<Evidence, { kind: "file" }>[];
  evidence: Evidence[];
  id: string;
  status: RequirementStatus;
  text: string;
}

export type AskOrigin =
  | { kind: "slack"; url: string; thread: string }
  | { kind: "huddle"; url: string; thread: string }
  | { kind: "ticket"; key: string };

export interface AskHistory {
  at: string;
  evidence: Evidence[];
  status: AskStatus;
}

export interface Ask {
  at: string;
  /** what the ask waits for; code clears a landing, a person answers an answer */
  blockers?: Blocker[];
  by: string;
  history: AskHistory[];
  id: string;
  origin: AskOrigin;
  /** derived by argus, present only with blockers: every one is cleared */
  ready?: boolean;
  requirements?: string[];
  status: AskStatus;
  text: string;
  ticket?: string | null;
  to: string | null;
}

export interface Cleared {
  at: string;
  evidence: Evidence[];
}

export type Blocker =
  | {
      kind: "landing";
      repo: Repo;
      ref: string;
      branch: string;
      deployed: boolean;
      cleared: Cleared | null;
    }
  | { kind: "answer"; from: string; question: string; cleared: Cleared | null }
  | { kind: "ticket"; key: string; cleared: Cleared | null };

export interface Ticket {
  asks: string[];
  blockers: Blocker[];
  key: string;
  ready: boolean;
  sent?: { at: string; repo: string; job?: string }[];
  /** how it finished, set by argus's reconcile: Linear said Done or Canceled, or its landing went live */
  settled?: Cleared & { outcome: "done" | "dropped" };
  title: string;
}

export interface Landing {
  asks: string[];
  at: string;
  by: string;
  files: string[];
  number: number | null;
  ref: string;
  repo: Repo;
  sha: string;
  /** ticket keys the branch or title named; argus closes the ask a key serves once the landing is live */
  tickets?: string[];
  title: string;
  url: string | null;
}

export interface Proposal {
  asks: string[];
  at: string;
  body: string;
  id: string;
  kind: "ticket";
  title: string;
}

export interface Ledger {
  as_of: string;
  asks: Ask[];
  feature: string;
  landings: Landing[];
  proposals: Proposal[];
  requirements: Requirement[];
  story: Record<StoryKey, StoryText>;
  summary: string;
  tickets: Ticket[];
}

/** something nobody could place; argus's `state/unplaced.json` */
export interface Unplaced {
  at: string;
  batch: string;
  by: string;
  candidates: string[];
  id: string;
  kind: "message" | "landing";
  text: string;
  thread?: string;
  url: string;
}

/** an ask still needs somebody */
export const isOpen = (a: Ask): boolean =>
  a.status !== "closed" && a.status !== "dropped";

/** the asks aimed at the reader and not yet done, oldest first */
export const onYou = (l: Ledger): Ask[] =>
  l.asks
    .filter((a) => isOpen(a) && a.to === "you")
    .sort((a, b) => a.at.localeCompare(b.at));

/** open asks whose every blocker cleared: the wait is over, somebody can pick it up */
export const readyAsks = (l: Ledger): Ask[] =>
  l.asks.filter((a) => isOpen(a) && a.ready === true);

/**
 * Reconcile settled the ticket done (Linear said so, or its landing went live), or every
 * ask it serves is closed or dropped: the work behind it is done.
 */
export const ticketDone = (l: Ledger, t: Ticket): boolean =>
  t.settled?.outcome === "done" ||
  (t.asks.length > 0 &&
    t.asks.every((id) => {
      const a = l.asks.find((x) => x.id === id);
      return a !== undefined && !isOpen(a);
    }));

/** Linear canceled the ticket: not wanted, nothing to pick up */
export const ticketDropped = (t: Ticket): boolean =>
  t.settled?.outcome === "dropped";

/**
 * Tickets to pick up: nothing left to wait for, not yet sent to Foundry, and still wanted,
 * meaning nothing settled it and either it names no asks or at least one of them is open.
 */
export const readyTickets = (l: Ledger): Ticket[] =>
  l.tickets.filter(
    (t) => t.ready && !t.sent?.length && !ticketDone(l, t) && !ticketDropped(t)
  );

/**
 * The repo this feature's work lands in, as its own ledger recorded it: the repo of the
 * most recent `sent` record on any of its tickets. Nothing else knows — a ticket carries no
 * repo, and a feature is not a checkout — but every send writes one down, so the second
 * ticket on a feature can be offered the repo the first one went to.
 *
 * Undefined until a feature has been sent once, and only ever a default: the field stays
 * editable, and `pickRepo` drops a repo Foundry no longer tracks before it is shown.
 */
export const lastSentRepo = (l: Ledger): string | undefined => {
  let latest: { at: string; repo: string } | undefined;
  for (const t of l.tickets) {
    for (const s of t.sent ?? []) {
      if (s.repo && (!latest || s.at > latest.at)) {
        latest = s;
      }
    }
  }
  return latest?.repo;
};

/** `admin/invoicing` → `/features/alden/alden-portal/admin/invoicing` when the app is known */
export const featureRoute = (app: string, dir: string) =>
  `/features/${app}/${dir}`;

/** a permalink for a piece of evidence, when it has one */
export function evidenceHref(e: Evidence): string | null {
  switch (e.kind) {
    case "slack":
    case "pr":
      return e.url;
    case "commit":
    case "ticket":
      return e.url ?? null;
    default:
      return null;
  }
}

/** what a piece of evidence is called on a page */
export function evidenceLabel(e: Evidence): string {
  switch (e.kind) {
    case "slack":
      return "the message";
    case "pr":
      return `${e.repo}#${e.number}`;
    case "commit":
      return `${e.repo}@${e.sha.slice(0, 9)}`;
    case "file":
      return `${e.path}${e.line ? `:${e.line}` : ""}`;
    case "ticket":
      return e.key;
    case "assumption":
      return e.note ? `assumption: ${e.note}` : "assumption";
    case "user":
      return `you: ${e.reason}`;
    default:
      return "evidence";
  }
}
