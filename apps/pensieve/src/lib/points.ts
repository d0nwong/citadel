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

/**
 * The point's repo as one of Foundry's, or nothing. It matches a `name` or a `path` — the
 * sweep fills `point.repo` from a ticket's `[FE]`/`[BE]` tag and either shape can come out
 * — and answers "" for anything Foundry does not track, so a repo it would refuse is never
 * the one already chosen when the Send form opens (LIA-120, AC2/AC3). The answer is always
 * a `name`, which is what `POST /api/jobs` takes verbatim.
 */
export function pickRepo(repos: FoundryRepo[], repo?: string): string {
  const want = repo?.trim();
  const hit = want && repos.find((r) => r.name === want || r.path === want);
  return hit ? hit.name : "";
}
