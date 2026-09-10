#!/usr/bin/env bun
/**
 * marauder render — the pages a person reads, from the features' `work.json` alone
 * (ARG-155, over features since ARG-164).
 *
 * `board.md` says what needs the reader, then what is going on in each feature that moved
 * this week. `changelog/<day>.md` is what changed in the project that day, by feature.
 * `<app>/features/<dir>/board.md` is one feature's story, beside its docs, and
 * `marauder show <feature>` prints it (ARG-166).
 *
 * Two rules hold the whole file together. **Nothing but the record is read** — the one
 * thing beside it is `FeatureMeta`, the manifest's name and the docs' stamps, which the
 * command line hands in. No Slack, no Linear, no git, no `.state/`; if a page needs one
 * of them the record is incomplete and that is the bug. And **the same record renders the same bytes**, so a run that
 * changed nothing writes nothing: `now` is passed in and floored to its day, and no page
 * carries a stamp.
 *
 * Every page goes through `checkStyle` before it is written. The three mechanical rules
 * are `skills/sweep/style.md`'s, and the banned-word list lives here beside the checker so
 * the two cannot drift.
 */

import { CONFIRMED } from "./correct.ts";
import {
  instantOf,
  latestEvent,
  type Milestone,
  type Milestones,
  type OpenQuestion,
  USER,
  type Work,
  type WorkEvent,
} from "./record.ts";

export { USER };

export const OUT_DIR = "marauder";

// ---------------------------------------------------------------- the style checker

/** `skills/sweep/style.md` rule 2 — the system's own dialect, which a reader has to translate */
export const BANNED_WORDS = ["tick", "ticks", "tier", "tiers", "arc", "arcs", "point", "points", "supersedes", "corroborated"];
export const BANNED_PREFIXES = ["BR-", "MM-"];
/** rule 3 */
export const SENTENCE_WORDS = 25;

const ID_AT_START = /^((?:ARG|ALD)-\d+|fe#\d+|be#\d+|BR-[A-Za-z0-9-]+|MM-\d+)\b/;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** a line of nothing but links joined by the separator is an evidence line, not prose */
const isEvidenceLine = (line: string) => /\]\(/.test(line) && line.replace(LINK, "").replace(/[·\s]/g, "") === "";
const visible = (line: string) => line.replace(LINK, "$1").replace(/[*_`>]/g, "").replace(/^#+\s*/, "").replace(/^[-*]\s+/, "").trim();

export type StyleProblem = { line: number; text: string; rule: string };

/** everything the renderer refuses to write, as the line it is on */
export function checkStyle(markdown: string): StyleProblem[] {
  const out: StyleProblem[] = [];
  markdown.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const text = visible(raw);
    if (!text) return;
    if (ID_AT_START.test(text)) out.push({ line, text: raw, rule: "a line of reader text starts with an id" });
    const lower = text.toLowerCase();
    for (const w of BANNED_WORDS)
      if (new RegExp(`\\b${w}\\b`).test(lower)) out.push({ line, text: raw, rule: `"${w}" is the system's own dialect` });
    for (const p of BANNED_PREFIXES)
      if (text.includes(p)) out.push({ line, text: raw, rule: `"${p}" is a rule id, and belongs on the evidence line` });
    if (isEvidenceLine(raw) || raw.startsWith("#")) return;
    for (const s of text.split(/(?<=[.!?])\s+/)) {
      const words = s.split(/\s+/).filter(Boolean).length;
      if (words > SENTENCE_WORDS) out.push({ line, text: s, rule: `${words} words, over the ${SENTENCE_WORDS}-word ceiling` });
    }
  });
  return out;
}

export const formatStyleProblems = (file: string, problems: StyleProblem[]) =>
  problems.map((p) => `${file}:${p.line} — ${p.rule}\n    ${p.text}`).join("\n");

// ---------------------------------------------------------------- words

/** a doc's `last_verified` stamp, as `scripts/lib/stamps.ts` reads it */
export type DocStamp = { rev: string; date?: string };

/**
 * What a page knows of a feature beyond its record: the manifest's name for it, the app it
 * sits in, and the stamps on its docs. The command line reads these; rendering stays pure.
 */
export type FeatureMeta = {
  app: string;
  name?: string;
  docs?: { product: boolean; arch: boolean; fe?: DocStamp; be?: DocStamp };
  /** the app has a backend repo, so a missing backend stamp is worth saying */
  hasBackend?: boolean;
};
export type FeatureMetas = Record<string, FeatureMeta>;

const upperFirst = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** how a feature is said out loud: the manifest's name, else its last folder in words */
export const featureTitle = (feature: string, meta: FeatureMetas = {}): string =>
  meta[feature]?.name ?? upperFirst(feature.split("/").at(-1)!.replace(/-/g, " "));

const firstName = (person: string) => (person === USER.token ? "you" : person.split(/\s+/)[0]!);
const owns = (person: string) => (person === USER.token ? USER.name : person);

/**
 * An open question as a sentence. What the reader was waiting on someone for is a phrase
 * ("which roles a Usage row should show"), so it reads as who they are waiting on and for
 * what; a question written as a sentence keeps its own words and says whose move it is.
 */
export function questionSentence(q: OpenQuestion): string {
  const text = q.q.trim().replace(/[.]+$/, "");
  if (q.owner && q.owner !== USER.token && /^[a-z]/.test(text)) return `You are waiting on ${firstName(q.owner)} for ${text}.`;
  return `${upperFirst(text)}${/[?!]$/.test(text) ? "" : "."}${q.owner ? ` ${owns(q.owner)} to answer.` : ""}`;
}

// ---------------------------------------------------------------- days

const dayOf = (at: string) => at.slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** "today", "tomorrow", "on Thursday" — the words a person uses about a date this week */
const whenWord = (today: string, day: string) => {
  const n = daysBetween(today, day);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1) return `on ${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}`;
  return `on ${longDate(day)}`;
};

/** the date the page puts in front of an event line — four words the sentence ceiling has to leave room for */
export const whenLabel = (at: string) => {
  const day = dayOf(at);
  if (at.length === 10) return longDate(day);
  return `${longDate(day)}, ${at.slice(11, 16)}`;
};

// ---------------------------------------------------------------- evidence

/** a repo path is linked relative to the page it is on, so the same record renders anywhere */
export type Ctx = { now: string; today: string; base: string };

const link = (label: string, url: string) => `[${label}](${url})`;

/** what a piece of evidence is called, from where it lives */
const evidenceLabel = (ref: string) =>
  !ref.startsWith("http") ? "the journal entry"
    : ref.includes("linear.app") ? "the ticket"
    : ref.includes("github.com") ? "the PR"
    : "the evidence";

const evidenceLink = (ref: string, base: string) => link(evidenceLabel(ref), ref.startsWith("http") ? ref : base + ref);

const sourceLabel = (e: WorkEvent): string => {
  const t = e.source?.type;
  if (t === "pr") return e.source!.ref.startsWith("be") ? "the backend PR" : "the frontend PR";
  if (t === "huddle") return "the huddle notes";
  if (t === "slack") return "the message";
  if (t === "ticket") return e.source!.ref;
  return "the entry";
};

/**
 * One muted line under the sentence: links only, the ticket last so no line ever starts
 * with an id. A blank line above it keeps the renderer from joining it onto the sentence.
 */
function evidenceLine(e: WorkEvent | undefined, ctx: Ctx): string | null {
  if (!e) return null;
  const parts: string[] = [];
  if (e.source?.url && e.source.type !== "ticket") parts.push(link(sourceLabel(e), e.source.url));
  if (e.evidence) parts.push(evidenceLink(e.evidence, ctx.base));
  const ticket = e.ticket ?? (e.source?.type === "ticket" ? e.source.ref : undefined);
  // the key reads as an id, so it is only ever a label when something else opens the line
  if (ticket) parts.push(link(parts.length ? ticket : "the ticket", `https://linear.app/liamai/issue/${ticket}`));
  return parts.length ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------- what goes where

/** a `verified` decision answers the ask; once stamped, it is done and drops off the board */
export const asksForYou = (w: Work): WorkEvent[] =>
  w.events.filter(
    (e) => e.kind === "directed-at-person" && (e.to ?? []).includes(USER.token) && !e.action?.startsWith(CONFIRMED),
  );

export const questionsForYou = (w: Work) => w.open_questions.filter((q) => q.owner === USER.token);
const questionsForOthers = (w: Work) => w.open_questions.filter((q) => q.owner !== USER.token);

const newestFirst = (a: WorkEvent, b: WorkEvent) => instantOf(b.at).localeCompare(instantOf(a.at));

/** what the reader owes, newest first: every ask aimed at them and every question they own */
function owedByYou(w: Work): { at: string; text: string; e: WorkEvent | undefined }[] {
  return [
    ...asksForYou(w).map((e) => ({ at: instantOf(e.at), text: e.summary, e })),
    ...questionsForYou(w).map((q) => ({ at: instantOf(q.at), text: questionSentence(q), e: latestEvent(w) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

/** a board section says what landed, then what was decided or asked, then the rest */
const LANDED = new Set(["verified-landing"]);
const DECIDED = new Set(["contract-change", "new-ask", "answers-question"]);
const sectionOrder = (e: WorkEvent) => (LANDED.has(e.kind) ? 0 : DECIDED.has(e.kind) ? 1 : 2);

function milestoneSentence(work: Work[], milestones: Milestones, ctx: Ctx): string | null {
  const pointedAt = new Set(work.map((w) => w.milestone).filter(Boolean));
  const soon = Object.entries(milestones)
    .filter(([key, m]) => pointedAt.has(key) && daysBetween(ctx.today, m.date) >= 0 && daysBetween(ctx.today, m.date) <= 7)
    .sort((a, b) => a[1].date.localeCompare(b[1].date))[0];
  if (!soon) return null;
  const m = soon[1] as Milestone;
  return `${firstName(m.owner)}'s ${m.name.toLowerCase()} is ${whenWord(ctx.today, m.date)}, ${longDate(m.date)}.`;
}

// ---------------------------------------------------------------- the board

export type BoardInput = { work: Work[]; milestones: Milestones; now: string; meta?: FeatureMetas };

/** how many of a feature's events this week the board says, newest first within each kind */
const BOARD_EVENTS = 3;

/**
 * The one page that says where everything stands: the date it all points at, what needs
 * the reader, one section per feature with an event in the last seven days, and last what
 * the reader is waiting on others for, by whom. A feature that did not move is left off.
 */
export function renderBoard({ work, milestones, now, meta = {} }: BoardInput): string {
  const ctx: Ctx = { now, today: dayOf(now), base: "../" };
  const since = addDays(ctx.today, -7);
  const thisWeek = (w: Work) => w.events.filter((e) => dayOf(instantOf(e.at)) >= since).sort(newestFirst);
  const title = (w: Work) => featureTitle(w.feature, meta);

  const out: string[] = ["# Where the work stands", ""];
  const deadline = milestoneSentence(work, milestones, ctx);
  if (deadline) out.push(deadline, "");

  const needs = work
    .flatMap((w) => owedByYou(w).map((i) => ({ ...i, w })))
    .sort((a, b) => b.at.localeCompare(a.at) || a.w.feature.localeCompare(b.w.feature));
  if (needs.length) {
    out.push("## Needs you", "");
    for (const i of needs) {
      out.push(`**${title(i.w)}**`, "", i.text);
      const ev = evidenceLine(i.e, ctx);
      if (ev) out.push("", ev);
      out.push("");
    }
  }

  const moving = work
    .map((w) => ({ w, events: thisWeek(w) }))
    .filter((x) => x.events.length)
    .sort((a, b) => instantOf(b.events[0]!.at).localeCompare(instantOf(a.events[0]!.at)) || a.w.feature.localeCompare(b.w.feature));
  for (const { w, events } of moving) {
    const page = meta[w.feature] ? featurePagePath(meta[w.feature]!.app, w.feature) : null;
    out.push(`## ${page ? link(title(w), ctx.base + page) : title(w)}`, "");
    const said = [...events].sort((a, b) => sectionOrder(a) - sectionOrder(b) || newestFirst(a, b)).slice(0, BOARD_EVENTS);
    for (const e of said) out.push(e.summary);
    for (const q of w.open_questions) out.push(questionSentence(q));
    const ev = evidenceLine(events[0], ctx);
    if (ev) out.push("", ev);
    out.push("");
  }

  const byOwner = new Map<string, { w: Work; q: OpenQuestion }[]>();
  for (const w of work) for (const q of questionsForOthers(w)) {
    const owner = q.owner ?? "someone";
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), { w, q }]);
  }
  if (byOwner.size) {
    out.push("## Waiting on others", "");
    for (const [owner, items] of [...byOwner].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`**${owner === "someone" ? "No one named yet" : owner}**`, "");
      const byFeature = new Map<Work, OpenQuestion[]>();
      for (const { w, q } of items) byFeature.set(w, [...(byFeature.get(w) ?? []), q]);
      for (const [w, qs] of [...byFeature].sort((a, b) => a[0].feature.localeCompare(b[0].feature))) {
        out.push(`*${title(w)}*`, "");
        for (const q of qs.sort((a, b) => b.at.localeCompare(a.at))) out.push(`- ${questionSentence(q)}`);
        out.push("");
      }
    }
  }

  if (!needs.length && !moving.length) out.push("Nothing moved this week.", "");
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ---------------------------------------------------------------- one feature

/** where a feature's page sits, relative to the workspace root */
export const featurePagePath = (app: string, feature: string) => `${app}/features/${feature}/${FEATURE_PAGE}`;
export const FEATURE_PAGE = "board.md";

/** the up-directories from a feature's page back to the workspace root */
const baseFor = (app: string, feature: string) => "../".repeat(featurePagePath(app, feature).split("/").length - 1);

/** "front end at `fe@1a2b3c4` on 9 September" — a doc stamp said out loud */
const stampWords = (side: string, s: DocStamp | undefined) =>
  s ? `${side} checked at \`${s.rev}\`${s.date ? ` on ${longDate(s.date)}` : ""}` : `${side} not yet checked`;

/** the one line linking the feature's docs, or saying it has none yet */
function docsLine(m: FeatureMeta | undefined): string {
  const d = m?.docs;
  if (!d || (!d.product && !d.arch)) return "This feature has no docs yet.";
  const links = [d.product ? link("product doc", "docs/product.md") : null, d.arch ? link("architecture doc", "docs/arch.md") : null].filter(Boolean);
  const stamps = [stampWords("Front end", d.fe), ...(d.be || m?.hasBackend ? [stampWords("backend", d.be)] : [])];
  return `The ${links.join(" and ")} say what it does. ${stamps.join(", ")}.`;
}

/**
 * The page beside a feature's docs: what the docs say is linked, not pasted, then what needs
 * the reader, what is still open, and every event newest first. Links are written relative
 * to the page's own folder, so they hold wherever the feature sits.
 */
export function renderFeature(w: Work, milestones: Milestones, now: string, meta: FeatureMetas = {}): string {
  const m = meta[w.feature];
  const ctx: Ctx = { now, today: dayOf(now), base: m ? baseFor(m.app, w.feature) : "../" };
  const out: string[] = [`# ${featureTitle(w.feature, meta)}`, "", docsLine(m), ""];

  const ms = w.milestone ? milestones[w.milestone] : undefined;
  if (ms) out.push(`${firstName(ms.owner)}'s ${ms.name.toLowerCase()} is ${whenWord(ctx.today, ms.date)}, ${longDate(ms.date)}.`, "");

  const owed = owedByYou(w);
  if (owed.length) {
    out.push("## Needs you", "");
    for (const i of owed) {
      out.push(i.text);
      const ev = evidenceLine(i.e, ctx);
      if (ev) out.push("", ev);
      out.push("");
    }
  }

  const others = questionsForOthers(w);
  if (others.length) {
    out.push("## Still open", "");
    for (const q of others) out.push(`- ${questionSentence(q)}`);
    out.push("");
  }

  out.push("## What happened", "");
  for (const e of [...w.events].sort(newestFirst)) {
    out.push(`**${whenLabel(e.at)}** — ${e.summary}`);
    const ev = evidenceLine(e, ctx);
    if (ev) out.push("", ev);
    out.push("");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ---------------------------------------------------------------- the day

/** a raw Slack-quote summary has no terminal punctuation; joining two of them with a
 *  bare space reads as one run-on sentence and can trip the 25-word ceiling */
const asSentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** what changed in the project that day, by feature, and nothing about features that did not move */
export function renderChangelog(work: Work[], day: string, meta: FeatureMetas = {}): string {
  const ctx: Ctx = { now: `${day}T00:00:00Z`, today: day, base: "../../" };
  const moved = work
    .map((w) => ({ w, events: w.events.filter((e) => dayOf(e.at) === day) }))
    .filter((x) => x.events.length)
    .sort((a, b) => instantOf(b.events.at(-1)!.at).localeCompare(instantOf(a.events.at(-1)!.at)) || a.w.feature.localeCompare(b.w.feature));

  const out: string[] = [`# ${longDate(day)}`, ""];
  if (!moved.length) return `${out.join("\n")}Nothing moved.\n`;
  for (const { w, events } of moved) {
    const sorted = [...events].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at)));
    const m = meta[w.feature];
    const name = featureTitle(w.feature, meta);
    out.push(`**${m ? link(name, ctx.base + featurePagePath(m.app, w.feature)) : name}**`, "", sorted.map((e) => asSentence(e.summary)).join(" "));
    const ev = evidenceLine(sorted.at(-1), ctx);
    if (ev) out.push("", ev);
    out.push("");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}
