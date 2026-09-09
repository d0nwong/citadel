import { test, expect } from "bun:test";
import { assemble, normaliseText, permalink, readCursor, render, type SlackMessage, type State } from "./slack-pull.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const users = { U1: "Carlos Lopes", U2: "Foong Leung", U09R2MYP6A0: "Liam" };
const msg = (ts: string, user: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({ ts, user, text, ...extra });

test("normaliseText decodes mentions, channels, links and entities", () => {
  expect(normaliseText("hey <@U1> see <#C1|dev-team> and <https://x.y|the doc> &amp; <https://z>", users))
    .toBe("hey @Carlos Lopes see #dev-team and the doc (https://x.y) & https://z");
});

test("permalink formats reply links with thread_ts", () => {
  expect(permalink("1724650000.123456")).toBe("https://alden-studios.slack.com/archives/C07KG06L601/p1724650000123456");
  expect(permalink("1724650100.000001", "1724650000.123456"))
    .toContain("p1724650100000001?thread_ts=1724650000.123456&cid=C07KG06L601");
});

test("assemble: new messages, thread follow, noise, cursor advance", () => {
  const state: State = { last_ts: "100.000000", watched_threads: {} };
  const now = 1000;
  const history = [
    msg("100.000000", "U1", "old — exactly at cursor, excluded"),
    msg("200.000000", "U1", "parent", { reply_count: 2, latest_reply: "260.000000" }),
    msg("210.000000", "U2", "", { subtype: "channel_join" }),
    msg("300.000000", "U2", "ping <@U09R2MYP6A0>"),
  ];
  const replies = { "200.000000": [msg("250.000000", "U2", "r1", { thread_ts: "200.000000" }), msg("260.000000", "U09R2MYP6A0", "r2", { thread_ts: "200.000000" })] };
  const p = assemble(state, state.last_ts, history, replies, {}, users, now);

  expect(p.newTopLevel.map((m) => m.text)).toEqual(["parent", "ping @Liam"]);
  expect(p.newTopLevel[1]!.mentionsMe).toBe(true);
  expect(p.noiseDropped).toBe(1);
  expect(p.threads).toHaveLength(1);
  expect(p.threads[0]!.replies.map((r) => r.author)).toEqual(["Foong Leung", "you"]);
  expect(p.next.last_ts).toBe("300.000000");
  expect(p.next.watched_threads).toEqual({ "200.000000": "260.000000", "300.000000": "300.000000" });
});

test("assemble: watched thread yields only replies newer than last_seen, expires stale ones", () => {
  const state: State = { last_ts: "500.000000", watched_threads: { "10.000000": "20.000000", "11.000000": "11.000000" } };
  const parents = { "10.000000": msg("10.000000", "U1", "old parent", { reply_count: 3 }), "11.000000": msg("11.000000", "U1", "dead", { reply_count: 0 }) };
  const replies = { "10.000000": [msg("20.000000", "U2", "seen"), msg("199000.000000", "U2", "new reply")], "11.000000": [] };
  const p = assemble(state, state.last_ts, [], replies, parents, users, 200000); // 11.0 is >48h old → expires

  expect(p.newTopLevel).toHaveLength(0);
  expect(p.threads).toHaveLength(1);
  expect(p.threads[0]!.parentIsNew).toBe(false);
  expect(p.threads[0]!.replies.map((r) => r.text)).toEqual(["new reply"]);
  expect(p.next.last_ts).toBe("199000.000000");
  expect(p.next.watched_threads).toEqual({ "10.000000": "199000.000000" });
  expect(p.expiredThreads).toEqual(["11.000000"]);
  expect(render(p)).toContain("New replies in older threads");
});

test("huddle notes from Slackbot are content, not noise, and point at the canvas", () => {
  const state: State = { last_ts: "100.000000", watched_threads: {} };
  const parent = msg("200.000000", "USLACKBOT", "A huddle started", {
    reply_count: 1,
    files: [{ id: "F0BU4KUEXTN", title: ":headphones: Huddle notes: 9/1/26 in <#C07KG06L601>", filetype: "quip" }],
  });
  const reply = msg("300.000000", "USLACKBOT", "AI huddle notes are ready.", {
    thread_ts: "200.000000",
    files: [{ id: "F0BU4KUEXTN", title: ":headphones: Huddle notes: 9/1/26 in <#C07KG06L601>", filetype: "quip" }],
  });
  const p = assemble(state, state.last_ts, [parent], { "200.000000": [reply] }, {}, users, 1000);

  expect(p.noiseDropped).toBe(0);
  expect(p.newTopLevel).toHaveLength(1);
  expect(p.newTopLevel[0]!.files[0]).toContain('slack_read_file("F0BU4KUEXTN")');
  expect(render(p)).toContain("HUDDLE NOTES canvas F0BU4KUEXTN");
});

test("render: quiet run says so", () => {
  const p = assemble({ last_ts: "1.000000", watched_threads: {} }, "1.000000", [], {}, {}, users, 2);
  expect(render(p)).toContain("nothing new.");
});

/**
 * The cursor moved out of `digests/` when the digest was retired (LIA-161). Losing a
 * message and re-reading a day are both silent failures, so the move is tested rather than
 * trusted: it carries the old values over, it deletes the old file, and it happens once.
 */
test("the cursor adopts the digest's, once, and leaves nothing to adopt twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "slack-cursor-"));
  const state = join(root, "workstreams/.state.json");
  const digest = join(root, "digests/.state.json");
  await Bun.write(digest, JSON.stringify({ last_ts: "1788949866.296519", watched_threads: { "1788776724.482269": "1788921414.929109" } }));

  const first = await readCursor(state, digest);
  expect(first.last_ts).toBe("1788949866.296519");
  expect(first.watched_threads).toEqual({ "1788776724.482269": "1788921414.929109" });
  expect(await Bun.file(digest).exists()).toBe(false);
  expect(await Bun.file(state).exists()).toBe(true);

  // the second run reads the new file and never looks at the old path again
  expect(await readCursor(state, digest)).toEqual(first);
  await rm(root, { recursive: true, force: true });
});

test("no cursor anywhere is a day back, not the epoch — a fresh clone reads a day, never everything", async () => {
  const root = await mkdtemp(join(tmpdir(), "slack-cursor-"));
  const now = 1788949866_000;
  const fresh = await readCursor(join(root, "workstreams/.state.json"), join(root, "digests/.state.json"), now);
  expect(Number(fresh.last_ts)).toBe(now / 1000 - 24 * 3600);
  expect(fresh.watched_threads).toEqual({});
  await rm(root, { recursive: true, force: true });
});
