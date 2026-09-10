/**
 * The click applies (ARG-169 AC4, AC5): `applyDecisions` with the command stubbed to
 * succeed, fail, time out and be missing. It never throws — every way apply cannot run
 * answers `applied: false` with a note, and the decision file is the fallback.
 */

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { applyDecisions } from "./marauder";

const at = { cwd: tmpdir() };

describe("applyDecisions", () => {
  test("a run that exits 0 applied", async () => {
    expect(await applyDecisions(["sh", "-c", "exit 0"], at)).toEqual({
      applied: true,
    });
  });

  test("a busy lock answers its one sentence as the note", async () => {
    const v = await applyDecisions(
      [
        "sh",
        "-c",
        "echo starting >&2; echo 'lock held by pid 42 since 12:00' >&2; exit 1",
      ],
      at
    );
    expect(v.applied).toBe(false);
    expect(v.note).toStartWith("lock held by pid 42 since 12:00");
    expect(v.note).toContain("next sweep");
  });

  test("a failure with no stderr still says what happened", async () => {
    const v = await applyDecisions(["sh", "-c", "exit 3"], at);
    expect(v).toEqual({
      applied: false,
      note: "marauder apply exited 3 — the next sweep will apply it",
    });
  });

  test("a run past the timeout is killed and noted", async () => {
    const started = Date.now();
    const v = await applyDecisions(["sh", "-c", "sleep 5"], {
      ...at,
      timeout: 200,
    });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(v.applied).toBe(false);
    expect(v.note).toContain("took longer than");
  });

  test("a missing binary says so rather than failing silently", async () => {
    const v = await applyDecisions(["no-such-bun-here", "run"], at);
    expect(v.applied).toBe(false);
    expect(v.note).toContain("no-such-bun-here");
  });
});
