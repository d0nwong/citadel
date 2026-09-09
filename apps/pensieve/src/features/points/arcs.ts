/**
 * The queue's other partition: by the initiative a point belongs to (LIA-149 AC5). The
 * three Needs-you sections (`sections.ts`) stay what they are and go *inside* each arc —
 * who moves a point is one question, which story it is a step of is another, and the page
 * asks them in that order.
 *
 * Nothing here is a rule about arcs: the sweep files a point against one through the arc's
 * seeds and writes the slug on the record (LIA-148), and this only reads that field. A
 * `points.json` where no point carries `arc` — an older tick, a workspace with no arcs —
 * partitions to `null`, which is the caller's signal to render the page it rendered before.
 */

import type { ArcOpen, Point } from "#/server/workspace";

/** What the heading of one arc group needs: the arc's slug and the words for it. */
export interface ArcRef {
  slug: string;
  title: string;
}

export interface ArcGroup {
  points: Point[];
  /** The arc, or undefined for the trailing "No arc" group. */
  ref?: ArcRef;
}

/** The heading a point with no arc sits under, last. */
export const NO_ARC = "No arc";

/**
 * The points grouped by arc, in the order the arcs are given — an arc the list does not
 * name (closed since the tick, or written after it) keeps its slug as its title and follows
 * the named ones, so a point is never dropped for want of a heading. Unarced points come
 * last, under their own group. `null` when no point carries an arc at all.
 */
export function byArc(points: Point[], arcs: ArcRef[]): ArcGroup[] | null {
  if (!points.some((p) => p.arc)) {
    return null;
  }
  const order = new Map(arcs.map((a, i) => [a.slug, i]));
  const groups = new Map<string, ArcGroup>();
  const unarced: Point[] = [];
  for (const point of points) {
    if (!point.arc) {
      unarced.push(point);
      continue;
    }
    const group = groups.get(point.arc) ?? {
      points: [],
      ref: arcs.find((a) => a.slug === point.arc) ?? {
        slug: point.arc,
        title: point.arc,
      },
    };
    group.points.push(point);
    groups.set(point.arc, group);
  }
  const unknown = arcs.length;
  const sorted = [...groups.values()].sort(
    (a, b) =>
      (order.get(a.ref?.slug ?? "") ?? unknown) -
      (order.get(b.ref?.slug ?? "") ?? unknown)
  );
  return unarced.length > 0 ? [...sorted, { points: unarced }] : sorted;
}

/**
 * The open points of one arc, as its page shows them: the live records behind the file's
 * `## Open` rows, in the file's order, then any point the sweep has filed against the arc
 * since it wrote that section. The file is a tick behind the decisions, so a point decided
 * in between is dropped here rather than shown with controls that would refuse.
 */
export function openPointsOf(
  slug: string,
  open: ArcOpen[],
  points: Point[]
): Point[] {
  const undecided = points.filter((p) => !p.decision);
  const byId = new Map(undecided.map((p) => [p.id, p]));
  const out: Point[] = [];
  const seen = new Set<string>();
  for (const row of open) {
    const point = row.point ? byId.get(row.point) : undefined;
    if (point && !seen.has(point.id)) {
      seen.add(point.id);
      out.push(point);
    }
  }
  for (const point of undecided) {
    if (point.arc === slug && !seen.has(point.id)) {
      seen.add(point.id);
      out.push(point);
    }
  }
  return out;
}

/** The file's Open rows that no live point stands for — an open ticket the sweep listed. */
export const otherOpenRows = (open: ArcOpen[], shown: Point[]): ArcOpen[] => {
  const ids = new Set(shown.map((p) => p.id));
  return open.filter((row) => !(row.point && ids.has(row.point)));
};
