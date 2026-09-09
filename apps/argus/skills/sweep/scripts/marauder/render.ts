#!/usr/bin/env bun
/**
 * marauder render — every page a person reads, from `workstreams/*.json` alone (LIA-155).
 *
 * Three pages. `board.md` says where every open workstream stands right now: what needs
 * the reader, what is in flight by area, what waits on someone else, what shipped this
 * week. `<slug>.md` is one workstream's story. `changelog/<day>.md` is what changed in the
 * project that day.
 *
 * Two rules hold the whole file together. **Nothing but the record is read** — no Slack,
 * no Linear, no git, no `.state/`; if a page needs one of them the record is incomplete
 * and that is the bug. And **the same record renders the same bytes**, so a tick that
 * changed nothing writes nothing: `now` is passed in and floored to its day, and no page
 * carries a stamp.
 *
 * Every page goes through `checkStyle` before it is written. The three mechanical rules
 * are `skills/sweep/style.md`'s, and the banned-word list lives here beside the checker so
 * the two cannot drift.
 */

import {
  instantOf,
  latestEvent,
  sidesOf,
  type Milestone,
  type Milestones,
  type Side,
  type Stage,
  USER,
  type Workstream,
  type WorkstreamEvent,
} from "./record.ts";

export { USER };

export const OUT_DIR = "marauder";

// ---------------------------------------------------------------- the style checker

/** `skills/sweep/style.md` rule 2 — the system's own dialect, which a reader has to translate */
export const BANNED_WORDS = ["tick", "ticks", "tier", "tiers", "arc", "arcs", "point", "points", "supersedes", "corroborated"];
export const BANNED_PREFIXES = ["BR-", "MM-"];
/** rule 3 */
export const SENTENCE_WORDS = 25;

const ID_AT_START = /^(LIA-\d+|fe#\d+|be#\d+|BR-[A-Za-z0-9-]+|MM-\d+)\b/;
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

/**
 * How a side reads, per stage. The wording lives in one table so it can be edited without
 * touching a line of logic.
 */
const STAGE_WORDS: Record<Side, Record<Stage, string>> = {
  fe: {
    asked: "the frontend has not been started",
    decided: "the frontend is scoped and waiting to be built",
    building: "the frontend is still in a PR",
    landed: "the frontend is on staging",
    verified: "the frontend is on staging and checked against the docs",
    shipped: "the frontend has shipped",
  },
  be: {
    asked: "the backend has not been started",
    decided: "the backend is agreed and waiting to be built",
    building: "the backend is still in a PR",
    landed: "the backend is on dev",
    verified: "the backend is on dev and checked against the docs",
    shipped: "the backend has shipped",
  },
};

/** how a feature dir is said out loud; anything unmapped falls back to its last segment */
const AREA_WORDS: Record<string, string> = {
  "admin/usage": "Usage",
  "admin/invoicing": "Invoicing",
  "admin/clients": "Clients",
  tasks: "Tasks",
  entities: "Entities",
};

const titleCase = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
const upperFirst = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
export const areaOf = (w: Workstream): string => {
  const first = w.features[0];
  if (!first) return "Elsewhere";
  return AREA_WORDS[first] ?? titleCase(first.split("/").at(-1)!);
};

const firstName = (person: string) => (person === USER.token ? "you" : person.split(/\s+/)[0]!);

/** "The frontend is on staging; the backend is still in a PR." */
export function stageSentence(w: Workstream): string {
  const parts = sidesOf(w).map((s) => STAGE_WORDS[s][w.stage[s]!]);
  return `${upperFirst(parts.join("; "))}.`;
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

const sourceLabel = (e: WorkstreamEvent): string => {
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
function evidenceLine(e: WorkstreamEvent | undefined, ctx: Ctx): string | null {
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

const isParked = (w: Workstream) => w.parked;
const rank = { asked: 0, decided: 1, building: 2, landed: 3, verified: 4, shipped: 5 } as const;
const allSidesLanded = (w: Workstream) => sidesOf(w).every((s) => rank[w.stage[s]!] >= rank.landed);

export const asksForYou = (w: Workstream): WorkstreamEvent[] =>
  w.events.filter((e) => e.kind === "directed-at-person" && (e.to ?? []).includes(USER.token));

export const questionsForYou = (w: Workstream) => w.open_questions.filter((q) => q.owner === USER.token);

const needsYou = (w: Workstream) => asksForYou(w).length > 0 || questionsForYou(w).length > 0;
const waitsOnSomeone = (w: Workstream) => !!w.overlay && w.overlay.waiting_on !== USER.token;

/** landed on every side it records, and the landing was inside the window */
const shippedWithin = (w: Workstream, since: string) =>
  allSidesLanded(w) && dayOf(instantOf(latestEvent(w)?.at ?? "")) >= since;

const byNewest = (a: Workstream, b: Workstream) =>
  instantOf(latestEvent(b)?.at ?? "").localeCompare(instantOf(latestEvent(a)?.at ?? ""));

// ---------------------------------------------------------------- the board

type Block = { name: string; sentences: string[]; evidence: string | null };

const blockLines = (b: Block): string[] => [`**${b.name}**`, "", ...b.sentences, ...(b.evidence ? ["", b.evidence] : [])];

const overlaySentence = (w: Workstream): string | null =>
  w.overlay ? `You are waiting on ${firstName(w.overlay.waiting_on)} for ${w.overlay.for}.` : null;

/** name, at most two sentences from what last happened and what it waits on, then evidence */
function boardBlock(w: Workstream, ctx: Ctx): Block {
  const last = latestEvent(w);
  const sentences = [last?.summary, overlaySentence(w)].filter((s): s is string => !!s).slice(0, 2);
  return { name: w.name, sentences, evidence: evidenceLine(last, ctx) };
}

/** the asks and questions still standing, newest first, one block per workstream */
function needsYouBlock(w: Workstream, ctx: Ctx): Block {
  const items = [
    ...asksForYou(w).map((e) => ({ at: instantOf(e.at), text: e.summary, e })),
    ...questionsForYou(w).map((q) => ({ at: instantOf(q.at), text: q.q, e: latestEvent(w) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return { name: w.name, sentences: items.slice(0, 2).map((i) => i.text), evidence: evidenceLine(items[0]?.e, ctx) };
}

function milestoneSentence(ws: Workstream[], milestones: Milestones, ctx: Ctx): string | null {
  const pointedAt = new Set(ws.map((w) => w.milestone).filter(Boolean));
  const soon = Object.entries(milestones)
    .filter(([slug, m]) => pointedAt.has(slug) && daysBetween(ctx.today, m.date) >= 0 && daysBetween(ctx.today, m.date) <= 7)
    .sort((a, b) => a[1].date.localeCompare(b[1].date))[0];
  if (!soon) return null;
  const m = soon[1] as Milestone;
  return `${firstName(m.owner)}'s ${m.name.toLowerCase()} is ${whenWord(ctx.today, m.date)}, ${longDate(m.date)}.`;
}

export type BoardInput = { workstreams: Workstream[]; milestones: Milestones; now: string };

/** the one page that says where everything stands, in the order a reader needs it */
export function renderBoard({ workstreams, milestones, now }: BoardInput): string {
  const ctx: Ctx = { now, today: dayOf(now), base: "../" };
  const since = addDays(ctx.today, -7);
  const live = workstreams.filter((w) => !isParked(w));

  const needs = live.filter(needsYou).sort(byNewest);
  const taken = new Set(needs.map((w) => w.slug));
  const shipped = live.filter((w) => !taken.has(w.slug) && shippedWithin(w, since)).sort(byNewest);
  for (const w of shipped) taken.add(w.slug);
  const waiting = live.filter((w) => !taken.has(w.slug) && waitsOnSomeone(w)).sort(byNewest);
  for (const w of waiting) taken.add(w.slug);
  const inFlight = live.filter((w) => !taken.has(w.slug)).sort(byNewest);

  const out: string[] = ["# Where the work stands", ""];
  const deadline = milestoneSentence(live, milestones, ctx);
  if (deadline) out.push(deadline, "");

  const section = (heading: string, blocks: Block[]) => {
    if (!blocks.length) return;
    out.push(`## ${heading}`, "");
    for (const b of blocks) out.push(...blockLines(b), "");
  };

  section("Needs you", needs.map((w) => needsYouBlock(w, ctx)));

  if (inFlight.length) {
    out.push("## In flight", "");
    const areas = new Map<string, Workstream[]>();
    for (const w of inFlight) areas.set(areaOf(w), [...(areas.get(areaOf(w)) ?? []), w]);
    for (const [area, ws] of [...areas].sort((a, b) => byNewest(a[1][0]!, b[1][0]!))) {
      out.push(`### ${area}`, "");
      for (const w of ws) out.push(...blockLines(boardBlock(w, ctx)), "");
    }
  }

  if (waiting.length) {
    out.push("## Waiting on others", "");
    const people = new Map<string, Workstream[]>();
    for (const w of waiting) {
      const who = w.overlay!.waiting_on;
      people.set(who, [...(people.get(who) ?? []), w]);
    }
    for (const [who, ws] of [...people].sort((a, b) => byNewest(a[1][0]!, b[1][0]!))) {
      out.push(`### ${who}`, "");
      for (const w of ws) out.push(...blockLines(boardBlock(w, ctx)), "");
    }
  }

  section("Shipped this week", shipped.map((w) => {
    const last = latestEvent(w);
    return { name: w.name, sentences: [last!.summary], evidence: evidenceLine(last, ctx) };
  }));

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ---------------------------------------------------------------- one workstream

/** the story of one workstream: what it is, where it stands, what is open, what happened */
export function renderWorkstream(w: Workstream, milestones: Milestones, now: string): string {
  const ctx: Ctx = { now, today: dayOf(now), base: "../" };
  const out: string[] = [`# ${w.name}`, ""];

  const who: string[] = [];
  if (w.driver) who.push(`${w.driver === USER.name ? "You drive" : `${w.driver} drives`} this`);
  if (w.wants.length) who.push(`${w.wants.join(" and ")} ${w.wants.length > 1 ? "want" : "wants"} it`);
  if (who.length) out.push(`${who.join(", and ")}.`, "");
  out.push(`Done means: ${w.done}`, "");
  out.push(stageSentence(w), "");

  const m = w.milestone ? milestones[w.milestone] : undefined;
  if (m) out.push(`${firstName(m.owner)}'s ${m.name.toLowerCase()} is ${whenWord(ctx.today, m.date)}, ${longDate(m.date)}.`, "");
  if (w.overlay) out.push(`You are waiting on ${firstName(w.overlay.waiting_on)} for ${w.overlay.for}.`, "");
  if (w.parked) out.push("This is parked.", "");

  if (w.open_questions.length) {
    out.push("## Still open", "");
    for (const q of w.open_questions) out.push(`- ${q.q}${q.owner ? ` ${owns(q.owner)} to answer.` : ""}`);
    out.push("");
  }

  if (w.facts.length) {
    out.push("## What is settled", "");
    for (const f of w.facts) {
      const cite = f.evidence ? ` ${evidenceLink(f.evidence, ctx.base)}` : "";
      out.push(`- ${f.fact}${cite}`);
    }
    out.push("");
  }

  out.push("## What happened", "");
  const events = [...w.events].sort((a, b) => instantOf(b.at).localeCompare(instantOf(a.at)));
  for (const e of events) {
    out.push(`**${whenLabel(e.at)}** — ${e.summary}`);
    const ev = evidenceLine(e, ctx);
    if (ev) out.push("", ev);
    out.push("");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

const owns = (person: string) => (person === USER.token ? USER.name : person);
const whenLabel = (at: string) => {
  const day = dayOf(at);
  if (at.length === 10) return longDate(day);
  return `${longDate(day)}, ${at.slice(11, 16)}`;
};

// ---------------------------------------------------------------- the day

/** what changed in the project that day, and nothing about workstreams that did not move */
export function renderChangelog(workstreams: Workstream[], day: string): string {
  const ctx: Ctx = { now: `${day}T00:00:00Z`, today: day, base: "../../" };
  const moved = workstreams
    .map((w) => ({ w, events: w.events.filter((e) => dayOf(e.at) === day) }))
    .filter((x) => x.events.length)
    .sort((a, b) => instantOf(b.events.at(-1)!.at).localeCompare(instantOf(a.events.at(-1)!.at)));

  const out: string[] = [`# ${longDate(day)}`, ""];
  if (!moved.length) return `${out.join("\n")}Nothing moved.\n`;
  for (const { w, events } of moved) {
    const sorted = [...events].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at)));
    out.push(`**${w.name}**`, "", sorted.map((e) => e.summary).join(" "));
    const ev = evidenceLine(sorted.at(-1), ctx);
    if (ev) out.push("", ev);
    out.push("");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}
