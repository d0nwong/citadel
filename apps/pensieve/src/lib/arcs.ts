/**
 * What both sides of the wire need to know about an arc — the running story of an
 * initiative (LIA-145). The shapes here are the sweep's, restated: `arcs/<slug>.md` is
 * written by `skills/sweep/scripts/arcs.ts` alone, and the one thing that opens or closes
 * one is `decisions/arc/<slug>.json`, which Pensieve writes on a click (LIA-147).
 *
 * `server/decisions.ts` builds the file path from the id and is node-only; the card needs
 * the same seed kinds to render them and the same slug rule to refuse a bad one before it
 * asks, so all of it lives here, where nothing node-only is imported.
 */

/** The one decision group that is not a verdict on a point. */
export const ARC_GROUP = "arc";

/** An arc's slug: the file name under `arcs/`, and the point id's second half. */
export const ARC_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `arc/<slug>` — the id the decision file is addressed by, as `<group>/<slug>`. */
export const ARC_ID_RE = /^arc\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isArcSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && ARC_SLUG_RE.test(slug);

export const isArcId = (id: unknown): id is string =>
  typeof id === "string" && ARC_ID_RE.test(id);

/** The id `decisionPath` maps to `decisions/arc/<slug>.json`. */
export const arcId = (slug: string) => `${ARC_GROUP}/${slug}`;

/**
 * The keys an item is filed against an arc by. Never a resemblance: the sweep joins a
 * journal entry, a point or a ticket to an arc only through one of these four lists, so a
 * wrong seed mis-files every later landing and a missing one loses it.
 */
export const SEED_KINDS = ["tickets", "rules", "prs", "features"] as const;

export type SeedKind = (typeof SEED_KINDS)[number];
export type ArcSeeds = Record<SeedKind, string[]>;

export const emptySeeds = (): ArcSeeds => ({
  features: [],
  prs: [],
  rules: [],
  tickets: [],
});

/** What each kind of seed is, in the card's own words. */
export const SEED_LABEL: Record<SeedKind, string> = {
  features: "features",
  prs: "PRs",
  rules: "rules",
  tickets: "tickets",
};

/** Every seed the four lists carry, in seed order — what "at least one" is counted over. */
export const allSeeds = (seeds: ArcSeeds): string[] =>
  SEED_KINDS.flatMap((k) => seeds[k]);

/**
 * Anything off the wire as the four lists, trimmed and de-duplicated. A kind the caller
 * left out is an empty list rather than a missing key, so every reader can index all four.
 */
export function toSeeds(v: unknown): ArcSeeds {
  const seeds = emptySeeds();
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return seeds;
  }
  const o = v as Record<string, unknown>;
  for (const kind of SEED_KINDS) {
    const list = Array.isArray(o[kind]) ? (o[kind] as unknown[]) : [];
    seeds[kind] = [
      ...new Set(
        list
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
  }
  return seeds;
}
