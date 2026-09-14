import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  branchOf,
  commitAll,
  ensureWorktrees,
  fastForwardMain,
  hasWorktrees,
  removeWorktrees,
  worktreePaths,
} from "./worktrees";

const scratch = (prefix: string) => mkdtemp(join(tmpdir(), prefix));

async function initRepo(prefix: string): Promise<string> {
  const dir = await scratch(prefix);
  execFileSync("git", ["init", "--quiet", "-b", "main", dir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

async function commitFile(
  dir: string,
  name: string,
  content: string,
  message: string
): Promise<void> {
  await mkdir(join(dir, join(name, "..")), { recursive: true });
  await writeFile(join(dir, name), content);
  execFileSync("git", ["add", name], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: dir });
}

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

/** citadel: an "origin" bare repo plus a clone tracking it, both with one commit on main. */
async function makeCitadelRepo(): Promise<{ dir: string; origin: string }> {
  const origin = await scratch("worktrees-citadel-origin-");
  execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
  const dir = await initRepo("worktrees-citadel-");
  await commitFile(dir, "README.md", "citadel\n", "init");
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: dir });
  execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: dir });
  return { dir, origin };
}

/** citadel-data: a plain repo with one commit on main — no remote, since it is never pushed to. */
async function makeCitadelDataRepo(): Promise<string> {
  const dir = await initRepo("worktrees-citadel-data-");
  await commitFile(dir, "ledger.json", "{}\n", "init");
  return dir;
}

describe("worktreePaths / branchOf — pure path shapes", () => {
  test("<worktreesDir>/<threadId>/{citadel,citadel-data}, and ask/<id>", () => {
    expect(worktreePaths("/w", "abc")).toEqual({
      citadel: "/w/abc/citadel",
      citadelData: "/w/abc/citadel-data",
    });
    expect(branchOf("abc")).toBe("ask/abc");
  });
});

describe("CTD-221 AC2 — the first question creates both worktrees on ask/<id>", () => {
  test("citadel is cut from origin/main after a fetch; citadel-data from local main; both on the same branch", async () => {
    const { dir: citadelDir } = await makeCitadelRepo();
    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const paths = worktreePaths(worktreesDir, "conv-1");

    expect(await hasWorktrees(paths)).toBe(false);

    const result = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-1",
      worktreesDir,
    });

    expect(result).toEqual({ ...paths, conflict: [] });
    expect(await hasWorktrees(paths)).toBe(true);
    expect(git(paths.citadel, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "ask/conv-1"
    );
    expect(git(paths.citadelData, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "ask/conv-1"
    );
    expect(await readFile(join(paths.citadel, "README.md"), "utf8")).toContain(
      "citadel"
    );
    expect(await readFile(join(paths.citadelData, "ledger.json"), "utf8")).toBe(
      "{}\n"
    );

    // The live checkouts are untouched: the worktree is a separate directory.
    expect(git(citadelDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(citadelDataDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "main"
    );
  });

  test("a code change pushed to citadel's origin/main before the first question is what the worktree gets — no image rebuild in the way", async () => {
    const { dir: citadelDir, origin } = await makeCitadelRepo();
    // A second clone stands in for "a PR merged to origin/main" — the first clone's own
    // `main` never moves, so this proves the worktree reads `origin/main`, not the local one.
    const other = await scratch("worktrees-citadel-other-");
    execFileSync("git", ["clone", "--quiet", origin, other]);
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: other,
    });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: other });
    await commitFile(other, "SKILL.md", "a new skill\n", "add skill");
    execFileSync("git", ["push", "--quiet", "origin", "main"], {
      cwd: other,
    });

    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const result = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-2",
      worktreesDir,
    });

    expect(await readFile(join(result.citadel, "SKILL.md"), "utf8")).toBe(
      "a new skill\n"
    );
  });
});

describe("CTD-221 AC3 / AC4 — a later question rebases citadel-data onto main; worktrees are reused", () => {
  test("a ledger committed to citadel-data's main since the last question is what the worktree has after ensureWorktrees runs again", async () => {
    const { dir: citadelDir } = await makeCitadelRepo();
    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const first = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-3",
      worktreesDir,
    });
    expect(first.conflict).toEqual([]);

    // The sweep commits straight to citadel-data's main between questions.
    await commitFile(
      citadelDataDir,
      "state/unplaced.json",
      "[]\n",
      "sweep tick"
    );

    const second = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-3",
      worktreesDir,
    });
    expect(second).toEqual({
      ...worktreePaths(worktreesDir, "conv-3"),
      conflict: [],
    });
    expect(
      await readFile(join(second.citadelData, "state/unplaced.json"), "utf8")
    ).toBe("[]\n");

    // No second citadel fetch/worktree add: it is the same worktree, on the same branch.
    expect(git(first.citadel, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "ask/conv-3"
    );
  });

  test("a conflicting rebase leaves the file named, mid-rebase, for the run to resolve", async () => {
    const { dir: citadelDir } = await makeCitadelRepo();
    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const first = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-4",
      worktreesDir,
    });

    // The worktree's own branch changes ledger.json …
    await commitFile(
      first.citadelData,
      "ledger.json",
      '{"from":"worktree"}\n',
      "worktree edit"
    );
    // … and main moves the same line a different way, so the rebase collides.
    await commitFile(
      citadelDataDir,
      "ledger.json",
      '{"from":"main"}\n',
      "main edit"
    );

    const second = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "conv-4",
      worktreesDir,
    });
    expect(second.conflict).toEqual(["ledger.json"]);
    // The rebase is left in progress — the run finishes it, this call never force-resolves it.
    expect(git(second.citadelData, "status", "--porcelain=v1")).toContain(
      "ledger.json"
    );
  });
});

describe("CTD-222 — the git steps behind Finish", () => {
  test("commitAll stages and commits everything, tracked or not; a no-op once there is nothing left", async () => {
    const dir = await makeCitadelDataRepo();
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "nested/new.json"), "{}\n");
    await commitAll(dir, "ask finish");
    expect(git(dir, "log", "-1", "--format=%s")).toBe("ask finish");
    expect(git(dir, "status", "--porcelain")).toBe("");

    const sha = git(dir, "rev-parse", "HEAD");
    await commitAll(dir, "nothing to commit here");
    expect(git(dir, "rev-parse", "HEAD")).toBe(sha);
  });

  test("fastForwardMain lands the branch on live main when it is a fast-forward", async () => {
    const live = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const { citadelData } = worktreePaths(worktreesDir, "ff-1");
    execFileSync(
      "git",
      ["worktree", "add", "-b", "ask/ff-1", citadelData, "main"],
      { cwd: live }
    );
    await commitFile(citadelData, "a.json", "{}\n", "worktree commit");

    expect(await fastForwardMain(live, "ask/ff-1")).toBe(true);
    expect(git(live, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(live, "show", "main:a.json")).toBe("{}");
  });

  test("fastForwardMain refuses, without merging, when live main has moved past the branch's base (S-49)", async () => {
    const live = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const { citadelData } = worktreePaths(worktreesDir, "ff-2");
    execFileSync(
      "git",
      ["worktree", "add", "-b", "ask/ff-2", citadelData, "main"],
      { cwd: live }
    );
    // Live main moves ahead of the branch's base after the worktree was cut …
    await commitFile(live, "sweep.json", "{}\n", "sweep tick");
    // … which is what makes the branch's own commit no longer a fast-forward of it.
    await commitFile(citadelData, "a.json", "{}\n", "worktree commit");

    expect(await fastForwardMain(live, "ask/ff-2")).toBe(false);
    expect(git(live, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(live, "log", "-1", "--format=%s")).toBe("sweep tick");
  });

  test("removeWorktrees removes both worktrees and deletes ask/<id> from both live checkouts", async () => {
    const { dir: citadelDir } = await makeCitadelRepo();
    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const paths = worktreePaths(worktreesDir, "rm-1");
    await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "rm-1",
      worktreesDir,
    });

    await removeWorktrees(paths, {
      citadelDataDir,
      citadelDir,
      threadId: "rm-1",
    });

    expect(await hasWorktrees(paths)).toBe(false);
    expect(git(citadelDir, "branch", "--list", "ask/rm-1")).toBe("");
    expect(git(citadelDataDir, "branch", "--list", "ask/rm-1")).toBe("");
  });

  test("removeWorktrees discards the citadel worktree's uncommitted changes rather than refusing", async () => {
    const { dir: citadelDir } = await makeCitadelRepo();
    const citadelDataDir = await makeCitadelDataRepo();
    const worktreesDir = await scratch("worktrees-root-");
    const paths = worktreePaths(worktreesDir, "rm-2");
    const result = await ensureWorktrees({
      citadelDataDir,
      citadelDir,
      threadId: "rm-2",
      worktreesDir,
    });
    await writeFile(join(result.citadel, "SCRATCH.md"), "uncommitted\n");

    await removeWorktrees(paths, {
      citadelDataDir,
      citadelDir,
      threadId: "rm-2",
    });

    expect(await hasWorktrees(paths)).toBe(false);
  });
});
