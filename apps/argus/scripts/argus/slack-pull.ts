#!/usr/bin/env bun
/**
 * slack-pull — what is new in every configured channel since its cursor, as data.
 *
 * The deterministic half of `argus pull`: the cursors, pagination, thread following, user
 * names, noise filtering, permalinks, and the text of a huddle canvas when Slackbot posts
 * one. Nothing here writes to Slack, and nothing here writes a cursor: `pullChannels`
 * answers the pull and each channel's next cursor, and `pull.ts` decides when they move.
 *
 * Each channel in `projects.json` has its own cursor in `state/cursor.json` (CTD-274,
 * ingest S-8). A channel that fails to read keeps its cursor and the others still advance;
 * a channel with no cursor yet is read from seven days back (S-13); and a cursor file from
 * before channels, one bare cursor, becomes `LEGACY_CHANNEL`'s (S-14).
 *
 *   slack-pull                    everything since each channel's cursor, as JSON
 *   slack-pull --since 2026-08-28 override the cursor (date or unix ts)
 *
 * Auth: SLACK_TOKEN from the environment; Bun loads the checkout's .env. Needs
 * channels:history, users:read and files:read (a user token also needs channels:read).
 */

import { join } from "node:path";
import { cursorPath, stateDir } from "./paths.ts";

/** the one channel read before channels were configured; a bare cursor file is its cursor */
export const LEGACY_CHANNEL = "C07KG06L601";
const NEW_CHANNEL_DAYS = 7;
export const WORKSPACE = "https://alden-studios.slack.com";
export const ME = "U09R2MYP6A0";
const WATCH_EXPIRY_S = 48 * 3600;

const USER_CACHE = () => join(stateDir(), "slack-users.json");

/** subtypes that are never content — dropped and counted */
const NOISE_SUBTYPES = new Set([
  "channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name",
  "channel_archive", "channel_unarchive", "pinned_item", "unpinned_item", "reminder_add",
  "group_join", "group_leave", "tombstone",
]);

export type Cursor = { last_ts: string; watched_threads: Record<string, string> };
/** `state/cursor.json`: one cursor per channel id */
export type Cursors = { channels: Record<string, Cursor> };

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
  reactions?: { name: string; count: number; users?: string[] }[];
  files?: { id?: string; name?: string; title?: string; permalink?: string; filetype?: string; url_private?: string }[];
  attachments?: { title?: string; text?: string; fallback?: string; title_link?: string }[];
};

/** Slackbot's "AI huddle notes are ready" post carries the meeting as a canvas file */
export const isHuddleNotes = (m: SlackMessage) =>
  m.user === "USLACKBOT" && (m.files ?? []).some((f) => /huddle notes/i.test(f.title ?? f.name ?? ""));

export type Users = Record<string, string>;

export type Msg = {
  ts: string;
  /** the Slack channel the message was posted in */
  channel: string;
  /** the thread root when this is a reply, else the message's own ts */
  thread: string;
  date: string;
  time: string;
  author: string;
  isMe: boolean;
  mentionsMe: boolean;
  bot: boolean;
  text: string;
  reactions: string;
  files: string[];
  /** a huddle canvas's text, fetched; null when the message carries none */
  canvas: string | null;
  permalink: string;
};

export type Thread = { parent: Msg; parentIsNew: boolean; replies: Msg[]; totalReplies: number };

export type Pull = {
  since: string;
  now: string;
  newTopLevel: Msg[];
  threads: Thread[];
  noiseDropped: number;
  expiredThreads: string[];
  next: Cursor;
  /** each channel's next cursor, when the pull read channels; stripped before the batch is written */
  cursors?: Record<string, Cursor>;
};

// ---------------------------------------------------------------- pure helpers

export const tsNum = (ts: string) => Number(ts);
export const tsGt = (a: string, b: string) => tsNum(a) > tsNum(b);
export const maxTs = (...ts: (string | undefined)[]) =>
  ts.filter((t): t is string => !!t).reduce((m, t) => (tsGt(t, m) ? t : m), "0");

export function permalink(ts: string, threadTs?: string, channel = LEGACY_CHANNEL): string {
  const p = `${WORKSPACE}/archives/${channel}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${p}?thread_ts=${threadTs}&cid=${channel}` : p;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function localDateTime(ts: string): { date: string; time: string } {
  const d = new Date(tsNum(ts) * 1000);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Slack mrkdwn → plain text */
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

/** a canvas export is HTML; keep the headings and the text, drop the rest; mentions become names */
export function canvasToText(html: string, users: Users = {}): string {
  const name = (id: string) => `@${id === ME ? "you" : (users[id] ?? id)}`;
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => name(id))
    .replace(/<\/(h[1-6]|p|li|div|tr|section)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n## ")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/@([UW][A-Z0-9]{8,})\b/g, (_, id) => name(id))
    .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

export function toMsg(m: SlackMessage, users: Users, canvas: string | null = null, channel = LEGACY_CHANNEL): Msg {
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
    channel,
    thread: m.thread_ts ?? m.ts,
    date, time,
    author: displayName(m, users),
    isMe: m.user === ME,
    mentionsMe: (m.text ?? "").includes(`<@${ME}>`),
    bot: !!m.bot_id && !m.user,
    text: normaliseText(m.text, users),
    reactions: (m.reactions ?? [])
      .map((r) => {
        const who = (r.users ?? []).map((u) => (u === ME ? "you" : (users[u] ?? u))).join(", ");
        return `:${r.name}:${r.count > 1 ? `×${r.count}` : ""}${who ? ` (${who})` : ""}`;
      })
      .join(" "),
    files,
    canvas,
    permalink: permalink(m.ts, m.thread_ts, channel),
  };
}

/**
 * Raw fetch results → the pull. Pure. `history` is every top-level message with ts >
 * since; `replies` maps thread_ts → replies (parent excluded) for every thread looked at;
 * `parents` maps thread_ts → parent for watched threads whose parent predates the window;
 * `canvases` maps a message ts → its huddle canvas text.
 */
export function assemble(
  cursor: Cursor,
  since: string,
  history: SlackMessage[],
  replies: Record<string, SlackMessage[]>,
  parents: Record<string, SlackMessage>,
  users: Users,
  nowS: number,
  canvases: Record<string, string> = {},
  channel = LEGACY_CHANNEL,
): Pull {
  let noise = 0;
  const msg = (m: SlackMessage) => toMsg(m, users, canvases[m.ts] ?? null, channel);
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
    if (fresh.length || parentIsNew)
      threads.push({ parent: msg(parent), parentIsNew, replies: fresh.sort((a, b) => tsNum(a.ts) - tsNum(b.ts)).map(msg), totalReplies: Math.max(parent.reply_count ?? 0, all.length) });
    if (nowS - tsNum(latest) < WATCH_EXPIRY_S) watched[threadTs] = maxTs(lastSeen, ...fresh.map((r) => r.ts));
  };

  for (const m of fresh) {
    newest = maxTs(newest, m.ts);
    if ((m.reply_count ?? 0) > 0 || replies[m.ts]) consider(m.ts, m, true, since);
    else if (nowS - tsNum(m.ts) < WATCH_EXPIRY_S && !m.thread_ts) watched[m.ts] = m.ts;
  }

  const expired: string[] = [];
  for (const [threadTs, lastSeen] of Object.entries(cursor.watched_threads)) {
    if (watched[threadTs] !== undefined) continue;
    const parent = parents[threadTs] ?? history.find((m) => m.ts === threadTs);
    if (!parent) { expired.push(threadTs); continue; }
    consider(threadTs, parent, false, lastSeen);
    if (watched[threadTs] === undefined) expired.push(threadTs);
  }

  return {
    since,
    now: new Date(nowS * 1000).toISOString(),
    newTopLevel: fresh.map(msg),
    threads: threads.sort((a, b) => tsNum(a.parent.ts) - tsNum(b.parent.ts)),
    noiseDropped: noise,
    expiredThreads: expired,
    next: { last_ts: newest, watched_threads: watched },
  };
}

/** every message in a pull, flat, chronological, replies carrying their thread */
export function flatten(p: Pull): Msg[] {
  const seen = new Set<string>();
  const out: Msg[] = [];
  const add = (m: Msg) => { if (!seen.has(m.ts)) { seen.add(m.ts); out.push(m); } };
  for (const m of p.newTopLevel) add(m);
  for (const t of p.threads) { if (t.parentIsNew) add(t.parent); for (const r of t.replies) add(r); }
  return out.sort((a, b) => tsNum(a.ts) - tsNum(b.ts));
}

// ---------------------------------------------------------------- slack api

export type SlackApi = {
  call<T>(method: string, params: Record<string, string | number | undefined>): Promise<T>;
  download(url: string): Promise<string>;
};

export function slackApi(token = process.env.SLACK_TOKEN): SlackApi {
  if (!token) throw new Error("SLACK_TOKEN is not set — put it in the argus checkout's .env (just auth slack prompts for it)");
  return {
    async call<T>(method: string, params: Record<string, string | number | undefined>): Promise<T> {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`https://slack.com/api/${method}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 429 && attempt < 5) {
          await Bun.sleep(Number(res.headers.get("retry-after") ?? "5") * 1000);
          continue;
        }
        const body = (await res.json()) as { ok: boolean; error?: string } & T;
        if (!body.ok) throw new Error(`${method}: ${body.error}`);
        return body;
      }
    },
    async download(url: string): Promise<string> {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
      return res.text();
    },
  };
}

async function paginate<T>(api: SlackApi, method: string, params: Record<string, string | number | undefined>, pick: (b: any) => T[]): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const b = await api.call<any>(method, { ...params, cursor, limit: 200 });
    out.push(...pick(b));
    cursor = b.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function loadUsers(api: SlackApi): Promise<Users> {
  const f = Bun.file(USER_CACHE());
  if (await f.exists()) {
    const c = (await f.json()) as { at: number; users: Users };
    if (Date.now() - c.at < 24 * 3600 * 1000) return c.users;
  }
  const members = await paginate<any>(api, "users.list", {}, (b) => b.members ?? []);
  const users: Users = {};
  for (const u of members) users[u.id] = u.real_name || u.profile?.real_name || u.profile?.display_name || u.name;
  await Bun.write(USER_CACHE(), JSON.stringify({ at: Date.now(), users }));
  return users;
}

/** a huddle canvas's text, or null when it cannot be fetched (the marker stays on the message) */
export async function fetchCanvas(api: SlackApi, m: SlackMessage, users: Users = {}): Promise<string | null> {
  const file = (m.files ?? []).find((f) => /huddle notes/i.test(f.title ?? f.name ?? ""));
  if (!file?.id) return null;
  try {
    const info = await api.call<{ file?: { url_private?: string; url_private_download?: string } }>("files.info", { file: file.id });
    const url = info.file?.url_private_download ?? info.file?.url_private ?? file.url_private;
    if (!url) return null;
    const text = canvasToText(await api.download(url), users);
    return text || null;
  } catch {
    return null;
  }
}

/** a channel's first cursor: seven days back (ingest S-13) */
export const newCursor = (now = Date.now()): Cursor => ({ last_ts: String(Math.floor(now / 1000) - NEW_CHANNEL_DAYS * 86400), watched_threads: {} });

/** a cursor file of either shape as per-channel cursors: a bare one is `LEGACY_CHANNEL`'s (ingest S-14) */
export function asCursors(raw: unknown): Cursors {
  if (raw && typeof raw === "object" && "channels" in raw) return raw as Cursors;
  if (raw && typeof raw === "object" && "last_ts" in raw) return { channels: { [LEGACY_CHANNEL]: raw as Cursor } };
  return { channels: {} };
}

/** every configured channel's cursor; one with none yet starts seven days back */
export async function readCursors(channels: string[], now = Date.now()): Promise<Record<string, Cursor>> {
  const f = Bun.file(cursorPath());
  const stored = asCursors((await f.exists()) ? await f.json() : null).channels;
  return Object.fromEntries(channels.map((c) => [c, stored[c] ?? newCursor(now)]));
}

/** `LEGACY_CHANNEL`'s cursor, for callers that read one */
export async function readCursor(now = Date.now()): Promise<Cursor> {
  return (await readCursors([LEGACY_CHANNEL], now))[LEGACY_CHANNEL]!;
}

/** "2026-08-28" → ts at local midnight; anything else is taken as a unix ts */
export function parseSince(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Math.floor(new Date(`${s}T00:00:00`).getTime() / 1000)}.000000`;
  return s.includes(".") ? s : `${s}.000000`;
}

/** one channel's pull, with nothing written; `since` overrides its cursor */
export async function pullSlack(opts: { since?: string; api?: SlackApi; now?: number; channel?: string; cursor?: Cursor; users?: Users } = {}): Promise<Pull> {
  const api = opts.api ?? slackApi();
  const channel = opts.channel ?? LEGACY_CHANNEL;
  const cursor = opts.cursor ?? (await readCursors([channel]))[channel]!;
  const since = opts.since ? parseSince(opts.since) : cursor.last_ts;
  const nowS = opts.now ?? Math.floor(Date.now() / 1000);
  const users = opts.users ?? (await loadUsers(api));

  const history = await paginate<SlackMessage>(api, "conversations.history", { channel, oldest: since }, (b) => b.messages ?? []);
  const replies: Record<string, SlackMessage[]> = {};
  const parents: Record<string, SlackMessage> = {};
  const want = new Set<string>([...history.filter((m) => (m.reply_count ?? 0) > 0).map((m) => m.ts), ...Object.keys(cursor.watched_threads)]);
  for (const threadTs of want) {
    try {
      const all = await paginate<SlackMessage>(api, "conversations.replies", { channel, ts: threadTs }, (b) => b.messages ?? []);
      const parent = all.find((m) => m.ts === threadTs);
      if (parent) parents[threadTs] = parent;
      replies[threadTs] = all.filter((m) => m.ts !== threadTs);
    } catch (e) {
      if (!String(e).includes("thread_not_found")) throw e;
    }
  }
  const canvases: Record<string, string> = {};
  for (const m of [...history, ...Object.values(replies).flat()])
    if (isHuddleNotes(m)) {
      const text = await fetchCanvas(api, m, users);
      if (text) canvases[m.ts] = text;
    }
  return assemble(cursor, since, history, replies, parents, users, nowS, canvases, channel);
}

/**
 * Several channels' pulls as one. One pull is returned as it is, so a single channel's
 * batch reads exactly as before channels; several are concatenated in time order, with
 * the earliest `since` and the newest `last_ts`.
 */
export function mergePulls(pulls: Pull[]): Pull {
  if (pulls.length === 1) return pulls[0]!;
  const since = pulls.map((p) => p.since).reduce((m, t) => (tsGt(m, t) ? t : m));
  return {
    since,
    now: pulls.map((p) => p.now).sort().at(-1)!,
    newTopLevel: pulls.flatMap((p) => p.newTopLevel).sort((a, b) => tsNum(a.ts) - tsNum(b.ts)),
    threads: pulls.flatMap((p) => p.threads).sort((a, b) => tsNum(a.parent.ts) - tsNum(b.parent.ts)),
    noiseDropped: pulls.reduce((n, p) => n + p.noiseDropped, 0),
    expiredThreads: pulls.flatMap((p) => p.expiredThreads),
    next: { last_ts: maxTs(...pulls.map((p) => p.next.last_ts)), watched_threads: Object.assign({}, ...pulls.map((p) => p.next.watched_threads)) },
  };
}

/**
 * Every channel's pull as one, with each channel's next cursor under `cursors` (ingest S-8).
 * A channel that fails keeps its cursor, is named on stderr, and the others still count;
 * only when every channel fails does the pull fail, as the one channel's did before.
 */
export async function pullChannels(channels: string[], opts: { since?: string; api?: SlackApi; now?: number } = {}): Promise<Pull> {
  const api = opts.api ?? slackApi();
  const cursors = await readCursors(channels, opts.now ? opts.now * 1000 : Date.now());
  const users = await loadUsers(api);
  const pulls: Pull[] = [];
  const next: Record<string, Cursor> = {};
  let lastError: unknown = null;
  for (const channel of channels) {
    try {
      const p = await pullSlack({ ...opts, api, channel, cursor: cursors[channel], users });
      pulls.push(p);
      next[channel] = p.next;
    } catch (e) {
      lastError = e;
      console.error(`slack: ${channel} unreadable this run, its cursor stays: ${(e as Error).message ?? e}`);
      next[channel] = cursors[channel]!;
    }
  }
  if (!pulls.length) throw lastError ?? new Error("no channels configured");
  return { ...mergePulls(pulls), cursors: next };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log("slack-pull [--since <date|ts>] — the pull as JSON; writes nothing");
    process.exit(0);
  }
  const since = argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : undefined;
  import("./projects.ts")
    .then(({ loadProjects }) => loadProjects())
    .then((cfg) => pullChannels(cfg.channels.map((c) => c.id), { since }))
    .then((p) => console.log(JSON.stringify(p, null, 2))).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
