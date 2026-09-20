/**
 * What both sides of the wire need to know about handing a ticket to Foundry (LIA-162).
 *
 * A Send is one ticket on a feature's page: `sendReady` (`lib/api.ts`) posts the job to
 * Foundry, then records it on the feature's ledger with `argus sent`, so the ticket and the
 * job travel through argus like every other write. The page needs the same refusals the
 * server applies — which tickets may be sent, which repo a job may go to — so they live
 * here, where nothing node-only is imported (`FoundryRepo` is a type, and erased).
 */

import type { FoundryRepo } from "#/server/foundry";

/**
 * The Linear states a ticket may be sent from: nothing has started on it. `backlog` and
 * `unstarted` are Linear's own type names for the Backlog and Todo columns (AC2) — read
 * off the state's type rather than its name, since a workspace may rename the column.
 */
export const SENDABLE_STATES = ["backlog", "unstarted"] as const;

export const isSendable = (stateType?: string): boolean =>
  (SENDABLE_STATES as readonly string[]).includes(stateType ?? "");

/**
 * What `blueprintId` says when a job is to run as one bare step rather than through a
 * blueprint. Foundry's own literal — it is the absence of a blueprint, so it is never a row
 * in `GET /api/blueprints`, and the picker offers it as its own option, alongside a first
 * option for choosing none at all (CTD-284): that first option is the picker's default and
 * omits `blueprintId` from the wire entirely, so Foundry maps a ticket to its own default —
 * `"none"` here stays a person's explicit choice, never Send's own.
 *
 * Here rather than in `server/foundry.ts` for the reason the ids are: the picker needs it,
 * and nothing node-only is imported in this file.
 */
export const NO_BLUEPRINT = "none";

/**
 * Why a Send cannot go — the repo is missing. The form refuses with it before asking, and
 * `server/send.ts` refuses with it when something reaches the writer without one, so the
 * sentence is the same wherever it is read (LIA-120). It names a choice rather than a path:
 * the field is a select over what `GET /api/repos` answered, and falls back to free text
 * only when Foundry could not answer with a list at all.
 */
export const REPO_REQUIRED = "a repo is required — choose one Foundry tracks";

/**
 * Which side of the product a ticket is for, from the tag the house format puts in every
 * title (`[FE] Due header follows the payment term`). Undefined when it carries neither —
 * the tag is a convention, not a guarantee, and nothing here guesses from the words.
 */
export const repoTag = (title: string): "FE" | "BE" | undefined => {
  const hit = /^\s*\[(FE|BE)\]/i.exec(title);
  return hit ? (hit[1].toUpperCase() as "FE" | "BE") : undefined;
};

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
