/**
 * Node-only. The checks behind a drafted Linear issue, in one place: what `propose_ticket`
 * asks before it answers a proposal, and what `fileTicket` asks again before it writes
 * (LIA-113).
 *
 * One set of checks means one set of error strings — the sentence Argus reports when a
 * draft is refused is the sentence the card would show for the same draft. Nothing here
 * writes: `createIssue` keeps the write, the tool keeps nothing.
 *
 * The reader is injected (`TicketSources`) rather than imported at the call site, so a test
 * can hand it a project list without a credential or a cache file on disk — `bun test`
 * shares one module registry across files, so an env override there would leak. This is
 * `verdict.ts`'s arrangement, for the same reason.
 */

import { listLedgers } from "./ledger";
import type { ProjectLookup, Team } from "./linear";
import { knownProjects, TEAMS, teamFor } from "./linear";

/** The `linear-ticket` skill's Title rule. AC4 refuses a title *over* this. */
export const TITLE_MAX = 80;

/** Long enough for the five-section body the format budgets at about 800 words. */
export const DESCRIPTION_MAX = 20_000;

/** The five sections, in the order `skills/linear-ticket/FORMAT.md` fixes them. */
export const REQUIRED_SECTIONS = [
  "Summary",
  "Background",
  "Scope / Out of Scope",
  "Acceptance Criteria",
  "Technical Notes",
] as const;

/** The sixth, present only when the ticket waits on something unlanded. */
export const PENDING_SECTION = "Pending";

/** Where the sixth section is allowed: between Acceptance Criteria and Technical Notes. */
const PENDING_AFTER = "Acceptance Criteria";

const SECTION_LIST = REQUIRED_SECTIONS.join(", ");

/** Where the checks read from. Defaults to Linear, with its on-disk cache behind it. */
export interface TicketSources {
  /** The feature dirs a ticket can be recorded on. Absent: the feature is not checked. */
  features?: () => Promise<string[]>;
  projects: (teamKey: string) => Promise<ProjectLookup>;
}

export const linearSources = (): TicketSources => ({
  features: async () => (await listLedgers()).ledgers.map((l) => l.dir),
  projects: (teamKey) => knownProjects(fetch, teamKey),
});

/** A `## ` heading anywhere in the body, whitespace collapsed. Top-level: never built in a loop. */
const HEADING_RE = /^##[ \t]+(.+?)[ \t]*$/gm;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The `##` headings the body carries, in the order they appear. */
export function headingsOf(description: string): string[] {
  const out: string[] = [];
  for (const m of description.matchAll(HEADING_RE)) {
    out.push(m[1].replace(/\s+/g, " ").trim());
  }
  return out;
}

export interface CheckedDraft {
  description: string;
  /** The feature dir the user confirmed, whose ledger File records the ticket on. */
  feature?: string;
  project: {
    id?: string;
    /** True when the team has no project by this name yet: File creates it before the issue. */
    isNew: boolean;
    name: string;
    /** False when no project list could be had — the name is taken on trust and said so. */
    verified: boolean;
  };
  /** The team the draft resolved to — Alden when none was named (CTD-172). */
  team: Team;
  teamId?: string;
  title: string;
  viewerId?: string;
}

export type DraftCheck =
  | { draft: CheckedDraft; ok: true }
  | { error: string; ok: false };

/** The title: present, and inside the format's limit. */
function checkTitle(title: string): string | undefined {
  if (!title) {
    return "the draft has no title";
  }
  if (title.length > TITLE_MAX) {
    return `the title is ${title.length} characters — the format's limit is ${TITLE_MAX}`;
  }
}

/**
 * The body: the five sections, all present, in order, with Pending only in its one legal
 * position. Headings the format does not name are left alone — AC4 is about the five.
 */
function checkSections(description: string): string | undefined {
  if (!description) {
    return "the draft has no body";
  }
  if (description.length > DESCRIPTION_MAX) {
    return `the body is ${description.length} characters — more than the ${DESCRIPTION_MAX} a ticket can carry`;
  }
  const headings = headingsOf(description);
  const seen = headings.map(norm);
  const missing = REQUIRED_SECTIONS.filter((s) => !seen.includes(norm(s)));
  if (missing.length) {
    return `the body has no "## ${missing[0]}" heading — the five sections are ${SECTION_LIST}, in that order`;
  }
  // Every required heading is there; the order is the order they were found in.
  const order = REQUIRED_SECTIONS.map((s) => seen.indexOf(norm(s)));
  for (let i = 1; i < order.length; i += 1) {
    if (order[i] < order[i - 1]) {
      return `the body's sections are out of order — ${REQUIRED_SECTIONS[i]} comes before ${REQUIRED_SECTIONS[i - 1]}; the order is ${SECTION_LIST}`;
    }
  }
  const pending = seen.indexOf(norm(PENDING_SECTION));
  if (pending !== -1) {
    const after = seen.indexOf(norm(PENDING_AFTER));
    const before = seen.indexOf(norm("Technical Notes"));
    if (!(pending > after && pending < before)) {
      return `Pending sits between ${PENDING_AFTER} and Technical Notes, not anywhere else`;
    }
  }
}

/**
 * Check a drafted issue and answer it resolved, or say why there is no proposal. Reads the
 * named team's projects and nothing else; writes nothing at all. `team` is Pensieve's own
 * (Alden or Citadel, CTD-172), not Linear's key for a workspace team in general — an
 * unrecognised one is refused before any project list is read.
 *
 * A project the team does not have is not a refusal: the draft is answered with the name
 * marked `isNew`, and `fileTicket` creates the project on the team before the issue. The
 * skill files every feature into a project named after it, and the first ticket for a
 * feature is exactly the one whose project does not exist yet.
 */
export async function checkDraft(
  input: {
    description: string;
    feature?: string;
    project: string;
    team?: string;
    title: string;
  },
  sources: TicketSources = linearSources()
): Promise<DraftCheck> {
  const title = trimmed(input.title);
  const description = trimmed(input.description);
  const project = trimmed(input.project);

  const bad = checkTitle(title) ?? checkSections(description);
  if (bad) {
    return { error: bad, ok: false };
  }

  const team = teamFor(input.team);
  if (!team) {
    return {
      error: `"${trimmed(input.team)}" is not a team Pensieve files on — the teams are ${TEAMS.map((t) => t.name).join(", ")}`,
      ok: false,
    };
  }

  if (!project) {
    return {
      error: `the draft names no project — name one of team ${team.name}'s`,
      ok: false,
    };
  }

  const feature = trimmed(input.feature);
  if (feature && sources.features) {
    const known = await sources.features();
    if (!known.includes(feature)) {
      return {
        error: `"${feature}" is not a feature with a ledger — the features are ${known.join(", ")}`,
        ok: false,
      };
    }
  }

  const lookup = await sources.projects(team.key);
  const match = lookup.projects.find((p) => norm(p.name) === norm(project));
  const verified = lookup.source !== "none";
  return {
    draft: {
      description,
      project: {
        isNew: verified && !match,
        name: match?.name ?? project,
        verified,
        ...(match ? { id: match.id } : {}),
      },
      team,
      title,
      ...(feature ? { feature } : {}),
      ...(lookup.teamId ? { teamId: lookup.teamId } : {}),
      ...(lookup.viewerId ? { viewerId: lookup.viewerId } : {}),
    },
    ok: true,
  };
}
