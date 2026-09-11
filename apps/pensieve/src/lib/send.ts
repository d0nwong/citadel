/**
 * What both sides of the wire need to know about handing a ticket to Foundry (LIA-162).
 *
 * Send used to be keyed on a Needs-you point. Points are gone with the sweep's rewire
 * (LIA-161), and the thing a person actually presses Send beside is a ticket on a
 * workstream page — so the key is the ticket, and the file is
 * `decisions/send/<ticket>.json` `{ ticket, action: "sent", job, at, by }`. Argus reads it
 * by content, not by name (argus's `sent` records scan every group under
 * `decisions/` for a `sent` decision carrying a job), so the ticket travels inside the file
 * and the file name is the id folded the way every other decision file's name is.
 *
 * `server/decisions.ts` builds the path and is node-only; the workstream page needs the
 * same id rule to address a row and the same refusals, so all of it lives here, where
 * nothing node-only is imported (`FoundryRepo` is a type, and erased).
 */

import type { FoundryRepo } from "#/server/foundry";

/** The decision group a ticket handed to Foundry lands in. */
export const SEND_GROUP = "send";

/** A Linear issue key, as the workstreams record them: `LIA-162`, `MM-18`. */
export const TICKET_RE = /^[A-Z][A-Z0-9]{0,9}-\d{1,6}$/;

export const isTicketKey = (v: unknown): v is string =>
  typeof v === "string" && TICKET_RE.test(v);

/**
 * `send/lia-162` — the id `decisionPath` maps to `decisions/send/lia-162.json`. The key is
 * lower-cased rather than used verbatim so every decision file's name has the one shape
 * the writer has always given it; the key itself travels inside the file, which is what
 * argus matches on.
 */
export const sendId = (ticket: string) =>
  `${SEND_GROUP}/${ticket.toLowerCase()}`;

export const SEND_ID_RE = new RegExp(
  `^${SEND_GROUP}/[a-z][a-z0-9]{0,9}-\\d{1,6}$`
);

export const isSendId = (id: unknown): id is string =>
  typeof id === "string" && SEND_ID_RE.test(id);

/**
 * The Linear states a ticket may be sent from: nothing has started on it. `backlog` and
 * `unstarted` are Linear's own type names for the Backlog and Todo columns (AC2) — read
 * off the state's type rather than its name, since a workspace may rename the column.
 */
export const SENDABLE_STATES = ["backlog", "unstarted"] as const;

export const isSendable = (stateType?: string): boolean =>
  (SENDABLE_STATES as readonly string[]).includes(stateType ?? "");

/**
 * Why a Send cannot go — the repo is missing. The form refuses with it before asking, and
 * `server/send.ts` refuses with it when something reaches the writer without one, so the
 * sentence is the same wherever it is read (LIA-120). It names a choice rather than a path:
 * the field is a select over what `GET /api/repos` answered, and falls back to free text
 * only when Foundry could not answer with a list at all.
 */
export const REPO_REQUIRED = "a repo is required — choose one Foundry tracks";

/** One row of the repo picker: what is shown, and what `POST /api/jobs` is sent. */
export interface RepoOption {
  label: string;
  name: string;
  path: string;
  value: string;
}

/**
 * Foundry's rows as the picker offers them. A `name` is what the job body carries — it is
 * shorter and it is what a ticket's `[FE]` / `[BE]` tag says — but Foundry resolves a bare
 * name only when exactly one tracked repo has it, and answers `400` when two do. So a name
 * two rows share is offered by its `path`, which always resolves, and labelled with it,
 * since two identical lines are not a choice.
 */
export function repoOptions(repos: FoundryRepo[]): RepoOption[] {
  const count = new Map<string, number>();
  for (const r of repos) {
    count.set(r.name, (count.get(r.name) ?? 0) + 1);
  }
  return repos.map((r) => {
    const shared = (count.get(r.name) ?? 0) > 1;
    return {
      label: shared ? `${r.name} — ${r.path}` : r.name,
      name: r.name,
      path: r.path,
      value: shared ? r.path : r.name,
    };
  });
}

/**
 * A remembered repo as one of Foundry's, or nothing. It matches a `path` exactly, or a
 * `name` when Foundry would resolve that name to one repo. Anything Foundry does not
 * track, and any name two of its repos share, answers "": a repo Foundry would refuse is
 * never the one already chosen when the Send form opens (LIA-120, AC2/AC3).
 */
export function pickRepo(repos: FoundryRepo[], repo?: string): string {
  const want = repo?.trim();
  if (!want) {
    return "";
  }
  const options = repoOptions(repos);
  const named = options.filter((o) => o.name === want);
  const hit =
    options.find((o) => o.path === want) ??
    (named.length === 1 ? named[0] : undefined);
  return hit?.value ?? "";
}
