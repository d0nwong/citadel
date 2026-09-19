import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMITTABLE, commitRun, saveRun } from "./commit.ts";

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
  test("a modified tracked ledger, whose status line starts with a space, is staged whole", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    Bun.spawnSync(["git", "add", "-A"], { cwd: ws });
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: ws });
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), '{"changed":true}\n');
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    const r = await commitRun("sweep: modified", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "show", "--stat", "--format=", "HEAD"])).toContain("tasks/ledger.json");
  });
  test("dry run stages nothing for keeps and leaves the cursor", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "state/cursor.next.json"), "{}\n");
    const r = await commitRun("x", { cwd: ws, dryRun: true });
    expect(r).toMatchObject({ committed: false, files: 1, cursor: "promoted" });
    expect(await Bun.file(join(ws, "state/cursor.next.json")).exists()).toBe(true);
  });
});

describe("COMMITTABLE", () => {
  test("a run may commit ledgers, arch docs, specs, revisions, the committed state and the manifest, and nothing else", () => {
    for (const p of [
      "alden/alden-portal/features/tasks/ledger.json",
      "foundry/features/jobs/docs/arch.md",
      "foundry/features/jobs/docs/spec.md",
      "revisions/CTD-192/revision.json",
      "revisions/CTD-192/specs/foundry/jobs.md",
      "revisions/archive/CTD-65/plan.md",
      "state/threads.json",
      "argus/.doc-workspace/feature-manifest.json",
    ])
      expect(COMMITTABLE.test(p)).toBe(true);
    for (const p of ["foundry/features/jobs/docs/product.md", "state/batches/x.json", "state/cursor.json", "docs/revisions/CTD-192/plan.md", "README.md"])
      expect(COMMITTABLE.test(p)).toBe(false);
  });
});

describe("a fold's product.md", () => {
  test("its deletion is committed; an edit to one is not", async () => {
    for (const f of ["jobs", "blueprints"]) {
      mkdirSync(join(ws, `foundry/features/${f}/docs`), { recursive: true });
      writeFileSync(join(ws, `foundry/features/${f}/docs/product.md`), "# p\n");
    }
    Bun.spawnSync(["git", "add", "-A"], { cwd: ws });
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: ws });
    rmSync(join(ws, "foundry/features/jobs/docs/product.md"));
    writeFileSync(join(ws, "foundry/features/blueprints/docs/product.md"), "# edited\n");
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    const r = await commitRun("fold", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "show", "--stat", "--format=", "HEAD"])).toContain("jobs/docs/product.md");
    expect(sh(["git", "status", "--porcelain"])).toContain("blueprints/docs/product.md");
  });
});

describe("saveRun", () => {
  // the sandbox itself exports GIT_AUTHOR_* to give every commit a consistent identity;
  // that would mask the very thing under test, so it is cleared for this block only.
  let savedAuthorName: string | undefined;
  let savedAuthorEmail: string | undefined;
  beforeEach(() => {
    savedAuthorName = process.env.GIT_AUTHOR_NAME;
    savedAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
    Bun.spawnSync(["git", "config", "user.email", "person@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "The Person"], { cwd: ws });
  });
  afterEach(() => {
    if (savedAuthorName !== undefined) process.env.GIT_AUTHOR_NAME = savedAuthorName;
    if (savedAuthorEmail !== undefined) process.env.GIT_AUTHOR_EMAIL = savedAuthorEmail;
  });

  test("commits exactly the named files, as the person running it, leaving an unnamed on-list file uncommitted", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "state/threads.json"), "{}\n");
    const r = await saveRun(["alden/alden-portal/features/tasks/ledger.json"], "save: tasks", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "log", "-1", "--format=%s"])).toBe("save: tasks");
    expect(sh(["git", "log", "-1", "--format=%an <%ae>"])).toBe("The Person <person@t>");
    const stat = sh(["git", "show", "--stat", "--format=", "HEAD"]);
    expect(stat).toContain("tasks/ledger.json");
    expect(stat).not.toContain("threads.json");
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("state/threads.json");
  });

  test("refuses, naming it, a path off S-12's list, and commits nothing", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "README.md"), "hi\n");
    const before = sh(["git", "log", "-1", "--format=%H"]);
    await expect(saveRun(["alden/alden-portal/features/tasks/ledger.json", "README.md"], "save: bad", { cwd: ws })).rejects.toThrow(/README\.md/);
    expect(sh(["git", "log", "-1", "--format=%H"])).toBe(before);
    const status = sh(["git", "status", "--porcelain", "--untracked-files=all"]);
    expect(status).toContain("README.md");
    expect(status).toContain("tasks/ledger.json");
  });

  test("a --dry-run refusal names the same off-list path without committing", async () => {
    writeFileSync(join(ws, "README.md"), "hi\n");
    await expect(saveRun(["README.md"], "save: bad", { cwd: ws, dryRun: true })).rejects.toThrow(/README\.md/);
  });

  test("nothing on the list changed means no commit", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    Bun.spawnSync(["git", "add", "-A"], { cwd: ws });
    Bun.spawnSync(["git", "commit", "-q", "-m", "seed"], { cwd: ws });
    const before = sh(["git", "log", "-1", "--format=%H"]);
    const r = await saveRun(["alden/alden-portal/features/tasks/ledger.json"], "save: nothing", { cwd: ws });
    expect(r).toMatchObject({ committed: false, files: 0 });
    expect(sh(["git", "log", "-1", "--format=%H"])).toBe(before);
  });

  test("run inside Pensieve's container commits nothing, and the write stays uncommitted on disk", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    process.env.PENSIEVE_RUNNER = "container";
    try {
      const r = await saveRun(["alden/alden-portal/features/tasks/ledger.json"], "save: container", { cwd: ws });
      expect(r).toMatchObject({ committed: false });
    } finally {
      delete process.env.PENSIEVE_RUNNER;
    }
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("tasks/ledger.json");
  });

  test("a held index.lock is retried until it clears", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, ".git/index.lock"), "");
    const p = saveRun(["alden/alden-portal/features/tasks/ledger.json"], "save: locked", { cwd: ws });
    await new Promise((r) => setTimeout(r, 250));
    rmSync(join(ws, ".git/index.lock"));
    const r = await p;
    expect(r).toMatchObject({ committed: true, files: 1 });
  });
});
