/**
 * `readPoints` — the `reports/points.json` reader, and specifically its copy of the sweep's
 * verdict (LIA-115 AC5). The record is validated field by field, so the set of actions the
 * reader accepts has to track the shared contract in argus `skills/sweep/scripts/points.ts`;
 * a verb it does not know is dropped and the point renders as undecided.
 *
 * Run in a subprocess with `WORKSPACE_DIR` pointed at a temp blackboard. `REPORTS_DIR` is
 * fixed from the env at module load and `bun test` shares one module registry across files,
 * so setting it in-process would leak into every other suite and depend on file order — the
 * hazard verdict.test.ts's header calls out. A fresh process has neither problem.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const record = (verdict: unknown) => ({
  ask: "LIA-78 appears implemented — confirm and I will edit the ticket",
  decision: verdict,
  firstSeen: "2026-09-05",
  group: "verify",
  id: "verify/appears-implemented",
  subject: "LIA-78",
  ticket: "LIA-78",
});

/** `readPoints()` against a temp workspace holding this `points.json`, as JSON. */
async function read(pointsFile: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "pensieve-workspace-"));
  try {
    await mkdir(join(dir, "reports"), { recursive: true });
    await writeFile(
      join(dir, "reports", "points.json"),
      JSON.stringify(pointsFile)
    );
    const proc = Bun.spawn(
      [
        "bun",
        "-e",
        'const { readPoints } = await import("./src/server/workspace.ts");' +
          "console.log(JSON.stringify(await readPoints()));",
      ],
      {
        env: { ...process.env, WORKSPACE_DIR: dir },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(`readPoints exited ${code}: ${err}`);
    }
    return JSON.parse(out.trim());
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

const decision = (action: string, extra: Record<string, unknown> = {}) => ({
  action,
  at: "2026-09-07T09:30:00.000Z",
  point: "verify/appears-implemented",
  subject: "LIA-78",
  ...extra,
});

describe("AC5 — the sweep's copy of a verdict, by action", () => {
  test("verified renders the point as decided", async () => {
    const file = await read({
      date: "2026-09-07",
      points: [record(decision("verified"))],
      tick: "t1",
    });
    expect(file.points[0].decision).toMatchObject({
      action: "verified",
      point: "verify/appears-implemented",
    });
  });
  test("verified with a reason carries it", async () => {
    const file = await read({
      date: "2026-09-07",
      points: [record(decision("verified", { reason: "correct" }))],
      tick: "t1",
    });
    expect(file.points[0].decision.reason).toBe("correct");
  });
  test.each(["sent", "ignored"])("%s still renders as decided", async (a) => {
    const file = await read({
      date: "2026-09-07",
      points: [record(decision(a, { reason: "r" }))],
      tick: "t1",
    });
    expect(file.points[0].decision.action).toBe(a);
  });
  test("an action outside the contract is dropped — the point is undecided", async () => {
    const file = await read({
      date: "2026-09-07",
      points: [record(decision("maybe"))],
      tick: "t1",
    });
    expect(file.points[0].decision).toBeUndefined();
  });
  test("no decision at all is undecided", async () => {
    const file = await read({
      date: "2026-09-07",
      points: [record(undefined)],
      tick: "t1",
    });
    expect(file.points[0].decision).toBeUndefined();
  });
});
