import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMITTABLE, commitRun, commitWrites, endTick, inTick, noteWritten, origin, promoteCursor, resetWritten, saveRun, startTick, sweepAuthor, writtenPaths } from "./commit.ts";

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
  test("commits ledgers and state, and is a no-op when clean", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "state/threads.json"), "{}\n");
    writeFileSync(join(ws, "state/batches-are-not-committed.txt"), "x");
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    const r = await commitRun("sweep: test", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 2 });
    expect(sh(["git", "log", "-1", "--format=%s"])).toBe("sweep: test");
    expect(sh(["git", "show", "--stat", "--format=", "HEAD"])).not.toContain("batches-are-not-committed");
    const again = await commitRun("sweep: nothing", { cwd: ws });
    expect(again).toMatchObject({ committed: false, files: 0 });
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
  test("dry run stages nothing for keeps", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    const r = await commitRun("x", { cwd: ws, dryRun: true });
    expect(r).toMatchObject({ committed: false, files: 1 });
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("tasks/ledger.json");
  });
  test("an author commits under that identity, not git's own configured one", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    const r = await commitRun("sweep: authored", { cwd: ws, author: { name: "argus sweep", email: "sweep@citadel.local" } });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "log", "-1", "--format=%an <%ae>"])).toBe("argus sweep <sweep@citadel.local>");
  });
});

describe("promoteCursor", () => {
  test("promotes cursor.next.json to cursor.json, is unchanged once there, and none with neither", async () => {
    expect(await promoteCursor()).toBe("none");
    writeFileSync(join(ws, "state/cursor.next.json"), '{"last_ts":"1"}\n');
    expect(await promoteCursor()).toBe("promoted");
    expect(await Bun.file(join(ws, "state/cursor.json")).exists()).toBe(true);
    expect(await Bun.file(join(ws, "state/cursor.next.json")).exists()).toBe(false);
    expect(await promoteCursor()).toBe("unchanged");
  });
  test("a dry run reports what would happen and leaves the files alone", async () => {
    writeFileSync(join(ws, "state/cursor.next.json"), "{}\n");
    expect(await promoteCursor({ dryRun: true })).toBe("promoted");
    expect(await Bun.file(join(ws, "state/cursor.next.json")).exists()).toBe(true);
  });
});

describe("inTick and sweepAuthor", () => {
  const saved = process.env.ARGUS_SWEEP_TICK;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARGUS_SWEEP_TICK;
    else process.env.ARGUS_SWEEP_TICK = saved;
    delete process.env.SWEEP_GIT_NAME;
    delete process.env.SWEEP_GIT_EMAIL;
  });
  test("inTick reads the marker loop.sh exports around a claude run", async () => {
    delete process.env.ARGUS_SWEEP_TICK;
    expect(await inTick(ws)).toBe(false);
    process.env.ARGUS_SWEEP_TICK = "1";
    expect(await inTick(ws)).toBe(true);
  });
  test("sweepAuthor defaults to argus sweep, overridden by SWEEP_GIT_NAME/SWEEP_GIT_EMAIL", () => {
    expect(sweepAuthor()).toEqual({ name: "argus sweep", email: "sweep@citadel.local" });
    process.env.SWEEP_GIT_NAME = "Custom Sweep";
    process.env.SWEEP_GIT_EMAIL = "custom@sweep.local";
    expect(sweepAuthor()).toEqual({ name: "Custom Sweep", email: "custom@sweep.local" });
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

  // projects.json (CTD-265) is hand-written; a person commits it with git, never argus, the sweep or Pensieve (ledger S-26)
  test("projects.json is never committable", () => {
    expect(COMMITTABLE.test("projects.json")).toBe(false);
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

describe("noteWritten / writtenPaths / resetWritten", () => {
  afterEach(() => resetWritten());
  test("collects root-relative paths, de-duplicated, until reset", () => {
    resetWritten();
    expect(writtenPaths()).toEqual([]);
    noteWritten(join(ws, "alden/alden-portal/features/tasks/ledger.json"));
    noteWritten(join(ws, "state/threads.json"));
    noteWritten(join(ws, "alden/alden-portal/features/tasks/ledger.json"));
    expect(writtenPaths().sort()).toEqual(["alden/alden-portal/features/tasks/ledger.json", "state/threads.json"]);
    resetWritten();
    expect(writtenPaths()).toEqual([]);
  });
});

describe("origin", () => {
  const saved = process.env.ARGUS_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.ARGUS_ORIGIN;
    else process.env.ARGUS_ORIGIN = saved;
  });
  test("null unset or blank, else the trimmed value a Pensieve conversation set", () => {
    delete process.env.ARGUS_ORIGIN;
    expect(origin()).toBeNull();
    process.env.ARGUS_ORIGIN = "  ";
    expect(origin()).toBeNull();
    process.env.ARGUS_ORIGIN = " ask/de9c8a51 ";
    expect(origin()).toBe("ask/de9c8a51");
  });
});

describe("commitWrites", () => {
  // the sandbox itself exports GIT_AUTHOR_*, which would mask author assertions below
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

  test("commits exactly what git finds changed under the reported roots, as the person running it", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    writeFileSync(join(ws, "README.md"), "unrelated\n");
    const r = await commitWrites(["alden/alden-portal/features/tasks/ledger.json"], "argus confirm tasks: ", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    // git strips a commit message's trailing whitespace
    expect(sh(["git", "log", "-1", "--format=%s"])).toBe("argus confirm tasks:");
    expect(sh(["git", "log", "-1", "--format=%an <%ae>"])).toBe("The Person <person@t>");
    const stat = sh(["git", "show", "--stat", "--format=", "HEAD"]);
    expect(stat).toContain("tasks/ledger.json");
    expect(stat).not.toContain("README.md");
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("README.md");
  });

  test("a directory root discovers every tracked file a rename carried, not just the one named", async () => {
    mkdirSync(join(ws, "revisions/reignite/specs/foundry"), { recursive: true });
    writeFileSync(join(ws, "revisions/reignite/revision.json"), '{"status":"draft"}\n');
    writeFileSync(join(ws, "revisions/reignite/intent.md"), "# intent\n");
    writeFileSync(join(ws, "revisions/reignite/specs/foundry/jobs.md"), "# spec\n");
    Bun.spawnSync(["git", "add", "-A"], { cwd: ws });
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: ws });
    // a plain filesystem rename, as `node:fs/promises`' `rename()` does in revision.ts — not `git mv`, which would pre-stage it
    renameSync(join(ws, "revisions/reignite"), join(ws, "revisions/CTD-900"));
    const r = await commitWrites(["revisions/reignite", "revisions/CTD-900"], "argus revision file: ", { cwd: ws });
    // git sees an unstaged rename as a deletion at the old path plus an addition at the new one, per file: 3 files, 6 changed paths
    expect(r).toMatchObject({ committed: true, files: 6 });
    const stat = sh(["git", "show", "--stat", "--format=", "HEAD"]);
    expect(stat).toContain("revision.json");
    expect(stat).toContain("intent.md");
    expect(stat).toContain("jobs.md");
    expect(sh(["git", "status", "--porcelain"])).toBe("");
  });

  test("no roots, nothing changed under them, a dry run, or inside Pensieve's container all commit nothing", async () => {
    expect(await commitWrites([], "x", { cwd: ws })).toEqual({ committed: false, files: 0 });
    expect(await commitWrites(["nowhere.json"], "x", { cwd: ws })).toEqual({ committed: false, files: 0 });
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    expect(await commitWrites(["alden/alden-portal/features/tasks/ledger.json"], "x", { cwd: ws, dryRun: true })).toMatchObject({ committed: false, files: 1 });
    process.env.PENSIEVE_RUNNER = "container";
    try {
      expect(await commitWrites(["alden/alden-portal/features/tasks/ledger.json"], "x", { cwd: ws })).toMatchObject({ committed: false, files: 1 });
    } finally {
      delete process.env.PENSIEVE_RUNNER;
    }
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("tasks/ledger.json");
  });
});

describe("startTick and endTick (CTD-261)", () => {
  afterEach(() => {
    delete process.env.ARGUS_SWEEP_TICK;
    delete process.env.SWEEP_INTERVAL;
  });

  test("a file dirty before the tick starts stays dirty after it, even when the tick writes to it too (AC1, sweep S-11)", async () => {
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    Bun.spawnSync(["git", "add", "-A"], { cwd: ws });
    Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "seed"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    // someone else's uncommitted edit, made before the tick starts
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), '{"hand":true}\n');

    process.env.ARGUS_SWEEP_TICK = "1";
    expect(await startTick({ cwd: ws })).toMatchObject({ recorded: true, carriedOver: false });

    // the tick edits the very same file, and writes one of its own
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), '{"hand":true,"sweep":true}\n');
    writeFileSync(join(ws, "state/threads.json"), "{}\n");

    const r = await commitRun("sweep: test", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    const stat = sh(["git", "show", "--stat", "--format=", "HEAD"]);
    expect(stat).toContain("threads.json");
    expect(stat).not.toContain("tasks/ledger.json");
    expect(sh(["git", "status", "--porcelain", "--untracked-files=all"])).toContain("tasks/ledger.json");
  });

  test("a tick killed before argus commit has its files committed by the next tick (AC2, sweep S-12)", async () => {
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    process.env.ARGUS_SWEEP_TICK = "1";

    expect(await startTick({ cwd: ws })).toMatchObject({ recorded: true, carriedOver: false });
    // the tick's own work, then it dies before ever reaching `argus commit`
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");

    // the next tick starts: the dead tick's record is still there, so it is left alone
    expect(await startTick({ cwd: ws })).toMatchObject({ recorded: false, carriedOver: true });

    const r = await commitRun("sweep: recovered", { cwd: ws });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "show", "--stat", "--format=", "HEAD"])).toContain("tasks/ledger.json");
  });

  test('a tick marked by the file, not the env var, commits once as "argus sweep" and clears itself (AC3, sweep S-13)', async () => {
    Bun.spawnSync(["git", "config", "user.email", "t@t"], { cwd: ws });
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: ws });
    delete process.env.ARGUS_SWEEP_TICK;

    const start = await startTick({ cwd: ws });
    expect(start.marked).toBe(true);
    expect(await inTick(ws)).toBe(true);

    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), "{}\n");
    const r = await commitRun("sweep: terminal", { cwd: ws, author: sweepAuthor() });
    expect(r).toMatchObject({ committed: true, files: 1 });
    expect(sh(["git", "log", "-1", "--format=%an <%ae>"])).toBe("argus sweep <sweep@citadel.local>");

    // nothing left to commit — the tick's one commit already happened
    expect(await commitRun("sweep: terminal again", { cwd: ws, author: sweepAuthor() })).toMatchObject({ committed: false, files: 0 });

    await endTick({ cwd: ws });
    expect(await inTick(ws)).toBe(false);
  });

  test("after a quiet tick ends, the marker is gone: it does not mark a later verb as a tick forever", async () => {
    delete process.env.ARGUS_SWEEP_TICK;
    await startTick({ cwd: ws });
    expect(await inTick(ws)).toBe(true);
    await endTick({ cwd: ws }); // nothing to commit, but the tick still ends
    expect(await inTick(ws)).toBe(false);
  });

  test("a stale marker counts as gone, so a killed terminal /sweep does not silence every later verb", async () => {
    delete process.env.ARGUS_SWEEP_TICK;
    process.env.SWEEP_INTERVAL = "1";
    await startTick({ cwd: ws });
    expect(await inTick(ws)).toBe(true);
    await new Promise((r) => setTimeout(r, 2100));
    expect(await inTick(ws)).toBe(false);
  });

  test("a dry run records nothing on disk", async () => {
    delete process.env.ARGUS_SWEEP_TICK;
    const r = await startTick({ cwd: ws, dryRun: true });
    expect(r).toMatchObject({ recorded: true, marked: true });
    expect(await Bun.file(join(ws, ".git/sweep-tick-start.json")).exists()).toBe(false);
    expect(await Bun.file(join(ws, ".git/sweep-tick-marker")).exists()).toBe(false);
  });
});
