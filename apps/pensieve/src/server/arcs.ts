/**
 * Node-only. The checks behind opening and closing an arc, in one place: what `propose_arc`
 * asks before it answers a proposal, and what `openArc` / `closeArc` ask again before they
 * write (LIA-147).
 *
 * One set of checks means one set of error strings — the sentence Argus reports when a
 * proposal is refused is the sentence the card would show for the same draft. Nothing here
 * writes except the two verdicts at the bottom, which go through `writeDecision`, the same
 * atomic writer every other verdict uses; `arcs/<slug>.md` itself is the sweep's, on its
 * next tick, and nothing in Pensieve creates, rewrites or deletes it.
 *
 * The readers are injected (`ArcSources`) rather than imported at the call site, so a test
 * can point them at a temp workspace without mutating `WORKSPACE_DIR` — `bun test` shares
 * one module registry across files, so an env override there would leak. This is
 * `verdict.ts`'s and `ticket.ts`'s arrangement, for the same reason.
 */

import type { ArcSeeds, SeedKind } from "../lib/arcs";
import {
  ARC_SLUG_RE,
  allSeeds,
  arcId,
  emptySeeds,
  isArcSlug,
  SEED_KINDS,
  toSeeds,
} from "../lib/arcs";
import type { ArcDecision } from "./decisions";
import { DECISIONS_DIR, readArcDecision, writeDecision } from "./decisions";
import { openIssues } from "./linear";
import type { AppRoot, ArcMeta, JournalEntry } from "./workspace";
import { ARCS_DIR, listApps, listArcs, listJournal } from "./workspace";

/** The initiative in the words the user uses for it — a line, not a paragraph. */
export const TITLE_MAX = 120;

/** How many keys one arc may be seeded by. A story, not a catalogue. */
export const SEEDS_MAX = 40;

/** Where the checks read from. Defaults to the workspace on disk and Linear. */
export interface ArcSources {
  apps: () => Promise<AppRoot[]>;
  arcs: () => Promise<ArcMeta[]>;
  decisionsDir: string;
  journal: () => Promise<JournalEntry[]>;
  /** The team's open issue keys, or null when no list could be read at all. */
  tickets: () => Promise<string[] | null>;
}

export const workspaceSources = (): ArcSources => ({
  apps: listApps,
  arcs: () => listArcs(ARCS_DIR),
  decisionsDir: DECISIONS_DIR,
  journal: listJournal,
  tickets: async () => {
    const open = await openIssues();
    return open.source === "none" ? null : open.issues.map((i) => i.identifier);
  },
});

/** The draft a proposal is made of, once it has been checked. */
export interface CheckedArc {
  seeds: ArcSeeds;
  slug: string;
  title: string;
  /** False when no open-ticket list could be read — the card says the seeds are unverified. */
  verified: boolean;
}

export type ArcCheck =
  | { arc: CheckedArc; ok: true }
  | { error: string; ok: false };

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A LIA key as Linear spells it — the shape a ticket seed is taken on trust in. */
const TICKET_KEY_RE = /^LIA-\d+$/;

// ── the slug ───────────────────────────────────────────────────────────────────

/**
 * The slug: the arc's file name under `arcs/` and the second half of its point id, so it
 * obeys the same rule every other decision file's does. Free means free in both places —
 * an arc the sweep has already written, and an `opened` file it has not yet picked up.
 * Reopening is not a thing: a decision file is never edited afterwards, so the second
 * `opened` for one slug is refused here and by the writer.
 */
async function checkSlug(
  slug: string,
  sources: ArcSources
): Promise<string | undefined> {
  if (!slug) {
    return "the draft has no slug";
  }
  if (!isArcSlug(slug)) {
    return `"${slug}" is not a slug — lowercase words joined by single hyphens (${ARC_SLUG_RE.source})`;
  }
  const arcs = await sources.arcs();
  const existing = arcs.find((a) => a.slug === slug);
  if (existing) {
    return `arcs/${slug}.md is already there — that arc is ${existing.status}`;
  }
  const decided = await readArcDecision(slug, sources.decisionsDir);
  if (decided) {
    return `decisions/${arcId(slug)}.json is already there — that arc was ${decided.action}${decided.at ? ` on ${decided.at.slice(0, 10)}` : ""}`;
  }
}

// ── the seeds ──────────────────────────────────────────────────────────────────

/** Everything a seed of any kind can resolve against, read once per check. */
interface SeedIndex {
  features: Set<string>;
  journal: JournalEntry[];
  tickets: string[] | null;
}

async function seedIndex(sources: ArcSources): Promise<SeedIndex> {
  const [apps, journal, tickets] = await Promise.all([
    sources.apps(),
    sources.journal(),
    sources.tickets(),
  ]);
  const features = new Set<string>();
  for (const entry of journal) {
    // A feature is addressed as `<app>/<dir>`, and journals name it either way — a doc
    // key with its app, a `features:` list without. Both spellings are a seed that resolves.
    features.add(entry.feature);
    features.add(entry.feature.slice(entry.app.length + 1));
    for (const f of entry.features) {
      features.add(f);
    }
  }
  for (const app of apps) {
    features.add(app.app);
  }
  return { features, journal, tickets };
}

/** The journal fields a seed of each kind is looked for in — the sweep's join, read side. */
const JOURNAL_FIELDS: Record<SeedKind, (e: JournalEntry) => string[]> = {
  features: (e) => [e.feature, ...e.features],
  prs: (e) => (e.pr ? [e.pr] : []),
  rules: (e) => e.affects,
  tickets: (e) => e.tickets,
};

/**
 * Whether one seed names anything this workspace holds. The kinds are deliberately not
 * kept apart here: the sweep files an item against an arc when any of its four lists names
 * a key the item carries, so a key that resolves anywhere resolves. A rule id has one
 * source only — a journal entry's `affects` — because Pensieve does not parse docs for
 * `BR-` ids and need not (the arc's own page shows the rows).
 */
function resolves(kind: SeedKind, seed: string, index: SeedIndex): boolean {
  if (index.journal.some((e) => JOURNAL_FIELDS[kind](e).includes(seed))) {
    return true;
  }
  if (kind === "features") {
    return index.features.has(seed);
  }
  if (kind === "tickets") {
    // No list could be read at all: a well-formed key is taken on trust rather than
    // refused, and the proposal says so (`verified: false`), as a ticket draft does with
    // an unverifiable project.
    return index.tickets === null
      ? TICKET_KEY_RE.test(seed)
      : index.tickets.includes(seed);
  }
  return false;
}

/** Why a seed cannot be used, in the one sentence the skill tells the session to report. */
function seedError(kind: SeedKind, seed: string): string {
  const where =
    kind === "features"
      ? "no feature dir and no journal entry"
      : kind === "tickets"
        ? "no open Liamai ticket and no journal entry"
        : "no journal entry";
  return `the ${kind} seed "${seed}" names ${where} — an arc files on keys it can resolve, never on a guess`;
}

// ── the draft ──────────────────────────────────────────────────────────────────

/**
 * Check a drafted arc and answer it resolved, or say why there is no proposal. Reads the
 * arcs, the decisions, the journal and Linear's open issues; writes nothing at all.
 */
export async function checkArcDraft(
  input: { seeds?: unknown; slug: string; title: string },
  sources: ArcSources = workspaceSources()
): Promise<ArcCheck> {
  const slug = trimmed(input.slug);
  const title = trimmed(input.title);
  const seeds = toSeeds(input.seeds);

  const badSlug = await checkSlug(slug, sources);
  if (badSlug) {
    return { error: badSlug, ok: false };
  }
  if (!title) {
    return { error: "the draft has no title", ok: false };
  }
  if (title.length > TITLE_MAX) {
    return {
      error: `the title is ${title.length} characters — an arc's title is a line, under ${TITLE_MAX}`,
      ok: false,
    };
  }
  const keys = allSeeds(seeds);
  if (keys.length === 0) {
    return {
      error: `the draft has no seeds — an arc files on keys (${SEED_KINDS.join(", ")}) and one with none files nothing`,
      ok: false,
    };
  }
  if (keys.length > SEEDS_MAX) {
    return {
      error: `the draft carries ${keys.length} seeds — an arc is a story, not a catalogue; ${SEEDS_MAX} is the limit`,
      ok: false,
    };
  }

  const index = await seedIndex(sources);
  for (const kind of SEED_KINDS) {
    for (const seed of seeds[kind]) {
      if (!resolves(kind, seed, index)) {
        return { error: seedError(kind, seed), ok: false };
      }
    }
  }
  return {
    arc: { seeds, slug, title, verified: index.tickets !== null },
    ok: true,
  };
}

// ── the two verdicts ───────────────────────────────────────────────────────────

export type ArcVerdict =
  | { decision: ArcDecision; ok: true; replay?: boolean }
  | { error: string; ok: false };

/**
 * Open the arc: one `decisions/arc/<slug>.json` with `action: "opened"`, written through
 * the same atomic writer every verdict uses. The draft is re-checked rather than trusted —
 * the card's title is editable, so what is opened is not what `propose_arc` approved — and
 * a file already on disk is answered rather than written over, so a second press of Open
 * (or one after a reload replayed the card) writes nothing more (AC2).
 *
 * `arcs/<slug>.md` is not touched: the sweep writes it from this file on its next tick.
 */
export async function openArc(
  input: { seeds?: unknown; slug: string; title: string },
  sources: ArcSources = workspaceSources()
): Promise<ArcVerdict> {
  const slug = trimmed(input.slug);
  const already = isArcSlug(slug)
    ? await readArcDecision(slug, sources.decisionsDir)
    : null;
  if (already) {
    return { decision: already, ok: true, replay: true };
  }
  const check = await checkArcDraft(input, sources);
  if (!check.ok) {
    return { error: check.error, ok: false };
  }
  const { arc } = check;
  const decision: ArcDecision = {
    action: "opened",
    at: new Date().toISOString(),
    point: arcId(arc.slug),
    seeds: arc.seeds,
    slug: arc.slug,
    subject: arc.title,
  };
  await writeDecision(decision, sources.decisionsDir);
  return { decision, ok: true };
}

/**
 * Close the arc: the same file with `action: "closed"`, which is the only thing that sets
 * an arc's `status: closed` on the sweep's next tick. It is a verdict on an arc that
 * exists, so it is refused unless `arcs/<slug>.md` is there and open — an arc with nothing
 * left open is not necessarily finished, and neither the sweep nor this app is the one to
 * say so. The arc file is never touched here either.
 *
 * The `opened` file it replaces has done its work by then: the sweep rebuilds the arc from
 * `arcs/<slug>.md` itself once the file exists, and reads the seeds and title from there.
 */
export async function closeArc(
  slug: string,
  reason: string,
  sources: ArcSources = workspaceSources()
): Promise<ArcVerdict> {
  const want = trimmed(slug);
  if (!isArcSlug(want)) {
    return { error: `"${slug}" is not an arc slug`, ok: false };
  }
  // The verdict already on disk is the answer: the sweep flips `status: closed` on its next
  // tick, so between the press and that tick the arc file still reads open and a second
  // press would otherwise write a second, later close (LIA-149 AC3).
  const already = await readArcDecision(want, sources.decisionsDir);
  if (already?.action === "closed") {
    return { decision: already, ok: true, replay: true };
  }
  const arc = (await sources.arcs()).find((a) => a.slug === want);
  if (!arc) {
    return {
      error: `there is no arcs/${want}.md — the sweep writes it on the tick after the arc is opened`,
      ok: false,
    };
  }
  if (arc.status !== "open") {
    return { error: `that arc is already ${arc.status}`, ok: false };
  }
  const decision: ArcDecision = {
    action: "closed",
    at: new Date().toISOString(),
    point: arcId(want),
    // Carried so the file reads on its own; the sweep takes the arc's own seeds on a close.
    seeds: emptySeeds(),
    slug: want,
    subject: arc.title,
    ...(trimmed(reason) ? { reason: trimmed(reason) } : {}),
  };
  await writeDecision(decision, sources.decisionsDir);
  return { decision, ok: true };
}
