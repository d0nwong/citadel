#!/usr/bin/env bun
/**
 * slack-pull — fetch what's new in #dev-team since the last digest run and print it as a
 * compact, agent-readable transcript.
 *
 * This is the deterministic half of `slack-digest`: cursor bookkeeping, pagination, thread
 * following, user-id resolution, noise filtering and permalinks. The agent only triages
 * what this prints. Nothing here writes to Slack.
 *
 *   slack-pull                    everything since digests/.state.json's last_ts
 *   slack-pull --since 2026-08-28 override the cursor (date or unix ts); state untouched
 *   slack-pull --json             structured output instead of the transcript
 *   slack-pull --no-next          don't write digests/.state.next.json
 *
 * State protocol: this never touches `.state.json`. It writes the advanced cursor to
 * `.state.next.json`; the agent promotes it (`mv`) only after the digest commit succeeds,
 * so a crashed run replays instead of skipping.
 *
 * Auth: SLACK_TOKEN in the environment (Bun loads .env). Needs channels:history +
 * users:read (a user token also needs channels:read).
 */

import { join } from "node:path";

export const CHANNEL = "C07KG06L601";
export const WORKSPACE = "https://alden-studios.slack.com";
export const ME = "U09R2MYP6A0";
const WATCH_EXPIRY_S = 48 * 3600;

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const STATE = join(ROOT, "digests/.state.json");
const STATE_NEXT = join(ROOT, "digests/.state.next.json");
const USER_CACHE = join(ROOT, ".state/slack-users.json");

/** subtypes that are never content — dropped and counted */
const NOISE_SUBTYPES = new Set([
  "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
  "channel_archive", "channel_unarchive", "pinned_item", "unpinned_item", "reminder_add",
  "group_join", "group_leave", "tombstone",
]);

export type State = {
  last_ts: string;
  watched_threads: Record<string, string>;
  action_items: Record<string, string>;
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  reply_count?: number;
  latest_reply?: string;
  reactions?: { name: string; count: number }[];
  files?: { name?: string; title?: string; permalink?: string; filetype?: string }[];
  attachments?: { title?: string; text?: string; fallback?: string; title_link?: string }[];
};

export type Users = Record<string, string>;

export type Msg = {
  ts: string;
  date: string;      // YYYY-MM-DD local
  time: string;      // HH:MM local
  author: string;
  isMe: boolean;
  mentionsMe: boolean;
  bot: boolean;
  text: string;
  reactions: string; // "✅×2 👍" or ""
  files: string[];
  permalink: string;
};

export type Thread = {
  parent: Msg;
  parentIsNew: boolean;
  replies: Msg[];          // only replies newer than the cursor / last_seen
  totalReplies: number;
};

export type Pull = {
  since: string;
  now: string;
  newTopLevel: Msg[];      // top-level messages, chronological (threads' parents included)
  threads: Thread[];       // every thread with new replies, incl. watched ones
  noiseDropped: number;
  expiredThreads: string[];
  next: State;
};

// ---------------------------------------------------------------- pure helpers

export const tsNum = (ts: string) => Number(ts);
export const tsGt = (a: string, b: string) => tsNum(a) > tsNum(b);
export const maxTs = (...ts: (string | undefined)[]) =>
  ts.filter((t): t is string => !!t).reduce((m, t) => (tsGt(t, m) ? t : m), "0");

export function permalink(ts: string, threadTs?: string): string {
  const p = `${WORKSPACE}/archives/${CHANNEL}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${p}?thread_ts=${threadTs}&cid=${CHANNEL}` : p;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function localDateTime(ts: string): { date: string; time: string } {
  const d = new Date(tsNum(ts) * 1000);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Slack mrkdwn → plain text an agent can read without a decoder ring */
export function normaliseText(raw: string | undefined, users: Users): string {
  if (!raw) return "";
  return raw
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${users[id] ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
    .replace(/<!subteam\^[A-Z0-9]+\|@?([^>]+)>/g, "@$1")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\r?\n/g, "\n")
    .trim();
}

export function displayName(m: SlackMessage, users: Users): string {
  if (m.user === ME) return "you";
  if (m.user) return users[m.user] ?? m.user;
  return m.username ?? (m.bot_id ? `bot:${m.bot_id}` : "unknown");
}

export const isNoise = (m: SlackMessage) => !!m.subtype && NOISE_SUBTYPES.has(m.subtype);

export function toMsg(m: SlackMessage, users: Users): Msg {
  const { date, time } = localDateTime(m.ts);
  const files = [
    ...(m.files ?? []).map((f) => `${f.title ?? f.name ?? "file"}${f.filetype ? ` (${f.filetype})` : ""}${f.permalink ? ` ${f.permalink}` : ""}`),
    ...(m.attachments ?? [])
      .map((a) => [a.title, a.text ?? a.fallback].filter(Boolean).join(" — "))
      .filter(Boolean)
      .map((s) => `attachment: ${normaliseText(s, users).slice(0, 300)}`),
  ];
  return {
    ts: m.ts,
    date, time,
    author: displayName(m, users),
    isMe: m.user === ME,
    mentionsMe: (m.text ?? "").includes(`<@${ME}>`),
    bot: !!m.bot_id && !m.user,
    text: normaliseText(m.text, users),
    reactions: (m.reactions ?? []).map((r) => `:${r.name}:${r.count > 1 ? `×${r.count}` : ""}`).join(" "),
    files,
    permalink: permalink(m.ts, m.thread_ts),
  };
}

/**
 * Turn raw fetch results into the pull. Pure, so it's testable: `history` is every
 * top-level message with ts > since; `replies` maps thread_ts → full reply list
 * (parent excluded) for every thread we looked at; `parents` maps thread_ts → parent
 * message for watched threads whose parent predates the window.
 */
export function assemble(
  state: State,
  since: string,
  history: SlackMessage[],
  replies: Record<string, SlackMessage[]>,
  parents: Record<string, SlackMessage>,
  users: Users,
  nowS: number,
): Pull {
  let noise = 0;
  const fresh = history
    .filter((m) => tsGt(m.ts, since))
    .filter((m) => (isNoise(m) ? (noise++, false) : true))
    .sort((a, b) => tsNum(a.ts) - tsNum(b.ts));

  const watched: Record<string, string> = {};
  const threads: Thread[] = [];
  let newest = since;

  const consider = (threadTs: string, parent: SlackMessage, parentIsNew: boolean, lastSeen: string) => {
    const all = (replies[threadTs] ?? []).filter((r) => r.ts !== threadTs);
    const fresh = all.filter((r) => tsGt(r.ts, lastSeen)).filter((r) => (isNoise(r) ? (noise++, false) : true));
    const latest = maxTs(parent.latest_reply, ...all.map((r) => r.ts), threadTs);
    newest = maxTs(newest, ...fresh.map((r) => r.ts));
    if (fresh.length || parentIsNew) {
      threads.push({
        parent: toMsg(parent, users),
        parentIsNew,
        replies: fresh.sort((a, b) => tsNum(a.ts) - tsNum(b.ts)).map((r) => toMsg(r, users)),
        totalReplies: Math.max(parent.reply_count ?? 0, all.length),
      });
    }
    // keep watching while the thread is alive
    if (nowS - tsNum(latest) < WATCH_EXPIRY_S) watched[threadTs] = maxTs(lastSeen, ...fresh.map((r) => r.ts));
  };

  for (const m of fresh) {
    newest = maxTs(newest, m.ts);
    if ((m.reply_count ?? 0) > 0 || replies[m.ts]) consider(m.ts, m, true, since);
    else if (nowS - tsNum(m.ts) < WATCH_EXPIRY_S && !m.thread_ts) watched[m.ts] = m.ts; // may grow a thread later
  }

  const expired: string[] = [];
  for (const [threadTs, lastSeen] of Object.entries(state.watched_threads)) {
    if (watched[threadTs] !== undefined) continue;            // already handled as new above
    const parent = parents[threadTs] ?? history.find((m) => m.ts === threadTs);
    if (!parent) { expired.push(threadTs); continue; }        // deleted or unreachable
    consider(threadTs, parent, false, lastSeen);
    if (watched[threadTs] === undefined) expired.push(threadTs);
  }

  return {
    since,
    now: new Date(nowS * 1000).toISOString(),
    newTopLevel: fresh.map((m) => toMsg(m, users)),
    threads: threads.sort((a, b) => tsNum(a.parent.ts) - tsNum(b.parent.ts)),
    noiseDropped: noise,
    expiredThreads: expired,
    next: { last_ts: newest, watched_threads: watched, action_items: state.action_items },
  };
}

// ---------------------------------------------------------------- rendering

function line(m: Msg, indent = ""): string {
  const flags = [m.mentionsMe ? "→you" : "", m.bot ? "[bot]" : ""].filter(Boolean).join(" ");
  const head = `${indent}${m.date} ${m.time}  ${m.author}${flags ? `  ${flags}` : ""}:`;
  const body = m.text.split("\n").map((l, i) => (i === 0 ? ` ${l}` : `${indent}    ${l}`)).join("\n");
  const tail = [m.reactions && `[${m.reactions}]`, ...m.files.map((f) => `[file: ${f}]`)].filter(Boolean);
  return `${head}${body}${tail.length ? `\n${indent}    ${tail.join("  ")}` : ""}\n${indent}    ${m.permalink}`;
}

export function render(p: Pull): string {
  const s = localDateTime(p.since);
  const out: string[] = [];
  const threadOf = new Map(p.threads.map((t) => [t.parent.ts, t]));
  out.push(`# slack-pull — #dev-team — ${p.now}`);
  out.push(
    `since ${p.since} (${s.date} ${s.time})  ·  ${p.newTopLevel.length} new top-level  ·  ` +
    `${p.threads.reduce((n, t) => n + t.replies.length, 0)} new replies in ${p.threads.length} threads  ·  ` +
    `${p.noiseDropped} noise dropped  ·  ${p.expiredThreads.length} watched threads expired`,
  );
  out.push(`next last_ts ${p.next.last_ts}  ·  watching ${Object.keys(p.next.watched_threads).length} threads`);
  out.push("", "author 'you' = the user. →you = mentions the user. Reply permalinks carry thread_ts.");

  if (p.newTopLevel.length) {
    out.push("", "## New messages (chronological; threads inline)");
    for (const m of p.newTopLevel) {
      const t = threadOf.get(m.ts);
      out.push("", line(m) + (t ? `\n    ${t.totalReplies} replies:` : ""));
      for (const r of t?.replies ?? []) out.push(line(r, "    ↳ "));
    }
  }
  const older = p.threads.filter((t) => !t.parentIsNew);
  if (older.length) {
    out.push("", "## New replies in older threads (parent shown for context, then only the new replies)");
    for (const t of older) {
      out.push("", `parent (${t.totalReplies} replies total):`, line(t.parent, "  "));
      for (const r of t.replies) out.push(line(r, "    ↳ "));
    }
  }
  if (!p.newTopLevel.length && !p.threads.length) out.push("", "nothing new.");
  return out.join("\n");
}

// ---------------------------------------------------------------- slack api

async function slack<T>(method: string, params: Record<string, string | number | undefined>): Promise<T> {
  const token = process.env.SLACK_TOKEN;
  if (!token) throw new Error("SLACK_TOKEN is not set (put it in .env — it is gitignored)");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("retry-after") ?? "5");
      await Bun.sleep(wait * 1000);
      continue;
    }
    const body = (await res.json()) as { ok: boolean; error?: string; response_metadata?: { next_cursor?: string } } & T;
    if (!body.ok) throw new Error(`${method}: ${body.error}`);
    return body;
  }
}

async function paginate<T>(method: string, params: Record<string, string | number | undefined>, pick: (b: any) => T[]): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const b = await slack<any>(method, { ...params, cursor, limit: 200 });
    out.push(...pick(b));
    cursor = b.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function loadUsers(): Promise<Users> {
  const f = Bun.file(USER_CACHE);
  if (await f.exists()) {
    const c = (await f.json()) as { at: number; users: Users };
    if (Date.now() - c.at < 24 * 3600 * 1000) return c.users;
  }
  const members = await paginate<any>("users.list", {}, (b) => b.members ?? []);
  const users: Users = {};
  for (const u of members) users[u.id] = u.real_name || u.profile?.real_name || u.profile?.display_name || u.name;
  await Bun.write(USER_CACHE, JSON.stringify({ at: Date.now(), users }));
  return users;
}

async function loadState(): Promise<State> {
  const f = Bun.file(STATE);
  if (await f.exists()) return (await f.json()) as State;
  return { last_ts: String(Math.floor(Date.now() / 1000) - 24 * 3600), watched_threads: {}, action_items: {} };
}

/** "2026-08-28" → ts at local midnight; anything else is taken as a unix ts */
function parseSince(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Math.floor(new Date(`${s}T00:00:00`).getTime() / 1000)}.000000`;
  return s.includes(".") ? s : `${s}.000000`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log("slack-pull [--since <date|ts>] [--json] [--no-next]  — see header comment");
    return;
  }
  const sinceArg = argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : undefined;
  const json = argv.includes("--json");
  const writeNext = !argv.includes("--no-next") && !sinceArg;

  const state = await loadState();
  const since = sinceArg ? parseSince(sinceArg) : state.last_ts;
  const nowS = Math.floor(Date.now() / 1000);
  const users = await loadUsers();

  const history = await paginate<SlackMessage>("conversations.history", { channel: CHANNEL, oldest: since }, (b) => b.messages ?? []);

  const replies: Record<string, SlackMessage[]> = {};
  const parents: Record<string, SlackMessage> = {};
  const want = new Set<string>([
    ...history.filter((m) => (m.reply_count ?? 0) > 0).map((m) => m.ts),
    ...Object.keys(state.watched_threads),
  ]);
  for (const threadTs of want) {
    try {
      const all = await paginate<SlackMessage>("conversations.replies", { channel: CHANNEL, ts: threadTs }, (b) => b.messages ?? []);
      const parent = all.find((m) => m.ts === threadTs);
      if (parent) parents[threadTs] = parent;
      replies[threadTs] = all.filter((m) => m.ts !== threadTs);
    } catch (e) {
      if (!String(e).includes("thread_not_found")) throw e;   // deleted parent → expires in assemble
    }
  }

  const pull = assemble(state, since, history, replies, parents, users, nowS);
  if (writeNext) await Bun.write(STATE_NEXT, JSON.stringify(pull.next, null, 2) + "\n");
  console.log(json ? JSON.stringify(pull, null, 2) : render(pull));
}

if (import.meta.main) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
