/**
 * The pure half of slack-pull: text normalisation, the pull assembled from raw results
 * (cursor advance, thread following, noise, expiry), a huddle canvas's text on its
 * message, and `flatten`.
 */

import { describe, expect, test } from "bun:test";
import { assemble, canvasToText, type Cursor, flatten, normaliseText, parseSince, permalink, type SlackMessage, toMsg } from "./slack-pull.ts";

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
