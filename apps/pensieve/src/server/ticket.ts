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

import type { ProjectLookup } from "./linear";
import { knownProjects, TEAM_NAME } from "./linear";

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
  projects: () => Promise<ProjectLookup>;
}

export const linearSources = (): TicketSources => ({
  projects: () => knownProjects(),
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
  project: {
    id?: string;
    name: string;
    /** False when no project list could be had — the name is taken on trust and said so. */
    verified: boolean;
  };
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
 * team's projects and nothing else; writes nothing at all.
 */
export async function checkDraft(
  input: { description: string; project: string; title: string },
  sources: TicketSources = linearSources()
): Promise<DraftCheck> {
  const title = trimmed(input.title);
  const description = trimmed(input.description);
  const project = trimmed(input.project);

  const bad = checkTitle(title) ?? checkSections(description);
  if (bad) {
    return { error: bad, ok: false };
  }
  if (!project) {
    return {
      error: `the draft names no project — name one of team ${TEAM_NAME}'s`,
      ok: false,
    };
  }

  const lookup = await sources.projects();
  const match = lookup.projects.find((p) => norm(p.name) === norm(project));
  if (!match && lookup.source !== "none") {
    const names = lookup.projects.map((p) => p.name).join(", ");
    return {
      error: `"${project}" is not a project on team ${TEAM_NAME} — its projects are ${names || "none that could be read"}`,
      ok: false,
    };
  }
  return {
    draft: {
      description,
      project: {
        name: match?.name ?? project,
        verified: Boolean(match),
        ...(match ? { id: match.id } : {}),
      },
      title,
      ...(lookup.teamId ? { teamId: lookup.teamId } : {}),
      ...(lookup.viewerId ? { viewerId: lookup.viewerId } : {}),
    },
    ok: true,
  };
}
