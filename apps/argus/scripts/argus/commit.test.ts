import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitRun } from "./commit.ts";

let ws: string;
const sh = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: ws, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-commit-"));
  process.env.ARGUS_ROOT = ws;
  Bun.spawnSync(["git", "init", "-q"], { cwd: ws });
  Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "root"], { cwd: ws });
  mkdirSync(join(ws, "alden/alden-portal/features/tasks/docs"), { recursive: true });
  mkdirSync(join(ws, "state"), { recursive: true });
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

describe("commitRun", () => {
  test("commits ledgers and state, promotes the cursor only after the commit, and is a no-op when clean", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "state/threads.json"), "{}\n");
    writeFileSync(join(ws, "state/cursor.next.json"), '{"last_ts":"1"}\n');
    writeFileSync(join(ws, "state/batches-are-not-committed.txt"), "x");
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    const r = await commitRun("sweep: test", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 2, cursor: "promoted" });
    expect(sh(["git", "log", "-1", "--format=%s"])).toBe("sweep: test");
    expect(sh(["git", "show", "--stat", "--format=", "HEAD"])).not.toContain("batches-are-not-committed");
    expect(await Bun.file(join(ws, "state/cursor.json")).exists()).toBe(true);
    expect(await Bun.file(join(ws, "state/cursor.next.json")).exists()).toBe(false);
    const again = await commitRun("sweep: nothing", { cwd: ws });
    expect(again).toMatchObject({ committed: false, files: 0, cursor: "unchanged" });
  });
  test("dry run stages nothing for keeps and leaves the cursor", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "state/cursor.next.json"), "{}\n");
    const r = await commitRun("x", { cwd: ws, dryRun: true });
    expect(r).toMatchObject({ committed: false, files: 1, cursor: "promoted" });
    expect(await Bun.file(join(ws, "state/cursor.next.json")).exists()).toBe(true);
  });
});
