/**
 * The pure half of slack-pull: text normalisation, the pull assembled from raw results
 * (cursor advance, thread following, noise, expiry), a huddle canvas's text on its
 * message, and `flatten`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, canvasToText, type Cursor, flatten, LEGACY_CHANNEL, normaliseText, parseSince, permalink, pullChannels, pullSlack, readCursors, type SlackApi, type SlackMessage, toMsg } from "./slack-pull.ts";

const users = { U1: "Sam O", U2: "Foong Leung", U09R2MYP6A0: "Liam Leung" };
const NOW = 1_789_100_000;
const cursor: Cursor = { last_ts: "1789000000.000000", watched_threads: {} };

describe("normaliseText", () => {
  test("mentions, channels, links and entities", () => {
    expect(normaliseText("<@U1> see <#C1|dev-team> and <https://x.y|the doc> &amp; <https://z.z>", users)).toBe(
      "@Sam O see #dev-team and the doc (https://x.y) & https://z.z",
    );
  });
});

describe("toMsg", () => {
  test("the reader is you, a reply carries its thread, a canvas rides on the message", () => {
    const m = toMsg({ ts: "1789000001.000000", thread_ts: "1789000000.500000", user: "U09R2MYP6A0", text: "hi <@U1>" }, users, "## Summary\n- one");
    expect(m.author).toBe("you");
    expect(m.isMe).toBe(true);
    expect(m.thread).toBe("1789000000.500000");
    expect(m.canvas).toBe("## Summary\n- one");
    expect(m.permalink).toBe(permalink("1789000001.000000", "1789000000.500000"));
    expect(toMsg({ ts: "1789000002.000000", user: "U1", text: "x" }, users).thread).toBe("1789000002.000000");
  });
});

describe("assemble", () => {
  const history: SlackMessage[] = [
    { ts: "1789000010.000000", user: "U1", text: "root with replies", reply_count: 2, latest_reply: "1789000030.000000" },
    { ts: "1789000020.000000", user: "U2", text: "lone message" },
    { ts: "1789000025.000000", subtype: "channel_join", user: "U2", text: "joined" },
    { ts: "1789000040.000000", user: "USLACKBOT", text: "AI huddle notes are ready", files: [{ id: "F1", title: "Huddle notes 2026-09-10" }] },
  ];
  const replies = {
    "1789000010.000000": [
      { ts: "1789000015.000000", thread_ts: "1789000010.000000", user: "U2", text: "reply one" },
      { ts: "1789000030.000000", thread_ts: "1789000010.000000", user: "U1", text: "reply two" },
    ],
  };

  test("new messages, threads, noise, the cursor and the watch list", () => {
    const p = assemble(cursor, cursor.last_ts, history, replies, {}, users, NOW, { "1789000040.000000": "## Summary\n- decided x" });
    expect(p.newTopLevel.map((m) => m.text)).toEqual(["root with replies", "lone message", "AI huddle notes are ready"]);
    expect(p.noiseDropped).toBe(1);
    expect(p.threads).toHaveLength(1);
    expect(p.threads[0]?.replies.map((r) => r.text)).toEqual(["reply one", "reply two"]);
    expect(p.next.last_ts).toBe("1789000040.000000");
    expect(Object.keys(p.next.watched_threads).sort()).toEqual(["1789000010.000000", "1789000020.000000", "1789000040.000000"]);
    expect(p.newTopLevel[2]?.canvas).toBe("## Summary\n- decided x");
    expect(flatten(p).map((m) => m.ts)).toEqual(["1789000010.000000", "1789000015.000000", "1789000020.000000", "1789000030.000000", "1789000040.000000"]);
  });

  test("a watched thread yields only its new replies, and expires when quiet for two days", () => {
    const watched: Cursor = { last_ts: "1789000040.000000", watched_threads: { "1789000010.000000": "1789000015.000000", "1788000000.000000": "1788000000.000000" } };
    const parents = { "1789000010.000000": history[0]!, "1788000000.000000": { ts: "1788000000.000000", user: "U1", text: "old root" } };
    const p = assemble(watched, watched.last_ts, [], replies, parents, users, NOW);
    expect(p.newTopLevel).toEqual([]);
    expect(p.threads).toHaveLength(1);
    expect(p.threads[0]?.parentIsNew).toBe(false);
    expect(p.threads[0]?.replies.map((r) => r.text)).toEqual(["reply two"]);
    expect(p.expiredThreads).toEqual(["1788000000.000000"]);
    expect(p.next.watched_threads["1789000010.000000"]).toBe("1789000030.000000");
    expect(flatten(p).map((m) => m.text)).toEqual(["reply two"]);
  });

  test("a deleted watched parent expires", () => {
    const watched: Cursor = { last_ts: "1789000040.000000", watched_threads: { "1789000099.000000": "1789000099.000000" } };
    expect(assemble(watched, watched.last_ts, [], {}, {}, users, NOW).expiredThreads).toEqual(["1789000099.000000"]);
  });
});

describe("canvasToText", () => {
  test("headings, bullets and paragraphs survive; markup does not", () => {
    const html = `<html><body><h1>Huddle notes</h1><h2>Summary</h2><p>Foong signed off the <b>rollover</b>.</p><h2>Action items</h2><ul><li>Liam to file the ticket</li><li>Sam to deploy</li></ul><script>x()</script></body></html>`;
    expect(canvasToText(html)).toBe("## Huddle notes\n## Summary\nFoong signed off the rollover.\n## Action items\n- Liam to file the ticket\n- Sam to deploy");
    expect(canvasToText("<p>@U07JF8MVB27 and @U09R2MYP6A0 agreed; <@U07NTTMRNBF> was absent</p>", { U07JF8MVB27: "Sam O", U07NTTMRNBF: "Foong Leung" })).toBe("@Sam O and @you agreed; @Foong Leung was absent");
  });
});

describe("parseSince", () => {
  test("a date is local midnight, a ts is itself", () => {
    expect(parseSince("1789000000")).toBe("1789000000.000000");
    expect(parseSince("1789000000.123456")).toBe("1789000000.123456");
    expect(parseSince("2026-09-01")).toMatch(/^\d{10}\.000000$/);
  });
});

describe("channels (CTD-274)", () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "argus-slack-"));
    mkdirSync(join(ws, "state"), { recursive: true });
    process.env.ARGUS_ROOT = ws;
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });
  const writeCursor = (v: unknown) => writeFileSync(join(ws, "state", "cursor.json"), JSON.stringify(v));

  /** a Slack that answers history per channel, and throws for the channels in `broken` */
  const fakeApi = (history: Record<string, SlackMessage[]>, broken: string[] = []): SlackApi => ({
    async call<T>(method: string, params: Record<string, string | number | undefined>): Promise<T> {
      if (method === "users.list") return { members: [] } as T;
      const ch = String(params.channel);
      if (broken.includes(ch)) throw new Error(`${method}: channel_not_found`);
      if (method === "conversations.history") return { messages: history[ch] ?? [] } as T;
      return { messages: [] } as T;
    },
    async download() {
      return "";
    },
  });

  test("S-8: a channel that fails keeps its cursor; the other's messages come through and its cursor advances", async () => {
    writeCursor({ channels: { CA: cursor, CB: cursor } });
    const api = fakeApi({ CA: [{ ts: "1789000005.000000", user: "U1", text: "from A" }] }, ["CB"]);
    const p = await pullChannels(["CA", "CB"], { api, now: NOW });
    expect(flatten(p).map((m) => [m.channel, m.text])).toEqual([["CA", "from A"]]);
    expect(p.cursors!.CA!.last_ts).toBe("1789000005.000000");
    expect(p.cursors!.CB).toEqual(cursor);
  });

  test("S-8: when every channel fails, the pull fails, as the one channel's did", async () => {
    writeCursor({ channels: { CA: cursor } });
    await expect(pullChannels(["CA"], { api: fakeApi({}, ["CA"]), now: NOW })).rejects.toThrow("channel_not_found");
  });

  test("S-13: a channel with no cursor yet is read from seven days back", async () => {
    writeCursor({ channels: { [LEGACY_CHANNEL]: cursor } });
    const now = NOW * 1000;
    const c = await readCursors([LEGACY_CHANNEL, "CNEW"], now);
    expect(c[LEGACY_CHANNEL]).toEqual(cursor);
    expect(c.CNEW).toEqual({ last_ts: String(NOW - 7 * 86400), watched_threads: {} });
  });

  test("S-14: a cursor file from before channels becomes the legacy channel's, watched threads intact", async () => {
    const legacy: Cursor = { last_ts: "1789000000.000000", watched_threads: { "1788999000.000000": "1788999500.000000" } };
    writeCursor(legacy);
    expect((await readCursors([LEGACY_CHANNEL]))[LEGACY_CHANNEL]).toEqual(legacy);
  });

  test("S-15: one channel's pull is that channel's pull, each message naming its channel", async () => {
    writeCursor({ channels: { [LEGACY_CHANNEL]: cursor } });
    const history = { [LEGACY_CHANNEL]: [{ ts: "1789000005.000000", user: "U1", text: "hi" }] };
    const one = await pullSlack({ api: fakeApi(history), now: NOW, cursor, channel: LEGACY_CHANNEL });
    const { cursors, ...merged } = await pullChannels([LEGACY_CHANNEL], { api: fakeApi(history), now: NOW });
    expect(merged).toEqual(one);
    expect(cursors).toEqual({ [LEGACY_CHANNEL]: one.next });
    expect(flatten(one)[0]!.channel).toBe(LEGACY_CHANNEL);
  });
});
