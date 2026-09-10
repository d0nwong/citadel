#!/usr/bin/env bun
/**
 * marauder ingest --landings — a merge on a base branch becomes an event on every feature
 * it touched (ARG-156, ARG-164).
 *
 * A landing is the one input that is a fact rather than a claim: it is on the base branch
 * or it is not. So it attaches without anyone confirming. Where it attaches is read, not
 * guessed, in this order:
 *
 *   1. the journal entry written for the landing — its `features:` is what the change is
 *      about, as the person who journalled it said
 *   2. with no entry yet, the features `pr-facts` maps its changed files to
 *   3. with neither, a feature whose record already holds the PR or a ticket the branch or
 *      the title names
 *
 * Every feature the first rung that answers names gets the event — a landing on two
 * features is on both. A landing that names none goes to `queue/_unsorted.json` and no
 * record changes; the sweep's read step and the correction verbs are what empty that file.
 * Nothing here keeps a stage: the docs refresh says what is true now, and Linear says
 * where a ticket is.
 *
 * Everything here is idempotent. A landing already recorded as an event is skipped, so a
 * second run with nothing new writes no byte. Git is read through `pr-facts`' own helpers,
 * against `origin/staging` and `origin/dev` by sha; nothing here fetches or checks out.
 */

import { landingFeatures, landingsSince, repoOf, type Landing, type RepoKind } from "../../../log-change/scripts/pr-facts.ts";
import { loadAllJournals, type AppJournalEntry } from "../../../../scripts/lib/journal.ts";
import {
  addEvent,
  dirsById,
  emptyWork,
  instantOf,
  loadState,
  saveState,
  type Candidate,
  type FeatureRef,
  type Side,
  type UnsortedItem,
  type Work,
  type WorkEvent,
} from "./record.ts";

/** a repo is a side: the frontend lands on staging, the backend on dev */
const SIDE_OF: Record<RepoKind, Side> = { fe: "fe", be: "be" };

/** how a committer is named in the channel; anyone unmapped keeps the name git has */
const AUTHORS: Record<string, string> = {
  lleung: "you",
  d0nwong: "you",
  "Sam O'Shaughnessy": "Sam O",
  carlosdevv: "Carlos Lopes",
  "Carlos Lopes": "Carlos Lopes",
  "Foong Leung": "Foong Leung",
};

/** a bot is not a person, and a release commit is not work anyone is waiting on */
const BOTS = [/release-token$/, /^dependabot/, /\[bot\]$/];
export const isBot = (author: string) => BOTS.some((b) => b.test(author));

/** how far back to look when no feature holds a landing from that side yet */
const COLD_START_DAYS = 14;

// ---------------------------------------------------------------- the sentence

const CONVENTIONAL = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([^)]*\))?!?:\s*/i;
const LEADING_TAG = /^(\[[A-Za-z]{2,4}\]|[A-Z][A-Z0-9]{1,9}-\d{1,6})[\s:—-]*/;
const URLY = /^https?:\/\/\S*$/;

/**
 * The PR title as something a person could have written. Deterministic and deliberately
 * dull: strip the machinery off the front, and say so when there is nothing left worth
 * saying. A title that is only a link — Foundry opens its PRs with the issue URL as the
 * title — carries no sentence at all, so the summary says what happened and leaves the
 * detail to the evidence line. The sweep's read step is what improves either one.
 */
export function plainSentence(title: string): { text: string; weak: boolean } {
  let t = title.trim();
  if (URLY.test(t)) return { text: "", weak: true };
  t = t.replace(CONVENTIONAL, "");
  while (LEADING_TAG.test(t)) t = t.replace(LEADING_TAG, "");
  t = t.replace(/[.…]+$/, "").trim();
  if (t.length < 8) return { text: "", weak: true };
  // a plainly capitalised first word is sentence case, not a name, so it can join a clause
  const [first = ""] = t.split(/\s+/);
  if (/^[A-Z][a-z]+$/.test(first)) t = t[0]!.toLowerCase() + t.slice(1);
  return { text: t, weak: false };
}

const upperFirst = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

export function landingSummary(l: Landing): string {
  const who = AUTHORS[l.author] ?? l.author;
  const { text, weak } = plainSentence(l.title);
  const what = weak ? `a ${l.repo === "fe" ? "frontend" : "backend"} change` : text;
  return upperFirst(`${who} landed ${what}.`);
}

// ---------------------------------------------------------------- the ladder

const TICKET_IN_BRANCH = /\b((?:arg|ald)-\d+)\b/gi;

/** every ticket a landing names, from its branch and its title, upper-cased */
export const ticketsOf = (l: Landing): string[] => [
  ...new Set([
    ...l.tickets,
    ...[...`${l.branch ?? ""} ${l.title}`.matchAll(TICKET_IN_BRANCH)].map((m) => m[1]!.toUpperCase()),
  ]),
];

/** the journal entry written for this landing, by merge sha or by PR key */
export const journalFor = (l: Landing, journals: AppJournalEntry[]): AppJournalEntry | undefined =>
  journals.find((j) => (j.merge && l.sha.startsWith(j.merge)) || j.pr === l.ref);

/** manifest ids to feature directories, keeping the order and dropping what no app has */
const toDirs = (ids: string[], dirs: Record<string, string>) => [...new Set(ids.map((id) => dirs[id]).filter((d): d is string => !!d))];

export type LadderInput = {
  work: Work[];
  journals: AppJournalEntry[];
  /** manifest id → feature directory, across every app */
  dirs: Record<string, string>;
  /** landing ref → the manifest ids `pr-facts` maps its changed files to */
  named?: Record<string, string[]>;
};

/**
 * The features a landing is on. Rung by rung, stopping at the first that names anything;
 * every feature that rung names is a candidate, and every candidate gets the event.
 */
export function featuresFor(l: Landing, { work, journals, dirs, named = {} }: LadderInput): Candidate[] {
  const entry = journalFor(l, journals);
  if (entry) {
    const fromEntry = toDirs(entry.features, dirs);
    const found = fromEntry.length ? fromEntry : [entry.featureDir];
    return found.map((feature) => ({ feature, how: "ref" as const, why: `the journal entry for ${l.ref} names it` }));
  }

  const mapped = toDirs(named[l.ref] ?? [], dirs);
  if (mapped.length) return mapped.map((feature) => ({ feature, how: "ref" as const, why: `pr-facts maps ${l.ref}'s files to it` }));

  const byPr = work.filter((w) => w.keys.prs.includes(l.ref));
  if (byPr.length) return byPr.map((w) => ({ feature: w.feature, how: "ref" as const, why: `${l.ref} is already on its record` }));
  const tickets = ticketsOf(l);
  return work
    .filter((w) => w.keys.tickets.some((t) => tickets.includes(t)))
    .map((w) => ({ feature: w.feature, how: "ref" as const, why: `it holds ${w.keys.tickets.filter((t) => tickets.includes(t)).join(", ")}, which the branch or title names` }));
}

// ---------------------------------------------------------------- applying

/** a landing this record already holds, by PR key or by sha */
const alreadyHas = (w: Work, l: Landing) =>
  w.events.some((e) => e.source?.ref === l.ref || (e.source?.sha && l.sha.startsWith(e.source.sha)));

export type LandingChange =
  | { kind: "attached"; landing: Landing; features: string[] }
  | { kind: "unsorted"; landing: Landing }
  | { kind: "skipped"; landing: Landing; why: string };

export type ApplyInput = {
  work: Work[];
  landings: Landing[];
  journals: AppJournalEntry[];
  unsorted: UnsortedItem[];
  /** every feature some app has — a landing on a feature with no record opens one */
  features: FeatureRef[];
  named?: Record<string, string[]>;
};
export type ApplyResult = { work: Work[]; unsorted: UnsortedItem[]; changes: LandingChange[] };

/** the whole ingest as one pure function of what was read; the runner only does the IO */
export function applyLandings({ work, landings, journals, unsorted, features, named }: ApplyInput): ApplyResult {
  const byFeature = new Map(work.map((w) => [w.feature, structuredClone(w)]));
  const seenUnsorted = new Map(unsorted.map((u) => [u.id, u]));
  const known = new Set([...features.map((f) => f.feature), ...work.map((w) => w.feature)]);
  const dirs = dirsById(features);
  const changes: LandingChange[] = [];

  for (const l of [...landings].sort((a, b) => a.at.localeCompare(b.at))) {
    if (isBot(l.author)) {
      changes.push({ kind: "skipped", landing: l, why: "a release bot, not a person" });
      continue;
    }
    const holder = [...byFeature.values()].find((w) => alreadyHas(w, l));
    if (holder) {
      changes.push({ kind: "skipped", landing: l, why: `already an event on ${holder.feature}` });
      continue;
    }

    const candidates = featuresFor(l, { work: [...byFeature.values()], journals, dirs, named }).filter((c) => known.has(c.feature));
    if (!candidates.length) {
      if (seenUnsorted.has(l.ref)) changes.push({ kind: "skipped", landing: l, why: "already unsorted" });
      else {
        seenUnsorted.set(l.ref, unsortedItem(l));
        changes.push({ kind: "unsorted", landing: l });
      }
      continue;
    }

    const entry = journalFor(l, journals);
    const ticket = ticketsOf(l)[0];
    for (const c of candidates) {
      const w = byFeature.get(c.feature) ?? emptyWork(c.feature, l.at);
      byFeature.set(c.feature, w);
      const event: WorkEvent = {
        at: l.at,
        kind: "verified-landing",
        side: SIDE_OF[l.repo],
        summary: landingSummary(l),
        source: { type: "pr", ref: l.ref, ...(l.url ? { url: l.url } : {}), sha: l.short },
        attached: { how: "ref", confidence: "certain" },
        ...(ticket ? { ticket } : {}),
        ...(entry ? { evidence: entry.rel } : {}),
      };
      addEvent(w, event);
      if (!w.keys.prs.includes(l.ref)) w.keys.prs = [...w.keys.prs, l.ref];
    }
    // a landing a reader once queued is placed now; it leaves the queue
    seenUnsorted.delete(l.ref);
    changes.push({ kind: "attached", landing: l, features: candidates.map((c) => c.feature) });
  }

  return {
    work: [...byFeature.values()],
    unsorted: [...seenUnsorted.values()].sort((a, b) => a.at.localeCompare(b.at)),
    changes,
  };
}

const unsortedItem = (l: Landing): UnsortedItem => ({
  id: l.ref,
  kind: "landing",
  summary: landingSummary(l),
  source: { type: "pr", ref: l.ref, ...(l.url ? { url: l.url } : {}), sha: l.short },
  candidates: [],
  why: "no journal entry for it yet, and pr-facts maps its files to no feature",
  suggest: null,
  needs: "read",
  at: l.at,
});

// ---------------------------------------------------------------- running

/** the day to read from: the newest landing any feature holds from this side, else a cold start */
export function sinceFor(work: Work[], side: Side, today: string): string {
  const newest = work
    .flatMap((w) => w.events)
    .filter((e) => e.kind === "verified-landing" && e.side === side)
    .map((e) => instantOf(e.at))
    .sort()
    .at(-1);
  if (newest) return newest.slice(0, 10);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - COLD_START_DAYS);
  return d.toISOString().slice(0, 10);
}

export type RunOpts = { root: string; since?: string; now?: string; dryRun?: boolean; sides?: Side[] };
export type RunResult = ApplyResult & { written: string[] };

export async function run(opts: RunOpts): Promise<RunResult> {
  const now = opts.now ?? new Date().toISOString();
  const before = await loadState(opts.root);
  const journals = await loadAllJournals(opts.root);

  const landings: Landing[] = [];
  const named: Record<string, string[]> = {};
  for (const kind of (opts.sides ?? ["fe", "be"]) as RepoKind[]) {
    const repo = repoOf(kind);
    for (const l of await landingsSince(repo, opts.since ?? sinceFor(before.work, SIDE_OF[kind], now.slice(0, 10)))) {
      landings.push(l);
      // pr-facts reads the diff, so only for a landing no record holds and no entry names yet
      const held = before.work.some((w) => alreadyHas(w, l));
      if (!held && !isBot(l.author) && !journalFor(l, journals)) named[l.ref] = await landingFeatures(repo, l.sha).catch(() => []);
    }
  }

  const result = applyLandings({ ...before, landings, journals, named });
  const written = opts.dryRun ? [] : await saveState(opts.root, before, { ...before, work: result.work, unsorted: result.unsorted });
  return { ...result, written };
}

/** what a run did, for the reader of a tick's log — never for a rendered page */
export function formatChanges(changes: LandingChange[]): string {
  return changes
    .map((c) =>
      c.kind === "attached"
        ? `  ${c.landing.ref.padEnd(9)} → ${c.features.join(", ")}`
        : c.kind === "unsorted"
          ? `  ${c.landing.ref.padEnd(9)} → unsorted · no feature named`
          : `  ${c.landing.ref.padEnd(9)} — ${c.why}`,
    )
    .join("\n");
}
