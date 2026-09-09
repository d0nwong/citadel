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
 * How arcs are ordered wherever they are listed: the one rewritten last first, since an arc
 * that moved this tick is the one being read (LIA-149 AC1), and title order between arcs
 * rewritten on the same day so the list does not shuffle between loads.
 */
export function byLastRewrite<T extends { title: string; updated: string }>(
  a: T,
  b: T
): number {
  if (a.updated !== b.updated) {
    return a.updated < b.updated ? 1 : -1;
  }
  return a.title.localeCompare(b.title);
}

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
 * What an arc's Landed row points at. The sweep writes the Evidence cell as a
 * workspace-relative path — a journal entry for a landing, `decisions/<group>/<slug>.json`
 * for a verdict — and the page turns it into a link into Pensieve (LIA-149 AC2). A path of
 * neither shape is shown as it is: the arc file is argus's, and a row this app cannot route
 * is still evidence worth reading in the editor.
 */
export type Evidence =
  | { kind: "journal"; id: string; path: string }
  | { kind: "decision"; path: string; point: string }
  | { kind: "plain"; path: string };

export function evidenceOf(raw: string): Evidence {
  const path = raw.trim().replace(/^`|`$/g, "");
  const decision = path.match(/^decisions\/([^/]+)\/([^/]+)\.json$/);
  if (decision) {
    return { kind: "decision", path, point: `${decision[1]}/${decision[2]}` };
  }
  // `<app>/features/<dir>/journal/**/<slug>.md` → the journal id, `<app>/<dir>/<slug>`.
  const cut = path.indexOf("/features/");
  const journal = cut > 0 ? path.indexOf("/journal/", cut) : -1;
  if (journal > 0 && path.endsWith(".md")) {
    const app = path.slice(0, cut);
    const dir = path.slice(cut + "/features/".length, journal);
    const slug = path.slice(journal + "/journal/".length, -".md".length);
    return {
      id: `${app}/${dir}/${slug.slice(slug.lastIndexOf("/") + 1)}`,
      kind: "journal",
      path,
    };
  }
  return { kind: "plain", path };
}

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
