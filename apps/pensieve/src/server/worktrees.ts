/**
 * Node-only. The git plumbing behind local-mode Ask worktrees (CTD-221): a conversation's
 * first question cuts one `ask/<id>` branch in two worktrees — `citadel` from citadel's
 * `origin/main` after a fetch, `citadel-data` from citadel-data's own local `main` (the sweep
 * commits there and never pushes, so no fetch is needed) — under
 * `PENSIEVE_HOME/worktrees/<id>/`. Every later question rebases the citadel-data branch onto
 * main, so a ledger the sweep committed since the last question is what the run reads; a
 * conflict is left in the worktree, named, for the run itself to resolve (`ask.ts`'s
 * `conflictPrompt`). `ask.ts` calls `ensureWorktrees` and stays the run; every `git` call
 * lives here.
 *
 * CTD-226: the first question also writes `apps/argus/.claude/settings.local.json` into the
 * fresh citadel worktree, disabling the gateway MCP servers `apps/argus/.claude/settings.json`
 * (`enabledMcpjsonServers`) approves project-wide — `LOCAL_ADAPTER_CONFIG`'s `settingSources`
 * (`ask.ts`) loads it as the `'local'` source, which wins, so a local run gets the operator's
 * own MCP servers and not argus's gateway ones (S-50). The file sits only in this worktree,
 * never in the live checkout.
 */

import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
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

/**
 * Disables argus's gateway MCP servers for this worktree (S-50): `apps/argus/.claude/settings.json`
 * carries `enabledMcpjsonServers`, which this beats as the `'local'` setting source.
 */
async function writeLocalArgusSettings(citadelWorktree: string): Promise<void> {
  const dir = join(citadelWorktree, "apps/argus/.claude");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "settings.local.json"),
    `${JSON.stringify({ disabledMcpjsonServers: ["linear", "slack"] }, null, 2)}\n`,
    "utf8"
  );
}

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
  await writeLocalArgusSettings(paths.citadel);
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
async function rebaseOntoMain(worktree: string): Promise<RebaseResult> {
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
 * Delete's other half (S-44): removes both worktrees and their shared `ask/<id>` branch,
 * discarding whatever `discardCounts` counted — a no-op when the conversation never got past
 * its first question (no worktrees yet), so a container-mode or fresh thread costs nothing.
 * `--force` removes a worktree that is dirty or mid-conflict-rebase; `branch -D` force-deletes
 * an unmerged branch — both intended here, since Delete discards, it does not save.
 */
export async function removeWorktrees(opts: {
  citadelDataDir: string;
  citadelDir: string;
  threadId: string;
  worktreesDir: string;
}): Promise<void> {
  const paths = worktreePaths(opts.worktreesDir, opts.threadId);
  if (!(await hasWorktrees(paths))) {
    return;
  }
  const branch = branchOf(opts.threadId);
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
