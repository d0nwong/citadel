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
  by: string;
  history: AskHistory[];
  id: string;
  origin: AskOrigin;
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

/** tickets with nothing left to wait for */
export const readyTickets = (l: Ledger): Ticket[] =>
  l.tickets.filter((t) => t.ready);

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
