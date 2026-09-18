/**
 * Node-only. The git plumbing behind local-mode Ask worktrees (CTD-221) and Finish (CTD-222):
 * a conversation's first question cuts one `ask/<id>` branch in two worktrees — `citadel` from
 * citadel's `origin/main` after a fetch, `citadel-data` from citadel-data's own local `main`
 * (the sweep commits there and never pushes, so no fetch is needed) — under
 * `PENSIEVE_HOME/worktrees/<id>/`. Every later question rebases the citadel-data branch onto
 * main, so a ledger the sweep committed since the last question is what the run reads; a
 * conflict is left in the worktree, named, for the run itself to resolve (`ask.ts`'s
 * `conflictPrompt`). `ask.ts` calls `ensureWorktrees` and stays the run; every `git` call
 * lives here.
 *
 * Finish (`ask.ts`'s `finishConversation`) reuses `rebaseOntoMain` and adds the rest of its own
 * git steps: `commitAll` (everything in the citadel-data worktree, committed or not, S-41),
 * `fastForwardMain` (the live checkout's main onto the branch, refusing rather than merging
 * when it raced ahead, S-49), and `removeWorktrees` (both worktrees and both local branches
 * once the data has landed, S-48).
 *
 * CTD-248: `LOCAL_ADAPTER_CONFIG`'s `settingSources` (`ask.ts`) is project settings only, in
 * both modes, so this module writes nothing into the citadel worktree to steer it — a fresh
 * one is exactly the checkout at `origin/main`, `git status` included.
 *
 * CTD-247 (S-52): `createWorktrees` ends the citadel half by `chmod -R a-w`ing the whole tree,
 * once the `worktree add` that creates it is down — so from before the session ever runs, an
 * edit, a redirect or a `git commit` into the citadel worktree fails on disk, not on a sentence
 * in the prompt. Removing that worktree needs write permission back, since `git worktree
 * remove` deletes files through the directory and a read-only directory refuses it;
 * `removeWorktrees` restores it with `chmod -R u+w` immediately before that call. citadel-data
 * is never touched — it stays writable by design.
 */

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(
      `git -C ${cwd} ${args.join(" ")}: ${(err.stderr || err.message).trim()}`,
      { cause: e }
    );
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `chmod -R <mode> <dir>` through `execFile` — one spawn rather than a walk, since Node's
 * `fs.chmod` is per-path (S-52). `mode` is a raw `chmod` symbolic mode (`"a-w"`, `"u+w"`).
 */
async function chmodTree(mode: string, dir: string): Promise<void> {
  try {
    await exec("chmod", ["-R", mode, dir]);
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(
      `chmod -R ${mode} ${dir}: ${(err.stderr || err.message).trim()}`,
      { cause: e }
    );
  }
}

export interface WorktreePaths {
  citadel: string;
  citadelData: string;
}

/** `<worktreesDir>/<threadId>/{citadel,citadel-data}` — pure, no disk access. */
export function worktreePaths(
  worktreesDir: string,
  threadId: string
): WorktreePaths {
  const dir = join(worktreesDir, threadId);
  return {
    citadel: join(dir, "citadel"),
    citadelData: join(dir, "citadel-data"),
  };
}

/** The one branch both of a conversation's worktrees are cut on. */
export const branchOf = (threadId: string) => `ask/${threadId}`;

/** Has this conversation's worktrees already been created — a later question, not the first. */
export const hasWorktrees = (paths: WorktreePaths): Promise<boolean> =>
  exists(paths.citadel);

async function createWorktrees(
  paths: WorktreePaths,
  opts: { citadelDataDir: string; citadelDir: string; threadId: string }
): Promise<void> {
  const branch = branchOf(opts.threadId);
  await git(opts.citadelDir, ["fetch", "origin"]);
  await git(opts.citadelDir, [
    "worktree",
    "add",
    "-b",
    branch,
    paths.citadel,
    "origin/main",
  ]);
  // Last step for the citadel tree (S-52): everything above writes into it, nothing below does.
  await chmodTree("a-w", paths.citadel);
  await git(opts.citadelDataDir, [
    "worktree",
    "add",
    "-b",
    branch,
    paths.citadelData,
    "main",
  ]);
}

/** The files a `git rebase` left mid-conflict; `[]` once it is clean. */
async function conflictedFiles(worktree: string): Promise<string[]> {
  const out = await git(worktree, ["diff", "--name-only", "--diff-filter=U"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface RebaseResult {
  /** Files left mid-conflict — the run resolves these before it answers (S-37). */
  conflict: string[];
}

/** Rebase the citadel-data worktree's branch onto its (local) main; a conflict is left for the run to resolve. */
export async function rebaseOntoMain(worktree: string): Promise<RebaseResult> {
  try {
    await git(worktree, ["rebase", "main"]);
    return { conflict: [] };
  } catch (e) {
    const conflict = await conflictedFiles(worktree);
    if (conflict.length === 0) {
      throw e;
    }
    return { conflict };
  }
}

export interface EnsureWorktreesResult extends WorktreePaths {
  /** Files this call's rebase left mid-conflict — empty on a first question or a clean rebase. */
  conflict: string[];
}

async function countLines(cwd: string, args: string[]): Promise<number> {
  const out = await git(cwd, args);
  return out.split("\n").filter((l) => l.trim()).length;
}

async function countCommits(cwd: string, range: string): Promise<number> {
  const out = await git(cwd, ["rev-list", "--count", range]);
  return Number.parseInt(out.trim(), 10);
}

export interface WorktreeDiscardCounts {
  /** The citadel worktree — commits and a push are what Finish/PR would have kept (S-43, S-44). */
  citadel: { uncommitted: number; unpushed: number };
  /** The citadel-data worktree — landed on main only by Finish, not yet built (S-44). */
  citadelData: { uncommitted: number; unmerged: number };
}

/**
 * What Delete (and, later, Finish) discards in a conversation's worktrees (S-43, S-44):
 * `unpushed` counts commits ahead of `origin/main` rather than `@{u}`, so it does not depend
 * on `branch.autoSetupMerge`; `unmerged` counts citadel-data's branch ahead of its own local
 * `main`, which the sweep commits to and the worktree's branch never pushes.
 */
export async function discardCounts(
  paths: WorktreePaths
): Promise<WorktreeDiscardCounts> {
  const [citadelUncommitted, citadelUnpushed, dataUncommitted, dataUnmerged] =
    await Promise.all([
      countLines(paths.citadel, ["status", "--porcelain"]),
      countCommits(paths.citadel, "origin/main..HEAD"),
      countLines(paths.citadelData, ["status", "--porcelain"]),
      countCommits(paths.citadelData, "main..HEAD"),
    ]);
  return {
    citadel: { uncommitted: citadelUncommitted, unpushed: citadelUnpushed },
    citadelData: { uncommitted: dataUncommitted, unmerged: dataUnmerged },
  };
}

/**
 * The worktree step between `acquireThread` and `runSetup` (S-33, S-36): the first question on
 * a thread creates both worktrees on branch `ask/<id>`; every later one rebases the
 * citadel-data branch onto main and hands back any files left conflicted, for the run to
 * resolve before it answers. Idempotent per thread — whichever worktree exists on disk decides
 * which path runs, so a Pensieve restart resumes in the same worktrees (S-45).
 */
export async function ensureWorktrees(opts: {
  citadelDataDir: string;
  citadelDir: string;
  threadId: string;
  worktreesDir: string;
}): Promise<EnsureWorktreesResult> {
  const paths = worktreePaths(opts.worktreesDir, opts.threadId);
  if (await hasWorktrees(paths)) {
    const { conflict } = await rebaseOntoMain(paths.citadelData);
    return { ...paths, conflict };
  }
  await createWorktrees(paths, opts);
  return { ...paths, conflict: [] };
}

/**
 * `git add -A` and commit everything in the worktree — tracked or not, staged or not (S-41).
 * A no-op when there is nothing to commit, so a Finish on a conversation that never wrote
 * anything still goes on to rebase and fast-forward.
 */
export async function commitAll(
  worktree: string,
  message: string
): Promise<void> {
  await git(worktree, ["add", "-A"]);
  const staged = await git(worktree, ["diff", "--cached", "--name-only"]);
  if (!staged.trim()) {
    return;
  }
  await git(worktree, ["commit", "--quiet", "-m", message]);
}

const NOT_FAST_FORWARD = /not possible to fast-forward/i;

/**
 * Fast-forward the live checkout's main onto the conversation's branch. `false` means the
 * merge refused because live main moved past the worktree's rebase since it ran (S-49) — the
 * caller rebases the worktree again and retries, rather than merging or failing.
 */
export async function fastForwardMain(
  liveDir: string,
  branch: string
): Promise<boolean> {
  try {
    await git(liveDir, ["merge", "--ff-only", branch]);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (NOT_FAST_FORWARD.test(message)) {
      return false;
    }
    throw e;
  }
}

/**
 * Remove both of a conversation's worktrees and delete `ask/<id>` from both live checkouts
 * (S-48) — the last step of Finish, once citadel-data has landed on main, and Delete's other
 * half (S-44, CTD-223), discarding whatever `discardCounts` counted. `--force` discards
 * whatever the citadel worktree's code changes leave behind (uncommitted or mid-conflict-
 * rebase); `-D` because that branch, even when pushed, was never merged into the *local*
 * checkout. A pushed citadel branch and its PR live on the remote and are untouched by removing
 * the local ref. Restoring write permission on the citadel tree (S-52) has to happen first: it
 * was created read-only, and `git worktree remove` deletes files through the directory, which a
 * read-only directory refuses. A no-op when the conversation never got worktrees, so a
 * container-mode or fresh thread costs nothing.
 */
export async function removeWorktrees(
  paths: WorktreePaths,
  opts: { citadelDataDir: string; citadelDir: string; threadId: string }
): Promise<void> {
  if (!(await hasWorktrees(paths))) {
    return;
  }
  const branch = branchOf(opts.threadId);
  await chmodTree("u+w", paths.citadel);
  await git(opts.citadelDir, ["worktree", "remove", "--force", paths.citadel]);
  await git(opts.citadelDir, ["branch", "-D", branch]);
  await git(opts.citadelDataDir, [
    "worktree",
    "remove",
    "--force",
    paths.citadelData,
  ]);
  await git(opts.citadelDataDir, ["branch", "-D", branch]);
}
