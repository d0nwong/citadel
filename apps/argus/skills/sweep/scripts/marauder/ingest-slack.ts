#!/usr/bin/env bun
/**
 * marauder ingest --slack — what the channel said becomes events (LIA-157).
 *
 * The accuracy is in the ladder, not in a classifier. A reply in a thread a workstream
 * already owns belongs to that workstream; a message naming a ticket or a PR it owns
 * belongs to it; a message using a field name only one workstream claims probably belongs
 * to it. Everything below that is a reading job, and **this script never calls a model**:
 * an item it cannot place, or can place but cannot type, is written to
 * `workstreams/_unsorted.json` with `needs: "read"`, the item's own words, and one line per
 * open workstream. The sweep skill reads those entries and answers them with
 * `marauder attach --auto` or `marauder suggest`.
 *
 * A decision or an ask that matches nothing is proposed as a new workstream — `kind: "new"`
 * with a name in the item's own words. Nothing here ever creates a workstream file.
 *
 * The cursor is this script's since the rewire (LIA-161). It reads through
 * `slack-pull --json`, which advances `workstreams/.state.next.json`; the sweep promotes
 * that to `workstreams/.state.json` only after the tick's commit succeeds, so a crashed
 * tick replays the channel instead of skipping it. A dry run passes `--no-next` and moves
 * nothing.
 */

import { join } from "node:path";
import { ME, type Msg, type Pull } from "./slack-pull.ts";
import {
  MILESTONES_FILE,
  UNSORTED_FILE,
  USER,
  WORKSTREAMS_DIR,
  instantOf,
  latestEvent,
  loadMilestones,
  loadWorkstreams,
  serializeWorkstream,
  type AttachHow,
  type Confidence,
  type EventKind,
  type Milestones,
  type UnsortedItem,
  type Workstream,
  type WorkstreamEvent,
} from "./record.ts";

const SLACK_PULL = new URL("./slack-pull.ts", import.meta.url).pathname;

// ---------------------------------------------------------------- items

export type SlackItem = {
  /** the Slack `ts`, or `<ts>#<n>` for one item split out of a huddle canvas */
  id: string;
  ts: string;
  at: string;
  author: string;
  authorIsUser: boolean;
  mentionsUser: boolean;
  /** the people an ask names, `you` among them when the reader is one */
  to: string[];
  text: string;
  threadTs?: string;
  permalink: string;
  /** set by the canvas splitter, which knows what each part of the notes is */
  kind?: EventKind;
  /** the canvas file id, when the item is notes nobody has read yet */
  canvas?: string;
  /** which half of a huddle canvas this came out of */
  section?: "summary" | "actions";
  day: string;
};

const CANVAS_FILE = /HUDDLE NOTES canvas (\w+)/;
const RAW_MENTION = /<@(U[A-Z0-9]+)>/g;

/** a canvas carries raw user ids where a message carries names; make them the same thing */
export const resolveMentions = (text: string, users: Record<string, string>, me: string) =>
  text.replace(RAW_MENTION, (_, id: string) => `@${id === me ? USER.name : (users[id] ?? id)}`);
const MENTION = /@([A-Z][\w'’-]*(?: [A-Z][\w'’-]*)?)/g;

const isoOf = (ts: string) => new Date(Number(ts) * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/** the people a message opens by naming, with the reader as `you` */
export function addressees(text: string): string[] {
  const head = text.split(/\n\s*\n/)[0] ?? "";
  const names = [...head.matchAll(MENTION)].map((m) => m[1]!);
  return [...new Set(names.map((n) => (n === USER.name ? USER.token : n)))];
}

const itemOf = (m: Msg, threadTs?: string): SlackItem => ({
  id: m.ts,
  ts: m.ts,
  at: isoOf(m.ts),
  author: m.author,
  authorIsUser: m.isMe,
  mentionsUser: m.mentionsMe,
  to: addressees(m.text),
  text: m.text,
  ...(threadTs && threadTs !== m.ts ? { threadTs } : {}),
  permalink: m.permalink,
  ...(m.files.map((f) => f.match(CANVAS_FILE)?.[1]).find(Boolean) ? { canvas: m.files.map((f) => f.match(CANVAS_FILE)?.[1]).find(Boolean)! } : {}),
  day: m.date,
});

/** every message and new reply in a pull, once each, oldest first */
export function itemsOf(pull: Pull): SlackItem[] {
  const seen = new Set<string>();
  const out: SlackItem[] = [];
  const take = (m: Msg, threadTs?: string) => {
    if (m.bot || seen.has(m.ts)) return;
    seen.add(m.ts);
    const item = itemOf(m, threadTs);
    if (!item.text.trim() && !item.canvas) return;
    out.push(item);
  };
  for (const m of pull.newTopLevel) take(m);
  for (const t of pull.threads) {
    if (t.parentIsNew) take(t.parent);
    for (const r of t.replies) take(r, t.parent.ts);
  }
  return out.sort((a, b) => Number(a.ts) - Number(b.ts));
}

// ---------------------------------------------------------------- the canvas

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const DEADLINE_WORD = /\b(launch|launches|release|demo|deadline|go[- ]live)\b/i;
const ACTION_HEAD = /^(action items?|next steps?|to ?dos?|follow[- ]ups?)\b/i;
const DECISION_HEAD = /^(decisions?|summary|agreed|conclusions?)\b/i;

/**
 * A huddle canvas is a meeting, not a message: each settled point is a change to what the
 * work is, each action item naming a person is an ask, and anything naming a date and an
 * owner is a deadline. The rule is the digest's, inherited when it was retired, with the
 * kind set here so the items leave the splitter already typed.
 */
export function splitCanvas(markdown: string, from: SlackItem, users: Record<string, string> = {}, me = ""): SlackItem[] {
  const lines = resolveMentions(markdown, users, me).split("\n");
  const out: SlackItem[] = [];
  let section: "summary" | "actions" | "other" = "other";
  let n = 0;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("![") || line.startsWith("*This tool uses AI")) continue;
    // "## :star: Summary" — the shortcode is decoration, and the word after it is the section
    const heading = line.replace(/^#+\s*/, "").replace(/:[a-z0-9_+-]+:/gi, "").replace(/[*_]/g, "").trim();
    if (/^#+\s/.test(line)) {
      section = ACTION_HEAD.test(heading) ? "actions" : DECISION_HEAD.test(heading) ? "summary" : "other";
      continue;
    }
    if (section === "other") continue;
    if (!/^[-*•]|^\d+\./.test(line)) continue;
    // a bullet whose next bullet is indented deeper is a group label, not a thing that happened
    const indent = raw.match(/^\s*/)![0].length;
    const next = lines.slice(i + 1).find((l) => l.trim());
    if (next && (next.match(/^\s*/)![0].length ?? 0) > indent) continue;
    const text = line
      .replace(/^[-*•]\s*/, "").replace(/^\d+\.\s*/, "").replace(/^\[[ x]\]\s*/i, "")
      .replace(/\s*\[\d+:\d+\]\s*$/, "")
      .trim();
    if (text.length < 12) continue;
    const to = addressees(text);
    const kind: EventKind | undefined = DEADLINE_WORD.test(text) && (DATE.test(text) || /\b(today|tomorrow)\b/i.test(text))
      ? "deadline"
      : section === "actions"
        ? "new-ask"
        : undefined;
    out.push({
      ...from, id: `${from.ts}#${++n}`, text, to, section, canvas: undefined,
      mentionsUser: to.includes(USER.token), ...(kind ? { kind } : {}),
    });
  }
  return out;
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** the milestone a deadline item states, when it states one plainly enough to record */
export function milestoneOf(item: SlackItem): { slug: string; name: string; date: string; owner: string } | null {
  if (item.kind !== "deadline") return null;
  const date = item.text.match(DATE)?.[1]
    ?? (/\btomorrow\b/i.test(item.text) ? addDays(item.day, 1) : /\btoday\b/i.test(item.text) ? item.day : null);
  const word = item.text.match(DEADLINE_WORD)?.[1]?.toLowerCase();
  if (!date || !word) return null;
  const name = word.replace(/es$/, "").replace(/^go[- ]live$/, "go live");
  const owner = item.to.find((t) => t !== USER.token) ?? (item.authorIsUser ? USER.name : item.author);
  return { slug: `${name.replace(/\s+/g, "-")}-${date}`, name: name[0]!.toUpperCase() + name.slice(1), date, owner };
}

// ---------------------------------------------------------------- the ladder

export type Candidate = { slug: string; how: AttachHow; why: string };

const TICKET = /\b(LIA-\d+)\b/gi;
const PR_REF = /\b((?:fe|be)#\d+)\b/gi;
const bare = (s: string) => s.replace(/[`*_]/g, " ");

const BACKTICKED = /`([^`\n]{2,60})`/g;
const CAMEL = /\b[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;
const KEBAB = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+){1,}\b/g;

/**
 * The identifiers a message uses: a field name, a route segment, a schema name. One
 * tokenizer, so the rung that matches vocabulary and the correction that learns it agree
 * on what a token is.
 */
export function identifiers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BACKTICKED)) {
    const inner = m[1]!.trim();
    if (/^[A-Za-z][\w.-]*$/.test(inner)) out.add(inner);
    else for (const seg of inner.split(/[^A-Za-z0-9_-]+/)) if (/[A-Z-]/.test(seg) && seg.length > 3) out.add(seg);
  }
  for (const re of [CAMEL, PASCAL, KEBAB]) for (const m of text.matchAll(re)) out.add(m[0]);
  return [...out].filter((t) => t.length > 3 && !/^(https?|api|com|www)$/i.test(t));
}

export const tokenIn = (text: string, token: string) =>
  new RegExp(`(^|[^A-Za-z0-9_-])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`, "i").test(text);

/**
 * Who this item belongs to. Thread, then explicit reference, then code vocabulary — each
 * rung stopping the ladder whether it answers once or twice, because a rung that answers
 * twice is an ambiguity to resolve and the next rung is only ever weaker. A token two
 * workstreams both claim is worth nothing, so it is dropped before the rung is judged.
 */
export function slackCandidates(item: SlackItem, workstreams: Workstream[]): Candidate[] {
  // a huddle is not a thread about one thing: every workstream that came out of the
  // meeting names its notes, so an item split out of a canvas skips the thread rung
  const fromCanvas = item.id.includes("#");
  const byThread = fromCanvas ? [] : workstreams.filter((w) => w.keys.threads.includes(item.threadTs ?? item.ts));
  if (byThread.length) return byThread.map((w) => ({ slug: w.slug, how: "thread" as const, why: "it owns the thread this was said in" }));

  const text = bare(item.text);
  const refs = new Set([
    ...[...text.matchAll(TICKET)].map((m) => m[1]!.toUpperCase()),
    ...[...text.matchAll(PR_REF)].map((m) => m[1]!.toLowerCase()),
  ]);
  const byRef = workstreams.filter((w) => [...w.keys.tickets, ...w.keys.prs].some((k) => refs.has(k)));
  if (byRef.length)
    return byRef.map((w) => ({
      slug: w.slug,
      how: "ref" as const,
      why: `it names ${[...w.keys.tickets, ...w.keys.prs].filter((k) => refs.has(k)).join(", ")}`,
    }));

  const shared = new Set<string>();
  const seen = new Set<string>();
  for (const w of workstreams) for (const v of w.keys.vocab) (seen.has(v.toLowerCase()) ? shared : seen).add(v.toLowerCase());
  const byVocab = workstreams
    .map((w) => ({ w, hits: w.keys.vocab.filter((v) => !shared.has(v.toLowerCase()) && tokenIn(text, v)) }))
    .filter((x) => x.hits.length);
  return byVocab.map(({ w, hits }) => ({ slug: w.slug, how: "vocab" as const, why: `it uses ${hits.join(", ")}` }));
}

// ---------------------------------------------------------------- what kind of thing it is

const LANDING_WORD = /\b(merged|landed|is up|on staging|on dev|deployed|pushed)\b/i;
const ROUTE = /\/api\/v\d+\/\S+|\b(GET|POST|PUT|PATCH|DELETE)\b\s*\S*\//;
const QUESTION = /\?\s*$|\?\s/;

/**
 * The kind, from what can be proved and nothing else. A message that names the reader is
 * aimed at them whatever else it also does — the board's Needs you is the whole reason the
 * record exists — and a correction can re-kind it. `null` means it is a reading job.
 */
export function classify(item: SlackItem, workstreams: Workstream[]): EventKind | null {
  if (item.kind) return item.kind;
  if (item.mentionsUser && !item.authorIsUser) return "directed-at-person";
  const text = bare(item.text);
  if (LANDING_WORD.test(text) && (/\b(?:fe|be)#\d+\b/i.test(text) || /\bPR\b/.test(item.text))) return "claimed-landing";
  if (ROUTE.test(text)) return "contract-change";
  const vocab = workstreams.flatMap((w) => w.keys.vocab).filter((v) => tokenIn(text, v));
  if (new Set(vocab.map((v) => v.toLowerCase())).size >= 2) return "contract-change";
  return null;
}

/** an item with nothing in it worth a reader's attention is chat, and chat is not recorded */
export function isChat(item: SlackItem, workstreams: Workstream[]): boolean {
  if (item.kind === "chat") return true;
  if (item.kind) return false;
  const text = bare(item.text);
  const signal =
    ROUTE.test(text) ||
    new RegExp(TICKET.source, "i").test(text) ||
    new RegExp(PR_REF.source, "i").test(text) ||
    DEADLINE_WORD.test(text) ||
    workstreams.some((w) => w.keys.vocab.some((v) => tokenIn(text, v)));
  // a line of a meeting summary with nothing of the product in it is the meeting's small talk
  if (item.section === "summary") return !signal;
  if (item.mentionsUser || QUESTION.test(text) || signal) return false;
  return text.trim().split(/\s+/).length < 12;
}

// ---------------------------------------------------------------- the sentence

const STOP_TAIL = /\s+(and|or|for|to|with|of|the|a|an|in|on|at|by|from|that|which)$/i;
const tidy = (s: string) => {
  let out = s.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  while (STOP_TAIL.test(out)) out = out.replace(STOP_TAIL, "");
  return out;
};
const stripMentions = (text: string) => tidy(text.replace(MENTION, "").replace(/^\s*[\n,:-]+/, ""));
const firstSentence = (text: string) => (stripMentions(text).split(/(?<=[.?!])\s|\n/).find((l) => l.trim().length > 3) ?? "").trim();
const clip = (s: string, words: number) => {
  const parts = tidy(s).split(/\s+/);
  return parts.length <= words ? tidy(s) : `${tidy(parts.slice(0, words).join(" "))}…`;
};

const VERB: Record<EventKind, string> = {
  "answers-question": "answered",
  "contract-change": "said",
  "claimed-landing": "said",
  "verified-landing": "landed",
  "new-ask": "asked for",
  "directed-at-person": "asked",
  deadline: "set a date",
  chat: "said",
};

/**
 * What the item says, framed so a person is doing something. It is a quotation clipped to
 * fit the sentence ceiling, which is as far as a script can honestly go; the sweep's read
 * step rewrites it into the team's own words.
 */
export function slackSummary(item: SlackItem, kind: EventKind): string {
  const who = item.authorIsUser ? "You" : item.author;
  const to = item.to.filter((t) => t !== who);
  const aimed = kind === "directed-at-person" && to.length ? ` ${to.map((t) => (t === USER.token ? "you" : t.split(" ")[0])).join(" and ")}` : "";
  const said = clip(firstSentence(item.text) || item.text.trim(), 14).replace(/[.]+$/, "");
  return `${who} ${VERB[kind]}${aimed}: ${said}.`;
}

/** a workstream nobody has opened, named in the words the item used */
const proposedName = (item: SlackItem) => {
  const s = clip(firstSentence(item.text) || item.text.trim(), 10).replace(/[.…]+$/, "").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Something new";
};

// ---------------------------------------------------------------- applying

export type SlackChange =
  | { kind: "attached"; item: SlackItem; slug: string; how: AttachHow; confidence: Confidence; eventKind: EventKind }
  | { kind: "unsorted"; item: SlackItem; why: string; candidates: Candidate[] }
  | { kind: "proposed"; item: SlackItem; name: string }
  | { kind: "milestone"; item: SlackItem; slug: string; date: string }
  | { kind: "skipped"; item: SlackItem; why: string };

export type ApplyInput = {
  workstreams: Workstream[];
  items: SlackItem[];
  unsorted: UnsortedItem[];
  milestones: Milestones;
};
export type ApplyResult = { workstreams: Workstream[]; unsorted: UnsortedItem[]; milestones: Milestones; changes: SlackChange[] };

const CONFIDENCE: Record<AttachHow, Confidence> = {
  thread: "certain", ref: "certain", vocab: "likely", author: "guess", read: "guess", human: "certain",
};

const alreadyHas = (workstreams: Workstream[], id: string) =>
  workstreams.find((w) => w.events.some((e) => e.source?.ref === id));

/**
 * A canvas is taken in whole or not at all. One event sourced anywhere in it means the
 * meeting has been read, so its other items are not re-derived — which is also what keeps
 * a re-split of the same notes from writing everything twice.
 */
const canvasTakenIn = (workstreams: Workstream[], ts: string) =>
  workstreams.some((w) => w.events.some((e) => e.source?.ref?.split("#")[0] === ts));

/** the whole ingest as one pure function of what was read; the runner only does the IO */
export function applySlack({ workstreams, items, unsorted, milestones }: ApplyInput): ApplyResult {
  const byslug = new Map(workstreams.map((w) => [w.slug, structuredClone(w)]));
  const queue = new Map(unsorted.map((u) => [u.id, u]));
  const stones: Milestones = { ...milestones };
  const changes: SlackChange[] = [];
  const open = () => [...byslug.values()];

  // computed once, against what came in: an item this run writes must not make the notes
  // it came from look already read to the item after it
  const takenIn = new Set(
    [...new Set(items.map((i) => i.id.split("#")[0]!))].filter((ts) => canvasTakenIn(workstreams, ts)),
  );
  const done = new Set<string>();
  for (const item of items) {
    const parent = item.id.split("#")[0]!;
    if (item.id !== parent && takenIn.has(parent)) {
      if (!done.has(parent)) {
        done.add(parent);
        changes.push({ kind: "skipped", item, why: "these huddle notes are already taken in" });
      }
      continue;
    }
    const holder = alreadyHas(open(), item.id);
    if (holder) {
      changes.push({ kind: "skipped", item, why: `already an event on ${holder.slug}` });
      continue;
    }
    if (queue.has(item.id)) {
      changes.push({ kind: "skipped", item, why: "already unsorted" });
      continue;
    }
    if (item.canvas) {
      // the file arrives as a reply to the notes it belongs to, so ask about the notes
      if (canvasTakenIn(workstreams, item.threadTs ?? item.ts)) {
        changes.push({ kind: "skipped", item, why: "these huddle notes are already taken in" });
        continue;
      }
      queue.set(item.id, unsortedItem(item, [], "huddle notes nobody has read — split them with --canvas"));
      changes.push({ kind: "unsorted", item, why: "a huddle canvas, unread", candidates: [] });
      continue;
    }
    if (isChat(item, open())) {
      changes.push({ kind: "skipped", item, why: "chat" });
      continue;
    }

    const candidates = slackCandidates(item, open());
    const kind = classify(item, open());

    // a date the team set belongs to everyone, so it is recorded whether or not the item
    // it came in on can be placed on one workstream
    const stone = milestoneOf(item);
    if (stone && !stones[stone.slug]) {
      stones[stone.slug] = { name: stone.name, date: stone.date, owner: stone.owner };
      changes.push({ kind: "milestone", item, slug: stone.slug, date: stone.date });
    }

    if (!kind || candidates.length !== 1) {
      const why = !kind
        ? candidates.length === 1
          ? `it belongs to ${candidates[0]!.slug}; what kind of thing it is needs reading`
          : "what it is and what it belongs to both need reading"
        : candidates.length
          ? `${candidates.length} workstreams claim it`
          : "nothing claims it";
      const isNews = (kind === "contract-change" || kind === "new-ask") && !candidates.length;
      const entry = unsortedItem(item, candidates, why, isNews ? proposedName(item) : undefined);
      queue.set(entry.id, entry);
      changes.push(isNews ? { kind: "proposed", item, name: entry.name! } : { kind: "unsorted", item, why, candidates });
      continue;
    }

    const only = candidates[0]!;
    const w = byslug.get(only.slug)!;
    const question = w.open_questions.find((q) => q.ticket);
    const event: WorkstreamEvent = {
      at: item.at,
      kind,
      summary: slackSummary(item, kind),
      ...(kind === "directed-at-person" ? { to: item.to.length ? item.to : [USER.token] } : {}),
      source: { type: item.id.includes("#") ? "huddle" : "slack", ref: item.id, url: item.permalink },
      attached: { how: only.how, confidence: CONFIDENCE[only.how] },
      ...(kind === "answers-question" && question?.ticket ? { ticket: question.ticket } : {}),
      ...(stone ? { action: `milestone ${stone.slug}` } : {}),
    };
    w.events = [...w.events, event].sort((a, b) => instantOf(a.at).localeCompare(instantOf(b.at)));
    if (item.threadTs && !w.keys.threads.includes(item.threadTs)) w.keys.threads = [...w.keys.threads, item.threadTs];
    w.updated = instantOf(item.at) > instantOf(w.updated) ? item.at : w.updated;
    changes.push({ kind: "attached", item, slug: w.slug, how: only.how, confidence: CONFIDENCE[only.how], eventKind: kind });
  }

  return {
    workstreams: open(),
    unsorted: [...queue.values()].sort((a, b) => a.at.localeCompare(b.at)),
    milestones: stones,
    changes,
  };
}

const unsortedItem = (item: SlackItem, candidates: Candidate[], why: string, name?: string): UnsortedItem => ({
  id: item.id,
  kind: name ? "new" : "slack",
  ...(name ? { name } : {}),
  summary: `${item.authorIsUser ? "You" : item.author}: ${clip(firstSentence(item.text) || item.text.trim(), 20)}`,
  text: item.text.slice(0, 2000),
  source: { type: item.id.includes("#") ? "huddle" : "slack", ref: item.id, url: item.permalink },
  candidates,
  why,
  suggest: candidates.length === 1 ? candidates[0]!.slug : null,
  needs: "read",
  at: item.at,
});

/** what a reader needs beside the queue to answer it: the open list, one line each */
export const openList = (workstreams: Workstream[]): string =>
  workstreams
    .filter((w) => !w.parked)
    .map((w) => `  ${w.slug}: ${w.name} — done means ${w.done} Last: ${latestEvent(w)?.summary ?? "nothing yet"}`)
    .join("\n");

// ---------------------------------------------------------------- running

export type RunOpts = { root: string; since?: string; canvas?: string; dryRun?: boolean; pull?: Pull; users?: Record<string, string> };
export type RunResult = ApplyResult & { written: string[] };

async function pullChannel(since?: string, dryRun?: boolean): Promise<Pull> {
  // `--since` already suppresses the cursor write; `--no-next` is for the dry run, which
  // reads the channel and must leave the next tick's window exactly where it found it
  const args = [process.execPath, SLACK_PULL, "--json", ...(dryRun ? ["--no-next"] : []), ...(since ? ["--since", since] : [])];
  const p = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`slack-pull: ${p.stderr.toString().trim()}`);
  return JSON.parse(p.stdout.toString()) as Pull;
}

export async function run(opts: RunOpts): Promise<RunResult> {
  const { workstreams } = await loadWorkstreams(opts.root);
  const milestones = await loadMilestones(opts.root);
  const unsortedPath = join(opts.root, WORKSTREAMS_DIR, UNSORTED_FILE);
  const unsorted: UnsortedItem[] = (await Bun.file(unsortedPath).exists()) ? await Bun.file(unsortedPath).json() : [];

  const pull = opts.pull ?? (await pullChannel(opts.since, opts.dryRun));
  let items = itemsOf(pull);
  if (opts.canvas) {
    const markdown = await Bun.file(opts.canvas).text();
    const notes = items.find((i) => i.canvas);
    const users = opts.users ?? (await loadSlackUsers(opts.root));
    if (notes) items = items.flatMap((i) => (i.id === notes.id ? splitCanvas(markdown, i, users, ME) : [i]));
  }

  const result = applySlack({ workstreams, items, unsorted, milestones });
  const written: string[] = [];
  if (!opts.dryRun) {
    const before = new Map(workstreams.map((w) => [w.slug, serializeWorkstream(w)]));
    for (const w of result.workstreams) {
      const text = serializeWorkstream(w);
      if (before.get(w.slug) === text) continue;
      await Bun.write(join(opts.root, WORKSTREAMS_DIR, `${w.slug}.json`), text);
      written.push(`${WORKSTREAMS_DIR}/${w.slug}.json`);
    }
    written.push(...(await writeJson(unsortedPath, result.unsorted, `${WORKSTREAMS_DIR}/${UNSORTED_FILE}`)));
    written.push(...(await writeJson(join(opts.root, WORKSTREAMS_DIR, MILESTONES_FILE), result.milestones, `${WORKSTREAMS_DIR}/${MILESTONES_FILE}`)));
  }
  return { ...result, written };
}

/** the name cache slack-pull already keeps, so a canvas's raw ids become people */
async function loadSlackUsers(root: string): Promise<Record<string, string>> {
  const f = Bun.file(join(root, ".state/slack-users.json"));
  if (!(await f.exists())) return {};
  return ((await f.json()) as { users: Record<string, string> }).users ?? {};
}

async function writeJson(path: string, value: unknown, label: string): Promise<string[]> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const had = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  if (had === text || (!had && text.trim() === "[]")) return [];
  await Bun.write(path, text);
  return [label];
}

export function formatChanges(changes: SlackChange[]): string {
  return changes
    .map((c) =>
      c.kind === "attached"
        ? `  ${c.item.id.padEnd(22)} → ${c.slug} · ${c.eventKind} · ${c.how}/${c.confidence}`
        : c.kind === "milestone"
          ? `  ${c.item.id.padEnd(22)} → milestone ${c.slug} (${c.date})`
          : c.kind === "proposed"
            ? `  ${c.item.id.padEnd(22)} → proposed workstream "${c.name}"`
            : c.kind === "unsorted"
              ? `  ${c.item.id.padEnd(22)} → unsorted · ${c.why}`
              : `  ${c.item.id.padEnd(22)} — ${c.why}`,
    )
    .join("\n");
}
