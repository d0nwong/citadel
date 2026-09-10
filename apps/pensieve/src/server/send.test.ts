/**
 * The two checks the workstream page's buttons and Ask's card both run (LIA-162 AC2, AC3).
 *
 * Every source is injected, so nothing here touches `WORKSPACE_DIR` — which is fixed at
 * module load and would leak across `bun test`'s shared module registry — except the
 * decisions directory, which is a temp one per test.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMarauderDecision, writeSendDecision } from "./decisions";
import type { TeamIssue } from "./linear";
import type { Workstream, WorkstreamEvent } from "./marauder";
import type { SendSources } from "./send";
import { checkSend, checkVerify, locateEvent } from "./send";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-send-"));
});
afterEach(() => rm(dir, { force: true, recursive: true }));

const event = (e: Partial<WorkstreamEvent> = {}): WorkstreamEvent => ({
  at: "2026-09-09T12:00:00.000Z",
  kind: "directed-at-person",
  summary: "Foundry is running LIA-133, so 2 edits to it are waiting on you.",
  to: ["you"],
  ...e,
});

const workstream = (w: Partial<Workstream> = {}): Workstream => ({
  events: [],
  features: [],
  keys: { people: [], prs: [], threads: [], tickets: ["LIA-133"], vocab: [] },
  milestone: null,
  name: "History asset editing",
  parked: false,
  slug: "history-asset-editing",
  stage: {},
  updated: "2026-09-09",
  wants: [],
  ...w,
});

const issue = (i: Partial<TeamIssue> = {}): TeamIssue => ({
  id: "u1",
  identifier: "LIA-133",
  state: "Backlog",
  stateType: "backlog",
  title: "[FE] History asset editing",
  ...i,
});

const sources = (over: Partial<SendSources> = {}): SendSources => ({
  decisionsDir: dir,
  foundry: async () => ({ configured: true, url: "http://localhost:3777" }),
  issues: async () => [issue()],
  workstreams: async () => [workstream()],
  ...over,
});

describe("AC2 — what Send asks before it reaches Foundry", () => {
  test("a Backlog ticket with no send file, and Foundry up, may go", async () => {
    const check = await checkSend("LIA-133", "alden-portal-fe", sources());
    expect(check).toMatchObject({
      ok: true,
      repo: "alden-portal-fe",
      ticket: "LIA-133",
    });
    expect(check.ok && check.workstream?.slug).toBe("history-asset-editing");
  });

  test("Todo is Linear's `unstarted`, and it may go too", async () => {
    const check = await checkSend(
      "LIA-133",
      "alden-portal-fe",
      sources({
        issues: async () => [issue({ state: "Todo", stateType: "unstarted" })],
      })
    );
    expect(check.ok).toBe(true);
  });

  test("a ticket someone has started is refused, and the sentence says which state", async () => {
    const check = await checkSend(
      "LIA-133",
      "alden-portal-fe",
      sources({
        issues: async () => [
          issue({ state: "In Progress", stateType: "started" }),
        ],
      })
    );
    expect(check).toMatchObject({ ok: false });
    expect(!check.ok && check.error).toContain("In Progress");
  });

  test("a ticket already sent is refused with the file, so the caller can replay it", async () => {
    await writeSendDecision(
      {
        action: "sent",
        at: "2026-09-09T20:00:00.000Z",
        by: "Liam Leung",
        job: { id: "9f1c2d3e", url: "" },
        ticket: "LIA-133",
      },
      dir
    );
    const check = await checkSend("LIA-133", "alden-portal-fe", sources());
    expect(check.ok).toBe(false);
    expect(!check.ok && check.decision?.job.id).toBe("9f1c2d3e");
  });

  test("Linear silent is not a refusal — the state is unknown, and Send still offers", async () => {
    const check = await checkSend(
      "LIA-133",
      "alden-portal-fe",
      sources({ issues: async () => [] })
    );
    expect(check.ok).toBe(true);
  });

  test("no repo is refused on the write, and allowed on a proposal", async () => {
    expect(await checkSend("LIA-133", "", sources())).toMatchObject({
      ok: false,
    });
    expect(
      await checkSend("LIA-133", "", sources(), { repoRequired: false })
    ).toMatchObject({ ok: true, repo: "" });
  });

  test("Foundry unconfigured is refused with its own reason", async () => {
    const check = await checkSend(
      "LIA-133",
      "alden-portal-fe",
      sources({
        foundry: async () => ({
          configured: false,
          reason: "FOUNDRY_API_TOKEN is not set — run `foundry auth --api`",
          url: "http://localhost:3777",
        }),
      })
    );
    expect(!check.ok && check.error).toContain("FOUNDRY_API_TOKEN");
  });

  test.each(["", "lia-133", "LIA", "133", "../x"])(
    "%j is not a ticket key",
    async (key) => {
      expect(await checkSend(key, "r", sources())).toMatchObject({ ok: false });
    }
  );
});

describe("AC3 — what Verify asks before it writes a confirmation", () => {
  const asked = workstream({ events: [event({ ticket: "LIA-133" })] });

  test("names the event by its source ref, as argus's eventKeys does", () => {
    const w = workstream({
      events: [
        event({ source: { ref: "LIA-133", type: "ticket" } }),
        event({ source: { ref: "LIA-133", type: "ticket" } }),
      ],
    });
    expect(locateEvent([w], "LIA-133")?.event).toBe(w.events[0]);
    // The second event out of the same source gets its counter, so the two are addressable.
    expect(locateEvent([w], "LIA-133~2")?.event).toBe(w.events[1]);
    expect(locateEvent([w], "LIA-133~3")).toBeNull();
  });

  test("an unanswered event aimed at the user may be confirmed", async () => {
    const check = await checkVerify(
      "2026-09-09T12:00:00.000Z",
      sources({ workstreams: async () => [asked] })
    );
    expect(check).toMatchObject({ id: "2026-09-09T12:00:00.000Z", ok: true });
    expect(check.ok && check.workstream.slug).toBe("history-asset-editing");
  });

  test("an event nobody is waiting on is refused — a fact is not a question", async () => {
    const w = workstream({
      events: [event({ kind: "verified-landing", to: [] })],
    });
    const check = await checkVerify(
      "2026-09-09T12:00:00.000Z",
      sources({ workstreams: async () => [w] })
    );
    expect(!check.ok && check.error).toContain("asked you nothing");
  });

  test("an event aimed at someone else is refused for the same reason", async () => {
    const w = workstream({ events: [event({ to: ["sam"] })] });
    const check = await checkVerify(
      "2026-09-09T12:00:00.000Z",
      sources({ workstreams: async () => [w] })
    );
    expect(check.ok).toBe(false);
  });

  test("an event already stamped `confirmed:` is refused in the correction's own words", async () => {
    const w = workstream({
      events: [
        event({ action: "confirmed: make the edit it named — Liam Leung" }),
      ],
    });
    const check = await checkVerify(
      "2026-09-09T12:00:00.000Z",
      sources({ workstreams: async () => [w] })
    );
    expect(!check.ok && check.error).toContain("already confirmed");
  });

  test("a confirmation already written is refused with the file, so a second click replays", async () => {
    await writeMarauderDecision(
      {
        action: "verified",
        at: "2026-09-09T21:00:00.000Z",
        by: "Liam Leung",
        id: "2026-09-09T12:00:00.000Z",
      },
      dir
    );
    const check = await checkVerify(
      "2026-09-09T12:00:00.000Z",
      sources({ workstreams: async () => [asked] })
    );
    expect(check.ok).toBe(false);
    expect(!check.ok && check.decided?.action).toBe("verified");
  });

  test("an event on no workstream is refused by name", async () => {
    const check = await checkVerify("nothing", sources());
    expect(!check.ok && check.error).toBe("no event nothing on any workstream");
  });

  test("an empty id is refused before anything is read", async () => {
    expect(await checkVerify("  ", sources())).toMatchObject({ ok: false });
  });
});
