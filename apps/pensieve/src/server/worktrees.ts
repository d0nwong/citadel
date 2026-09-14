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
