/**
 * The shared verdict checks (LIA-111) and the bridged tool that answers with them. Both run
 * against injected sources — a real temp `decisions/` directory plus a stub `points.json`
 * and Foundry config — so no test here touches the machine's workspace. (`bun test` shares
 * one module registry across files, so a `WORKSPACE_DIR` env override would leak into
 * ask.test.ts and depend on file order.)
 *
 * The property under every case: the tool writes nothing. `decisions/` is read at the end
 * of each block and must still be empty.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROPOSE_DECISION } from "../lib/ask-tools";
import {
  PROPOSAL_NOTE,
  proposeDecision,
  proposeDecisionTool,
} from "./ask-tools.server";
import type { Decision } from "./decisions";
import { writeDecision } from "./decisions";
import type { FoundryConfig } from "./foundry";
import type { VerdictSources } from "./verdict";
import { checkIgnore, checkSend, checkVerdict, checkVerify } from "./verdict";
import type { Point, PointsFile } from "./workspace";

const point = (id: string, extra: Partial<Point> = {}): Point => ({
  ask: "Decide it",
  firstSeen: "2026-09-05",
  group: id.split("/")[0] as Point["group"],
  id,
  subject: `Subject for ${id}`,
  ...extra,
});

const POINTS: Point[] = [
  point("decide/prototype-page"),
  point("decide/history-rollup", {
    repo: "~/git/alden-portal-fe",
    ticket: "LIA-71",
  }),
  point("verify/no-ticket"),
  point("verify/appears-implemented", {
    ask: "LIA-78 appears implemented — confirm and I will edit the ticket",
    ticket: "LIA-78",
  }),
];

const FOUNDRY_ON: FoundryConfig = {
  configured: true,
  url: "http://foundry.test",
};
const OFF_REASON = "FOUNDRY_API_TOKEN is not set — run `foundry auth --api`";
const FOUNDRY_OFF: FoundryConfig = {
  configured: false,
  reason: OFF_REASON,
  url: "http://foundry.test",
};

/** No point in the sweep's file carries a `repo` today; this is that shape. */
const noRepoSources = (): VerdictSources => ({
  ...sources,
  readPoints: () =>
    Promise.resolve({
      date: "d",
      points: [point("decide/ticketed", { ticket: "LIA-9" })],
      tick: "t",
    } satisfies PointsFile),
});

let dir: string;
let sources: VerdictSources;
const decisionsDir = () => join(dir, "decisions");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pensieve-verdict-"));
  sources = {
    decisionsDir: decisionsDir(),
    foundry: () => Promise.resolve(FOUNDRY_ON),
    readPoints: () =>
      Promise.resolve({
        date: "2026-09-07",
        points: POINTS,
        tick: "t1",
      } satisfies PointsFile),
  };
});
afterEach(() => rm(dir, { force: true, recursive: true }));

/** Every `.json` under the temp `decisions/`, recursively — empty is the invariant. */
const written = async (): Promise<string[]> => {
  try {
    return (
      (await readdir(decisionsDir(), { recursive: true })) as string[]
    ).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
};

const decide = (id: string, action: Decision["action"] = "ignored") =>
  writeDecision(
    {
      action,
      at: "2026-09-06T09:30:00.000Z",
      point: id,
      subject: "S",
      ...(action === "ignored" ? { reason: "done already" } : {}),
    },
    decisionsDir()
  );

describe("checkIgnore — the checks decidePoint makes before it writes", () => {
  test("a point in points.json with a reason passes, and the reason comes back trimmed", async () => {
    const c = await checkIgnore(
      "decide/prototype-page",
      "  it is a prototype  ",
      sources
    );
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.point.id).toBe("decide/prototype-page");
      expect(c.reason).toBe("it is a prototype");
    }
  });
  test("refuses an id that is not a point id", async () => {
    expect(await checkIgnore("../etc/passwd", "why", sources)).toMatchObject({
      error: '"../etc/passwd" is not a point id',
      ok: false,
    });
  });
  test("refuses a missing reason before it looks the point up", async () => {
    expect(
      await checkIgnore("decide/prototype-page", "   ", sources)
    ).toMatchObject({
      error: "a reason is required to ignore a point",
      ok: false,
    });
  });
  test("refuses a point the last tick does not name", async () => {
    expect(await checkIgnore("decide/nope", "why", sources)).toMatchObject({
      error: "that point is not in reports/points.json",
      ok: false,
    });
  });
  test("refuses a point that already has a decision, and hands the decision back", async () => {
    await decide("decide/prototype-page");
    const c = await checkIgnore("decide/prototype-page", "why", sources);
    expect(c).toMatchObject({
      error: "already ignored on 2026-09-06 09:30",
      ok: false,
    });
    expect(c.ok === false && c.decision?.point).toBe("decide/prototype-page");
  });
});

describe("checkVerify — the checks verifyPoint makes before it writes (LIA-115)", () => {
  test("a Verify-group point with no note passes, and no reason comes back", async () => {
    const c = await checkVerify("verify/appears-implemented", "", sources);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.point.id).toBe("verify/appears-implemented");
      // A confirmation needs no argument, unlike an ignore (AC2).
      expect(c.reason).toBeUndefined();
    }
    expect(await written()).toEqual([]);
  });
  test("a note comes back trimmed", async () => {
    const c = await checkVerify(
      "verify/appears-implemented",
      "  correct — the AC is ticked  ",
      sources
    );
    expect(c.ok === true && c.reason).toBe("correct — the AC is ticked");
  });
  test("whitespace only is no note, not an empty reason", async () => {
    const c = await checkVerify("verify/appears-implemented", "   ", sources);
    expect(c.ok === true && c.reason).toBeUndefined();
  });
  test("a point in another group is refused — the verb is minted for Verify only (AC1)", async () => {
    const c = await checkVerify("decide/prototype-page", "", sources);
    expect(c.ok).toBe(false);
    expect(c.ok === false && c.error).toBe(
      "verify is for the Verify group — that point is in decide"
    );
    expect(await written()).toEqual([]);
  });
  test.each([["../etc/passwd"], ["verify/UPPER"], [""]])(
    "refuses %j as a point id",
    async (id) => {
      const c = await checkVerify(id, "", sources);
      expect(c.ok === false && c.error).toBe(`"${id}" is not a point id`);
    }
  );
  test("a point absent from points.json is refused", async () => {
    const c = await checkVerify("verify/not-a-point", "", sources);
    expect(c.ok === false && c.error).toBe(
      "that point is not in reports/points.json"
    );
  });
  test("an already-decided point is refused with the same message as Ignore (AC4)", async () => {
    await decide("verify/appears-implemented", "verified");
    const c = await checkVerify("verify/appears-implemented", "", sources);
    expect(c.ok).toBe(false);
    expect(c.ok === false && c.error).toBe(
      "already verified on 2026-09-06 09:30"
    );
    expect(c.ok === false && c.decision?.action).toBe("verified");
  });
  test("a point already sent is refused too — the verdicts stay exclusive (AC4)", async () => {
    await decide("verify/appears-implemented", "sent");
    const c = await checkVerify("verify/appears-implemented", "", sources);
    expect(c.ok === false && c.error).toBe("already sent on 2026-09-06 09:30");
  });
  test("Foundry is never consulted — a verdict lands with the token unset (AC6)", async () => {
    const c = await checkVerify("verify/appears-implemented", "", {
      ...sources,
      foundry: () => Promise.reject(new Error("Foundry must not be read")),
    });
    expect(c.ok).toBe(true);
  });
});

describe("checkSend — the checks sendPoint makes before it reaches Foundry", () => {
  test("a ticketed point with Foundry on passes and resolves the repo from the point", async () => {
    const c = await checkSend("decide/history-rollup", "", sources);
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.repo).toBe("~/git/alden-portal-fe");
      expect(c.ticket).toBe("LIA-71");
    }
  });
  test("an explicit repo wins over the point's own", async () => {
    const c = await checkSend("decide/history-rollup", " /srv/other ", sources);
    expect(c.ok && c.repo).toBe("/srv/other");
  });
  test("refuses a point that names no ticket", async () => {
    expect(
      await checkSend("verify/no-ticket", "/srv/x", sources)
    ).toMatchObject({
      error:
        "that point names no ticket — file one first (the sweep's ticket pass)",
      ok: false,
    });
  });
  test("refuses when neither the call nor the point names a repo — the write insists on one", async () => {
    expect(
      await checkSend("decide/ticketed", "", noRepoSources())
    ).toMatchObject({
      error: "a repo is required — a path Foundry tracks, or its name",
      ok: false,
    });
  });
  test("repoRequired: false passes with an empty repo — a proposal collects it on the card", async () => {
    const c = await checkSend("decide/ticketed", "", noRepoSources(), {
      repoRequired: false,
    });
    expect(c.ok).toBe(true);
    expect(c.ok && c.repo).toBe("");
  });
  test("refuses a decided point, and hands the decision back so sendPoint can replay it", async () => {
    await decide("decide/history-rollup", "sent");
    const c = await checkSend("decide/history-rollup", "", sources);
    expect(c).toMatchObject({
      error: "already sent on 2026-09-06 09:30",
      ok: false,
    });
    expect(c.ok === false && c.decision?.action).toBe("sent");
  });
  test("refuses with Foundry's own reason when Foundry is off", async () => {
    const off = { ...sources, foundry: () => Promise.resolve(FOUNDRY_OFF) };
    expect(await checkSend("decide/history-rollup", "", off)).toMatchObject({
      error: OFF_REASON,
      ok: false,
    });
  });
  test("a decided point replays before Foundry's availability is consulted", async () => {
    await decide("decide/history-rollup", "sent");
    const off = { ...sources, foundry: () => Promise.resolve(FOUNDRY_OFF) };
    const c = await checkSend("decide/history-rollup", "", off);
    expect(c.ok === false && c.decision?.action).toBe("sent");
  });
});

describe("checkVerdict — the same checks, by action", () => {
  test("dispatches on the action", async () => {
    expect(
      await checkVerdict(
        "decide/prototype-page",
        "ignored",
        { reason: "why" },
        sources
      )
    ).toMatchObject({ ok: true });
    expect(
      await checkVerdict("decide/history-rollup", "sent", {}, sources)
    ).toMatchObject({ ok: true });
    expect(
      await checkVerdict("decide/prototype-page", "sent", {}, sources)
    ).toMatchObject({ ok: false });
  });
});

describe("AC1 / AC4 — propose_decision answers a proposal and writes nothing", () => {
  test("an ignore proposal carries the point, subject and reason, and says it is not written", async () => {
    const out = await proposeDecision(
      {
        action: "ignored",
        point: "decide/prototype-page",
        reason: "it is a prototype page",
      },
      { threadId: "th1" },
      sources
    );
    expect(out).toEqual({
      note: PROPOSAL_NOTE,
      ok: true,
      proposal: {
        action: "ignored",
        point: "decide/prototype-page",
        reason: "it is a prototype page",
        subject: "Subject for decide/prototype-page",
      },
    });
    expect(await written()).toEqual([]);
  });

  test("a send proposal on a point with no repo omits it rather than refusing", async () => {
    const out = await proposeDecision(
      { action: "sent", point: "decide/ticketed" },
      {},
      noRepoSources()
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: { action: "sent", ticket: "LIA-9" },
    });
    expect(out.ok === true && "repo" in out.proposal).toBe(false);
    expect(await written()).toEqual([]);
  });

  test("a send proposal carries the ticket and the point's repo", async () => {
    const out = await proposeDecision(
      { action: "sent", point: "decide/history-rollup" },
      {},
      sources
    );
    expect(out).toMatchObject({
      ok: true,
      proposal: {
        action: "sent",
        repo: "~/git/alden-portal-fe",
        ticket: "LIA-71",
      },
    });
    expect(await written()).toEqual([]);
  });

  test.each([
    [
      { action: "ignored", point: "decide/nope", reason: "why" },
      "that point is not in reports/points.json",
    ],
    [
      { action: "ignored", point: "decide/prototype-page" },
      "a reason is required to ignore a point",
    ],
    [
      { action: "sent", point: "verify/no-ticket" },
      "that point names no ticket — file one first (the sweep's ticket pass)",
    ],
  ] as const)(
    "refuses %o with the Points page's own text",
    async (args, error) => {
      expect(await proposeDecision(args, {}, sources)).toEqual({
        error,
        ok: false,
      });
      expect(await written()).toEqual([]);
    }
  );

  test("refuses a send while Foundry is off, with Foundry's reason", async () => {
    const off = { ...sources, foundry: () => Promise.resolve(FOUNDRY_OFF) };
    expect(
      await proposeDecision(
        { action: "sent", point: "decide/history-rollup" },
        {},
        off
      )
    ).toEqual({ error: OFF_REASON, ok: false });
    expect(await written()).toEqual([]);
  });

  test("refuses a point that already has a decision — no second Confirm is ever offered", async () => {
    await decide("decide/prototype-page");
    expect(
      await proposeDecision(
        { action: "ignored", point: "decide/prototype-page", reason: "again" },
        {},
        sources
      )
    ).toEqual({ error: "already ignored on 2026-09-06 09:30", ok: false });
    expect(await written()).toEqual(["decide/prototype-page.json"]);
  });

  test("validates its own arguments — the bridge hands execute raw MCP JSON", async () => {
    for (const args of [
      undefined,
      {},
      { action: "deleted", point: "decide/prototype-page" },
      { action: "ignored", point: "../etc/passwd", reason: "why" },
      {
        action: "ignored",
        point: "decide/prototype-page",
        reason: "x".repeat(281),
      },
    ]) {
      const out = await proposeDecision(args, {}, sources);
      expect(out.ok).toBe(false);
      expect(out.ok === false && out.error).toMatch(/^propose_decision: /);
    }
    expect(await written()).toEqual([]);
  });
});

describe("AC8 — the tool definition the bridge advertises", () => {
  test("is named for the allowlist and takes the four arguments the skill names", () => {
    expect(proposeDecisionTool.name).toBe(PROPOSE_DECISION);
    expect(proposeDecisionTool.name).toBe("propose_decision");
    const shape = Object.keys(proposeDecisionTool.inputSchema.shape);
    expect(shape.sort()).toEqual(["action", "point", "reason", "repo"]);
    expect(proposeDecisionTool.description).toMatch(
      /never say the point has been/i
    );
  });
});
