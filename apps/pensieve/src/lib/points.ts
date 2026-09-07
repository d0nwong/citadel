/**
 * What both sides of the wire need to know about a point: the id shape, the one sentence a
 * Send is refused with, and how a point's own repo lands on Foundry's list.
 *
 * `server/decisions.ts` builds file paths from the id and is node-only; the routes need the
 * same test to validate `?point=` and the `askChat` payload, and the Send form needs the
 * same sentence and the same match the writer applies — so all of it lives here, where
 * nothing node-only is imported (the `FoundryRepo` above is a type, and erased).
 */

import type { FoundryRepo } from "#/server/foundry";

/** A point id as the sweep's `points.ts` derives it: a known group, then a slug of `[a-z0-9-]`. */
export const POINT_ID_RE =
  /^(decide|verify|confirm|hold|housekeeping)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isPointId = (id: unknown): id is string =>
  typeof id === "string" && POINT_ID_RE.test(id);

/**
 * Why a Send cannot go — the repo is missing. The form refuses with it before asking, and
 * `server/verdict.ts` refuses with it when something reaches the writer without one, so the
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
 * shorter and it is what the point's own `repo` says — but Foundry resolves a bare name
 * only when exactly one tracked repo has it, and answers `400` when two do. So a name two
 * rows share is offered by its `path`, which always resolves, and labelled with it, since
 * two identical lines are not a choice.
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
 * The point's repo as one of Foundry's, or nothing. It matches a `path` exactly, or a
 * `name` when Foundry would resolve that name to one repo — the sweep fills `point.repo`
 * from a ticket's `[FE]`/`[BE]` tag and either shape can come out. Anything Foundry does
 * not track, and any name two of its repos share, answers "": a repo Foundry would refuse
 * is never the one already chosen when the Send form opens (LIA-120, AC2/AC3).
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
