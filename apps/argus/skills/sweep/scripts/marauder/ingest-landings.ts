#!/usr/bin/env bun
/**
 * marauder ingest --landings — a merge on a base branch becomes an event (ARG-156).
 *
 * A landing is the one input that is a fact rather than a claim: it is on the base branch
 * or it is not. So it attaches without anyone confirming, and moves that side's stage to
 * `landed`. What it never does is decide a workstream is `verified` or `shipped` — those
 * need the docs refresh and the reader.
 *
 * The ladder, in order, and it stops at the first rung that answers:
 *
 *   1. the PR number is already in a workstream's `keys.prs`
 *   2. the branch or the title names a ticket in a workstream's `keys.tickets`
 *   3. the journal entry for the same sha names tickets or features that only one
 *      workstream claims
 *
 * Two workstreams answering, or none, and the landing goes to `workstreams/_unsorted.json`
 * with every candidate and why it matched, and no workstream file changes. The sweep's
 * read step and the correction verbs are what empty that file.
 *
 * Everything here is idempotent. A landing already recorded as an event is skipped, so a
 * second run with nothing new writes no byte. Git is read through `pr-facts`' own helper,
 * against `origin/staging` and `origin/dev` by sha; nothing here fetches or checks out.
 */

import { join } from "node:path";
import { landingsSince, repoOf, type Landing, type RepoKind } from "../../../log-change/scripts/pr-facts.ts";
import { loadAllJournals, type AppJournalEntry } from "../../../../scripts/lib/journal.ts";
import {
  UNSORTED_FILE,
  WORKSTREAMS_DIR,
  humanStage,
  instantOf,
  serializeWorkstream,
  loadWorkstreams,
  type AttachHow,
  type Confidence,
  type Side,
  type Stage,
  type UnsortedItem,
  type Workstream,
  type WorkstreamEvent,
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

/** how far back to look when no side has a landing yet */
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

export type Candidate = { slug: string; how: AttachHow; why: string };

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

/**
 * Who claims this landing. Rung by rung, stopping at the first rung that answers at all —
 * a rung that answers twice is an ambiguity to be resolved, not a reason to try the next
 * rung, which would only ever be weaker.
 */
export function candidatesFor(l: Landing, workstreams: Workstream[], journals: AppJournalEntry[]): Candidate[] {
  const byPr = workstreams.filter((w) => w.keys.prs.includes(l.ref));
  if (byPr.length) return byPr.map((w) => ({ slug: w.slug, how: "ref" as const, why: `${l.ref} is one of its PRs` }));

  const tickets = ticketsOf(l);
  const byTicket = workstreams.filter((w) => w.keys.tickets.some((t) => tickets.includes(t)));
  if (byTicket.length)
    return byTicket.map((w) => ({
      slug: w.slug,
      how: "ref" as const,
      why: `it owns ${w.keys.tickets.filter((t) => tickets.includes(t)).join(", ")}, which the branch or title names`,
    }));

  const entry = journalFor(l, journals);
  if (!entry) return [];
  const byEntryTicket = workstreams.filter((w) => w.keys.tickets.some((t) => entry.tickets.includes(t)));
  if (byEntryTicket.length)
    return byEntryTicket.map((w) => ({ slug: w.slug, how: "vocab" as const, why: `the journal entry for this landing names ${entry.tickets.join(", ")}` }));

  const feats = entry.features.map((f) => f.replace(/^admin-/, "admin/"));
  const byFeature = workstreams.filter((w) => w.features.some((f) => feats.includes(f)));
  return byFeature.map((w) => ({ slug: w.slug, how: "vocab" as const, why: `the journal entry for this landing is filed under ${entry.features.join(", ")}` }));
}

// ---------------------------------------------------------------- applying

const rank: Record<Stage, number> = { asked: 0, decided: 1, building: 2, landed: 3, verified: 4, shipped: 5 };
/**
 * Only a side still on its way to the branch moves; `verified` and `shipped` are verdicts
 * and a landing after one of them is a follow-up. A side the record never had starts here.
 */
const advances = (s: Stage | undefined) => s === undefined || rank[s] < rank.landed;

/** a landing this record already holds, by PR key or by sha */
const alreadyHas = (w: Workstream, l: Landing) =>
  w.events.some((e) => e.source?.ref === l.ref || (e.source?.sha && l.sha.startsWith(e.source.sha)));

export type LandingChange =
  | { kind: "attached"; landing: Landing; slug: string; how: AttachHow; confidence: Confidence; stage: string | null }
  | { kind: "unsorted"; landing: Landing; candidates: Candidate[] }
  | { kind: "skipped"; landing: Landing; why: string };

export type ApplyInput = {
  workstreams: Workstream[];
  landings: Landing[];
  journals: AppJournalEntry[];
  unsorted: UnsortedItem[];
};
export type ApplyResult = { workstreams: Workstream[]; unsorted: UnsortedItem[]; changes: LandingChange[] };

/** the whole ingest as one pure function of what was read; the runner only does the IO */
export function applyLandings({ workstreams, landings, journals, unsorted }: ApplyInput): ApplyResult {
  const byslug = new Map(workstreams.map((w) => [w.slug, structuredClone(w)]));
  const seenUnsorted = new Map(unsorted.map((u) => [u.id, u]));
  const changes: LandingChange[] = [];

  for (const l of [...landings].sort((a, b) => a.at.localeCompare(b.at))) {
    if (isBot(l.author)) {
      changes.push({ kind: "skipped", landing: l, why: "a release bot, not a person" });
      continue;
    }
    const holder = [...byslug.values()].find((w) => alreadyHas(w, l));
    if (holder) {
      changes.push({ kind: "skipped", landing: l, why: `already an event on ${holder.slug}` });
      continue;
    }

    const candidates = candidatesFor(l, [...byslug.values()], journals);
    if (candidates.length !== 1) {
      const item = unsortedItem(l, candidates);
      if (seenUnsorted.has(item.id)) changes.push({ kind: "skipped", landing: l, why: "already unsorted" });
      else {
        seenUnsorted.set(item.id, item);
        changes.push({ kind: "unsorted", landing: l, candidates });
      }
      continue;
    }

    const only = candidates[0]!;
    const w = byslug.get(only.slug)!;
    const side = SIDE_OF[l.repo];
    const confidence: Confidence = only.how === "ref" ? "certain" : "likely";
    // a person who said where this side really is outranks what a landing implies, until
    // the next landing; when they said it is behind `landed`, the disagreement is queued
    const held = humanStage(w, side);
    if (held && rank[held.stage] < rank.landed) {
      const item = unsortedItem(l, candidates);
      const id = `${item.id}/stage`;
      if (!seenUnsorted.has(id))
        seenUnsorted.set(id, {
          ...item,
          id,
          why: `${l.ref} is on the branch, and someone set ${w.slug}'s ${side} to ${held.stage} after the last landing`,
          suggest: w.slug,
          needs: "ask",
        });
    }
    const moved = !held && advances(w.stage[side]);
    const event: WorkstreamEvent = {
      at: l.at,
      kind: "verified-landing",
      side,
      summary: landingSummary(l),
      source: { type: "pr", ref: l.ref, ...(l.url ? { url: l.url } : {}), sha: l.short },
      attached: { how: only.how, confidence },
      ...(ticketsOf(l)[0] ? { ticket: ticketsOf(l)[0] } : {}),
      ...(journalFor(l, journals) ? { evidence: journalFor(l, journals)!.rel } : {}),
      ...(moved ? { action: `stage ${side} → landed` } : {}),
    };
    w.events = [...w.events, event].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at)));
    if (moved) w.stage[side] = "landed";
    if (!w.keys.prs.includes(l.ref)) w.keys.prs = [...w.keys.prs, l.ref];
    w.updated = instantOf(l.at) > instantOf(w.updated) ? l.at : w.updated;
    changes.push({ kind: "attached", landing: l, slug: w.slug, how: only.how, confidence, stage: moved ? `${side} → landed` : null });
  }

  return {
    workstreams: [...byslug.values()],
    unsorted: [...seenUnsorted.values()].sort((a, b) => a.at.localeCompare(b.at)),
    changes,
  };
}

const unsortedItem = (l: Landing, candidates: Candidate[]): UnsortedItem => ({
  id: l.ref,
  kind: "landing",
  summary: landingSummary(l),
  source: { type: "pr", ref: l.ref, ...(l.url ? { url: l.url } : {}), sha: l.short },
  candidates,
  suggest: candidates.length ? candidates[0]!.slug : null,
  needs: "read",
  at: l.at,
});

// ---------------------------------------------------------------- running

/** the day to read from: the newest landing this side already holds, else a cold start */
export function sinceFor(workstreams: Workstream[], side: Side, today: string): string {
  const newest = workstreams
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
  const { workstreams } = await loadWorkstreams(opts.root);
  const journals = await loadAllJournals(opts.root);
  const unsortedPath = join(opts.root, WORKSTREAMS_DIR, UNSORTED_FILE);
  const unsorted: UnsortedItem[] = (await Bun.file(unsortedPath).exists()) ? await Bun.file(unsortedPath).json() : [];

  const landings: Landing[] = [];
  for (const kind of (opts.sides ?? ["fe", "be"]) as RepoKind[])
    landings.push(...(await landingsSince(repoOf(kind), opts.since ?? sinceFor(workstreams, SIDE_OF[kind], now.slice(0, 10)))));

  const result = applyLandings({ workstreams, landings, journals, unsorted });
  const written: string[] = [];
  if (!opts.dryRun) {
    const before = new Map(workstreams.map((w) => [w.slug, serializeWorkstream(w)]));
    for (const w of result.workstreams) {
      const text = serializeWorkstream(w);
      if (before.get(w.slug) === text) continue;
      await Bun.write(join(opts.root, WORKSTREAMS_DIR, `${w.slug}.json`), text);
      written.push(`${WORKSTREAMS_DIR}/${w.slug}.json`);
    }
    const unsortedText = `${JSON.stringify(result.unsorted, null, 2)}\n`;
    const had = (await Bun.file(unsortedPath).exists()) ? await Bun.file(unsortedPath).text() : "";
    if (had !== unsortedText && (result.unsorted.length || had)) {
      await Bun.write(unsortedPath, unsortedText);
      written.push(`${WORKSTREAMS_DIR}/${UNSORTED_FILE}`);
    }
  }
  return { ...result, written };
}

/** what a run did, for the reader of a tick's log — never for a rendered page */
export function formatChanges(changes: LandingChange[]): string {
  return changes
    .map((c) =>
      c.kind === "attached"
        ? `  ${c.landing.ref.padEnd(9)} → ${c.slug}${c.stage ? ` (${c.stage})` : ""} · ${c.how}/${c.confidence}`
        : c.kind === "unsorted"
          ? `  ${c.landing.ref.padEnd(9)} → unsorted · ${c.candidates.length} candidate(s)${c.candidates.length ? `: ${c.candidates.map((x) => x.slug).join(", ")}` : ""}`
          : `  ${c.landing.ref.padEnd(9)} — ${c.why}`,
    )
    .join("\n");
}
