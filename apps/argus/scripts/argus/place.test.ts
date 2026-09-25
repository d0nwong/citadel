/**
 * The deterministic joins: landings by their mapped features, messages by thread, by
 * ticket key, by PR ref, replies following roots, the rest unplaced with candidates. The
 * same batch twice is byte-identical. `place` writes the placed file, learns threads, and
 * merges the unplaced list.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Batch } from "./batch.ts";
import { featureByKey, keysOf, place, placeBatch, placeContext } from "./place.ts";
import { defaultProjectsConfig, type ProjectsConfig } from "./projects.ts";
import type { Landing } from "./pr-facts.ts";
import { emptyLedger, type Ledger, parseLedger } from "./schema.ts";
import type { Msg } from "./slack-pull.ts";
import { readThreads, readUnplaced, writeUnplaced } from "./state.ts";
import { readLedger, writeLedger } from "./write.ts";

const FIX = new URL("../../evals/fixtures/ledger/", import.meta.url).pathname;
const NOW = new Date("2026-09-11T10:00:00Z");

const msg = (ts: string, text: string, thread = ts, author = "Sam O"): Msg => ({
  ts, channel: "C07KG06L601", thread, date: "2026-09-11", time: "10:00", author, isMe: false, mentionsMe: false, bot: false, text, reactions: "", files: [], canvas: null, permalink: `https://slack/p${ts}`,
});
const landing = (kind: "fe" | "be", n: number, features: string[], ticketKeys: string[] = []): Landing => ({
  repo: kind, ref: `${kind}#${n}`, number: n, sha: `${n}`.padEnd(40, "a"), short: `${n}`.padEnd(9, "a"), at: "2026-09-11T09:00:00Z", date: "2026-09-11",
  by: "Sam O", url: `https://bitbucket.org/x/pull-requests/${n}`, branch: null, title: `pr ${n}`, ticketKeys, files: ["f"], features, routes: [],
});
const batchOf = (messages: Msg[], landings: Landing[] = []): Batch => ({
  id: "2026-09-11T10-00-00Z",
  pulled_at: NOW.toISOString(),
  since: { slack: "0", fe: null, be: null },
  slack: { since: "0", now: NOW.toISOString(), newTopLevel: messages.filter((m) => m.thread === m.ts), threads: [], noiseDropped: 0, expiredThreads: [], next: { last_ts: "0", watched_threads: {} } },
  landings,
});
// replies live in threads[] in a real pull; for these tests put every message in newTopLevel and let flatten order them
const flat = (messages: Msg[], landings: Landing[] = []): Batch => {
  const b = batchOf([], landings);
  b.slack!.newTopLevel = messages;
  return b;
};

let ledgers: Map<string, Ledger>;
beforeEach(async () => {
  ledgers = new Map([["admin/invoicing", parseLedger(await Bun.file(`${FIX}valid.json`).json())]]);
});

describe("placeBatch", () => {
  const features = ["admin/invoicing", "admin/usage", "tasks"];

  test("landings by mapped feature; an unmapped landing is unplaced", () => {
    const p = placeBatch(flat([], [landing("fe", 430, ["tasks", "admin/usage"]), landing("be", 780, [])]), ledgers, {}, features, NOW);
    expect([...p.slices.keys()]).toEqual(["admin/usage", "tasks"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["be#780"]);
    expect(p.unplaced[0]?.candidates).toEqual(["admin/usage", "tasks"]);
  });

  test("an unmapped landing the user placed is sliced to that feature; one they dismissed is dropped", () => {
    const threads = {
      "be#780": { feature: "tasks", by: "user" as const, at: NOW.toISOString() },
      "fe#431": { feature: null, by: "user" as const, at: NOW.toISOString() },
    };
    const p = placeBatch(flat([], [landing("be", 780, []), landing("fe", 431, []), landing("fe", 432, [])]), ledgers, threads, features, NOW);
    expect(p.slices.get("tasks")?.landings.map((l) => l.ref)).toEqual(["be#780"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["fe#432"]);
  });

  test("a known thread places its replies; a new root by ticket key or PR ref is learned", () => {
    const b = flat([
      msg("1", "anything", "1"),
      msg("2", "reply in a known thread", "0.5"),
      msg("3", "ALD-41 is merged", "3"),
      msg("4", "see fe#421 please", "4"),
      msg("5", "follow-up", "3"),
    ]);
    const p = placeBatch(b, ledgers, { "0.5": { feature: "tasks", by: "user", at: "x" } }, features, NOW);
    expect(p.slices.get("tasks")?.messages.map((m) => m.ts)).toEqual(["2"]);
    expect(p.slices.get("admin/invoicing")?.messages.map((m) => m.ts)).toEqual(["3", "4", "5"]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["1"]);
    expect(Object.keys(p.threads).sort()).toEqual(["3", "4"]);
    expect(p.threads["3"]).toEqual({ feature: "admin/invoicing", by: "sweep", at: NOW.toISOString() });
  });

  test("a ticket key names a feature through a landing in the same batch, and a reply pulls an unplaced root along", () => {
    const b = flat([msg("1", "root says nothing", "1"), msg("2", "AP-9 landed", "1")], [landing("fe", 500, ["admin/usage"], ["AP-9"])]);
    const p = placeBatch(b, ledgers, {}, features, NOW);
    expect(p.slices.get("admin/usage")?.messages.map((m) => m.ts).sort()).toEqual(["1", "2"]);
    expect(p.unplaced).toEqual([]);
    expect(p.threads["1"]?.feature).toBe("admin/usage");
  });

  test("a thread the user marked as nobody's is neither sliced nor unplaced", () => {
    const b = flat([msg("1", "chat root", "1"), msg("2", "ALD-41 mentioned in a chat thread", "1"), msg("3", "elsewhere", "3")]);
    const p = placeBatch(b, ledgers, { "1": { feature: null, by: "user", at: "x" } }, features, NOW);
    expect([...p.slices.keys()]).toEqual([]);
    expect(p.unplaced.map((u) => u.id)).toEqual(["3"]);
    expect(p.threads).toEqual({});
  });
  test("a huddle canvas travels in the unplaced text; a reply to an unplaced root is unplaced under it", () => {
    const b = flat([{ ...msg("1", "AI huddle notes are ready", "1", "Slackbot"), canvas: "## Summary\n- x" }, msg("2", "thanks", "1")]);
    const p = placeBatch(b, ledgers, {}, features, NOW);
    expect(p.unplaced.map((u) => [u.id, u.thread])).toEqual([["1", undefined], ["2", "1"]]);
    expect(p.unplaced[0]?.text).toBe("AI huddle notes are ready\n\n## Summary\n- x");
    expect(p.unplaced[0]?.candidates).toEqual(features);
  });

  test("huddle notes posted under a dismissed or placed root are their own thread, and unplaced", () => {
    const notes = { ...msg("2", "AI huddle notes are ready", "1", "Slackbot"), canvas: "## Summary\n- x" };
    const b = flat([notes, msg("3", "follow-up in the huddle thread", "1")]);
    const dismissed = placeBatch(b, ledgers, { "1": { feature: null, by: "user", at: "x" } }, features, NOW);
    expect(dismissed.unplaced.map((u) => [u.id, u.thread])).toEqual([["2", undefined]]);
    expect([...dismissed.slices.keys()]).toEqual([]);
    const placed = placeBatch(b, ledgers, { "1": { feature: "admin/usage", by: "user", at: "x" } }, features, NOW);
    expect(placed.slices.get("admin/usage")?.messages.map((m) => m.ts)).toEqual(["3"]);
    expect(placed.unplaced.map((u) => u.id)).toEqual(["2"]);
    expect(placed.threads).toEqual({});
  });

  test("huddle notes the user placed or dismissed stay where they were put", () => {
    const b = flat([{ ...msg("2", "AI huddle notes are ready", "1", "Slackbot"), canvas: "## Summary" }]);
    const p = placeBatch(b, ledgers, { "1": { feature: null, by: "user", at: "x" }, "2": { feature: "tasks", by: "user", at: "x" } }, features, NOW);
    expect(p.slices.get("tasks")?.messages.map((m) => m.ts)).toEqual(["2"]);
    expect(placeBatch(b, ledgers, { "2": { feature: null, by: "user", at: "x" } }, features, NOW).unplaced).toEqual([]);
  });

  test("the same batch twice is byte-identical", () => {
    const b = flat([msg("2", "b", "2"), msg("1", "ALD-41", "1"), msg("3", "c", "3")], [landing("be", 1, ["tasks"]), landing("fe", 2, ["tasks", "admin/usage"])]);
    const a = JSON.stringify([...placeBatch(b, ledgers, {}, features, NOW).slices.values()]);
    const c = JSON.stringify([...placeBatch(b, ledgers, {}, features, NOW).slices.values()]);
    expect(a).toBe(c);
  });
});

describe("place (on disk)", () => {
  /** Bitbucket, for a pipeline that has not finished */
  const waiting = async () => null;
  let ws: string;
  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), "argus-place-"));
    process.env.ARGUS_ROOT = ws;
    for (const f of ["tasks", "admin/invoicing", "admin/usage"]) mkdirSync(join(ws, "alden/alden-portal/features", f, "docs"), { recursive: true });
    cpSync(`${FIX}valid.json`, join(ws, "alden/alden-portal/features/admin/invoicing/ledger.json"));
    mkdirSync(join(ws, "state/batches"), { recursive: true });
    await writeUnplaced([{ id: "0.9", kind: "message", by: "x", at: "2026-09-10", text: "old root", url: "u", candidates: [], batch: "old" }]);
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });

  test("writes the placed file, learns threads, merges unplaced, and an older root a new reply places leaves the list", async () => {
    const b = flat([msg("1", "hello", "1"), msg("2", "ALD-41 reply", "0.9")]);
    const path = join(ws, "state/batches", `${b.id}.json`);
    await Bun.write(path, JSON.stringify(b));
    const placed = await place(b.id, { now: NOW, deployed: waiting });
    expect(placed.slices.map((s) => s.feature)).toEqual(["admin/invoicing"]);
    expect(placed.unplaced).toEqual(["1"]);
    expect(await Bun.file(join(ws, "state/batches", `${b.id}.placed.json`)).exists()).toBe(true);
    expect((await readThreads())["0.9"]?.feature).toBe("admin/invoicing");
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1"]);
    const again = await place(b.id, { now: NOW, deployed: waiting });
    expect(again).toEqual(placed);
    expect((await readUnplaced()).map((u) => u.id)).toEqual(["1"]);
  });
  test("C4: an existing unplaced entry's suggestion survives a placing that does not touch it", async () => {
    await writeUnplaced([
      {
        id: "0.9",
        kind: "message",
        by: "x",
        at: "2026-09-10",
        text: "old root",
        url: "u",
        candidates: [],
        batch: "old",
        suggestion: { feature: "tasks", confidence: 0.7, model: "jev-v1" },
      },
    ]);
    const b = flat([msg("1", "hello", "1")]);
    const path = join(ws, "state/batches", `${b.id}.json`);
    await Bun.write(path, JSON.stringify(b));
    await place(b.id, { now: NOW, deployed: waiting });
    expect((await readUnplaced()).find((u) => u.id === "0.9")?.suggestion).toEqual({
      feature: "tasks",
      confidence: 0.7,
      model: "jev-v1",
    });
  });
  test("a slice's landings go onto the ledger, once", async () => {
    const b = flat([], [landing("fe", 431, ["admin/invoicing"])]);
    const path = join(ws, "state/batches", `${b.id}.json`);
    await Bun.write(path, JSON.stringify(b));
    await place(b.id, { now: NOW, deployed: waiting });
    const l = (await readLedger("admin/invoicing"))!;
    expect(l.landings.map((x) => x.ref)).toEqual(["be#771", "fe#431"]);
    await place(b.id, { now: NOW, deployed: waiting });
    expect((await readLedger("admin/invoicing"))!.landings).toHaveLength(2);
  });
  test("an earlier landing whose deploy finished reaches the reader once, with nothing new in the batch", async () => {
    const b = flat([]);
    await Bun.write(join(ws, "state/batches", `${b.id}.json`), JSON.stringify(b));
    const live = async () => ({ result: "SUCCESSFUL" as const, at: "2026-09-11T09:30:00Z", build: 2142, url: "u" });
    // still running: nothing to tell, nothing written
    expect((await place(b.id, { now: NOW, deployed: waiting })).slices).toEqual([]);
    expect((await readLedger("admin/invoicing"))!.landings[0]!.deployed).toBeUndefined();
    // finished: the ledger records it untold, and the feature gets a slice carrying it
    const placed = await place(b.id, { now: NOW, deployed: live });
    expect(placed.slices).toEqual([
      { feature: "admin/invoicing", messages: [], landings: [], deploys: [{ ref: "be#771", title: "credit emails link to the production domain", landed: "2026-09-10", deploy: { result: "SUCCESSFUL", at: "2026-09-11T09:30:00Z", build: 2142, url: "u" } }] },
    ]);
    expect((await readLedger("admin/invoicing"))!.landings[0]!.deployed).toMatchObject({ build: 2142, told: false });
    // placed again before the reader ran: the same slice, from the ledger, Bitbucket not asked
    const never = async () => {
      throw new Error("asked");
    };
    expect(await place(b.id, { now: NOW, deployed: never })).toEqual(placed);
  });
  test("a new backend landing that already deployed is told by its own slice", async () => {
    const b = flat([], [landing("be", 801, ["admin/invoicing"])]);
    await Bun.write(join(ws, "state/batches", `${b.id}.json`), JSON.stringify(b));
    const live = async (_r: string, sha: string) => (sha.startsWith("801") ? { result: "SUCCESSFUL" as const, at: "2026-09-11T09:30:00Z", build: 2150, url: "u" } : null);
    const placed = await place(b.id, { now: NOW, deployed: live });
    expect(placed.slices[0]!.deploys).toBeUndefined();
    const ld = (await readLedger("admin/invoicing"))!.landings.find((x) => x.ref === "be#801")!;
    expect(ld.deployed).toMatchObject({ build: 2150, told: true });
  });

  test("a landing on a second record project's repo places it on that project's own feature and ledger; a second place adds nothing (CTD-271, ledger S-27, AC2)", async () => {
    writeFileSync(join(ws, "projects.json"), JSON.stringify({
      projects: [
        { id: "alden-portal", repos: [], trackers: [], jobs: ["docs", "record"], areas: [{ id: "alden-portal", repo: "fe", dir: "alden/alden-portal" }] },
        { id: "widget", repos: [{ id: "app", cloneUrl: "u", path: "", baseBranch: "main", host: "github", deploy: { kind: "live" } }], trackers: [], jobs: ["record"], areas: [{ id: "widget", repo: "app", dir: "widget" }] },
      ],
      channels: [],
    }));
    mkdirSync(join(ws, "widget/features/core/docs"), { recursive: true });
    await writeLedger("core", { ...emptyLedger("core", "the widget's own feature") }, { app: "widget", actor: "user", now: new Date("2026-09-10T00:00:00Z") });

    const widgetLanding = { ...landing("fe", 1, ["core"]), repo: "app", ref: "app#1" } as unknown as Landing;
    const b: Batch = { ...batchOf([], [widgetLanding]), slack: null };
    await Bun.write(join(ws, "state/batches", `${b.id}.json`), JSON.stringify(b));

    const placed = await place(b.id, { now: NOW, deployed: waiting });
    expect(placed.slices).toEqual([{ feature: "core", messages: [], landings: [widgetLanding] }]);
    const widgetLedger = (await readLedger("core", "widget"))!;
    expect(widgetLedger.landings.map((x) => x.ref)).toEqual(["app#1"]);
    // alden-portal's own ledgers are untouched
    expect(await readLedger("core")).toBeNull();

    await place(b.id, { now: NOW, deployed: waiting });
    expect((await readLedger("core", "widget"))!.landings).toHaveLength(1);
  });
});

describe("channels bound placement (CTD-275)", () => {
  const alden = defaultProjectsConfig().projects[0]!;
  const config: ProjectsConfig = {
    projects: [
      alden,
      {
        id: "acme",
        repos: [{ id: "app", cloneUrl: "https://github.com/acme/app.git", path: "", baseBranch: "main", host: "github", deploy: { kind: "live" } }],
        trackers: [{ provider: "linear", key: "CTD", prefixes: ["CTD"] }],
        jobs: ["docs", "record"],
        areas: [{ id: "acme", repo: "app", dir: "acme/app" }],
      },
    ],
    channels: [
      { id: "C_ALDEN", projects: ["alden-portal"] },
      { id: "C_ACME", projects: ["acme"] },
      { id: "C_SHARED", projects: ["alden-portal", "acme"] },
    ],
  };
  const recorded = [
    { app: "alden/alden-portal", feature: "tasks" },
    { app: "alden/alden-portal", feature: "admin/usage" },
    { app: "acme/app", feature: "home" },
  ];
  const features = recorded.map((r) => r.feature);
  const ctx = placeContext(config, recorded);
  const inChannel = (ts: string, text: string, channel: string): Msg => ({ ...msg(ts, text), channel });
  const acmeLedger = (): Ledger => {
    const l = emptyLedger("home", "", NOW.toISOString());
    l.landings.push({ at: NOW.toISOString(), repo: "app", ref: "app#12", number: 12, sha: "c".repeat(40), title: "pr 12", by: "Sam O", url: "https://github.com/acme/app/pull/12", asks: [], files: [], tickets: [] });
    return l;
  };

  test("S-9: a message no join places, in a one-project channel, has only that project's features as candidates", () => {
    const p = placeBatch(flat([inChannel("1", "nothing to join on", "C_ACME")]), new Map(), {}, features, NOW, ctx);
    expect(p.unplaced.map((u) => [u.id, u.channel, u.candidates])).toEqual([["1", "C_ACME", ["home"]]]);
  });

  test("S-10: in a channel carrying two projects, an unplaced message's candidates come from both", () => {
    const p = placeBatch(flat([inChannel("1", "nothing to join on", "C_SHARED")]), new Map(), {}, features, NOW, ctx);
    expect(p.unplaced[0]?.candidates).toEqual(["tasks", "admin/usage", "home"]);
  });

  test("S-11: an AP key on an alden-portal ledger places the message by key", () => {
    const l = emptyLedger("tasks", "", NOW.toISOString());
    l.tickets.push({ key: "AP-12", blockers: [] } as unknown as Ledger["tickets"][number]);
    expect(featureByKey("see AP-12", keysOf(new Map([["tasks", l]])), new Map(), ctx, "C_ALDEN")).toBe("tasks");
  });

  test("S-12: app#12 goes to the project that declares repo app, even from another project's channel", () => {
    const p = placeBatch(flat([inChannel("1", "app#12 is the fix", "C_ALDEN")]), new Map([["home", acmeLedger()]]), {}, features, NOW, ctx);
    expect(p.slices.get("home")?.messages.map((m) => m.ts)).toEqual(["1"]);
    expect(p.unplaced).toEqual([]);
  });

  test("S-12: a PR URL on repo app goes only to the project that declares app", () => {
    const keys = keysOf(new Map([["home", acmeLedger()], ["tasks", emptyLedger("tasks", "", NOW.toISOString())]]));
    expect(featureByKey("https://github.com/acme/app/pull/12", keys, new Map(), ctx, "C_ALDEN")).toBe("home");
    // the same number on alden-portal's own repos does not answer for a URL that names app
    keys.prs.set("fe#12", "tasks");
    expect(featureByKey("https://github.com/acme/app/pull/12", keys, new Map(), ctx, "C_ALDEN")).toBe("home");
  });

  test("a bare PR #N tries only the repos of the channel's projects", () => {
    const keys = keysOf(new Map([["home", acmeLedger()]]));
    keys.prs.set("fe#12", "tasks");
    expect(featureByKey("PR #12 merged", keys, new Map(), ctx, "C_ALDEN")).toBe("tasks");
    expect(featureByKey("PR #12 merged", keys, new Map(), ctx, "C_ACME")).toBe("home");
  });
});
