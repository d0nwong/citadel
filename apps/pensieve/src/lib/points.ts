/**
 * The point-id shape, on both sides of the wire. `server/decisions.ts` builds file paths
 * from it and is node-only; the routes need the same test to validate `?point=` and the
 * `askChat` payload, so it lives here where nothing node-only is imported.
 */

/** A point id as the sweep's `points.ts` derives it: a known group, then a slug of `[a-z0-9-]`. */
export const POINT_ID_RE =
  /^(decide|verify|confirm|hold|housekeeping)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isPointId = (id: unknown): id is string =>
  typeof id === "string" && POINT_ID_RE.test(id);
