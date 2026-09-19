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
 * git steps: `commitAll` (the worktree's changed files, committed or not, landed through
 * `argus save` so only the record's files land, S-58; a path `save` refuses is dropped and
 * left uncommitted, for `removeWorktrees` to discard), `fastForwardMain` (the live checkout's
 * main onto the branch, refusing rather than merging when it raced ahead, S-49), and
 * `removeWorktrees` (both worktrees and both local branches once the data has landed, S-48).
 * `branchFiles` and `offListFiles` are `finishConversation`'s guard: a file the branch's own
 * commits already carry, outside the record, would ride along on the fast-forward, so Finish
 * checks for one and refuses before touching anything (S-58).
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
import { argus } from "./argus";

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

async function countCommits(cwd: string, range: string): Promise<number> {
  const out = await git(cwd, ["rev-list", "--count", range]);
  return Number.parseInt(out.trim(), 10);
}

export interface WorktreeDiscardCounts {
  /** The citadel-data worktree — landed on main only by Finish, not yet built (S-43, S-44). */
  citadelData: {
    uncommitted: number;
    unmerged: number;
    /** Uncommitted files outside the record (`argus save --dry-run`) — Finish drops these rather than landing them (S-61). */
    offListUncommitted: string[];
    /** Files the branch's own commits already carry outside the record — these stop Finish rather than fast-forwarding (S-58, S-61). */
    offListCommitted: string[];
  };
}

/**
 * What Finish and Delete discard in a conversation's citadel-data worktree (S-44, S-61) — the
 * citadel worktree is read-only (S-52) and the session never commits there, so its own counts
 * are always zero and are not tracked. `unmerged` counts citadel-data's branch ahead of its own
 * local `main`, which the sweep commits to and the worktree's branch never pushes. The off-list
 * paths are classified by the same `argus save --dry-run` Finish itself runs (`commitAll`,
 * `finishConversation`'s own `branchFiles`/`offListFiles` check), not a second regex.
 */
export async function discardCounts(
  paths: WorktreePaths,
  opts: RecordCommitOptions
): Promise<WorktreeDiscardCounts> {
  const [uncommittedPaths, dataUnmerged, branchPaths] = await Promise.all([
    statusPaths(paths.citadelData),
    countCommits(paths.citadelData, "main..HEAD"),
    branchFiles(paths.citadelData),
  ]);
  const [offListUncommitted, offListCommitted] = await Promise.all([
    offListFiles(paths.citadelData, uncommittedPaths, opts),
    offListFiles(paths.citadelData, branchPaths, opts),
  ]);
  return {
    citadelData: {
      offListCommitted,
      offListUncommitted,
      uncommitted: uncommittedPaths.length,
      unmerged: dataUnmerged,
    },
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

/** Every path git sees as changed in the worktree — tracked or not, staged or not. */
async function statusPaths(worktree: string): Promise<string[]> {
  const out = await git(worktree, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""));
}

const REFUSED_RE = /^not part of the record, refused: (.+)$/;

/** The paths named in `argus save`'s refusal, or `[]` for any other error. */
function refusedPaths(error: string | undefined): string[] {
  const m = error?.match(REFUSED_RE);
  return m?.[1] ? m[1].split(", ") : [];
}

export interface RecordCommitOptions {
  /** argus's code, where `scripts/argus.ts` is (`ARGUS_DIR` in Pensieve's own process). */
  argusDir: string;
  /** the conversation's own origin (`ask/<id>`), passed through as `ARGUS_ORIGIN`. */
  origin?: string;
}

/**
 * Environment for an `argus()` call Finish makes: `ARGUS_ORIGIN` when the caller names one,
 * and `PENSIEVE_RUNNER` cleared — this call is always local mode's own git plumbing, on the
 * host, whatever the server process's own `PENSIEVE_RUNNER` happens to be (a container-mode
 * Pensieve never calls it: S-58 is local mode's Finish), so it must never trip `argus save`'s
 * own "commits nothing inside Pensieve's container" rule (`argus/ledger` S-19).
 */
const recordCommitEnv = (
  origin: string | undefined
): Record<string, string> => ({
  ...(origin ? { ARGUS_ORIGIN: origin } : {}),
  PENSIEVE_RUNNER: "",
});

/**
 * `argus save` over every path the worktree's git status shows changed (`argus/ledger` S-12,
 * S-20) — the record's files land, committed or not; a path `save` refuses is dropped from the
 * list and tried again, left uncommitted on disk for `removeWorktrees` to discard (S-48). A
 * no-op once nothing on the list is left, so a Finish on a conversation that never touched the
 * record still goes on to rebase and fast-forward.
 */
export async function commitAll(
  worktree: string,
  message: string,
  opts: RecordCommitOptions
): Promise<void> {
  let paths = await statusPaths(worktree);
  for (;;) {
    if (paths.length === 0) {
      return;
    }
    const r = await argus("save", [...paths, "-m", message], {
      argusDir: opts.argusDir,
      cwd: worktree,
      env: recordCommitEnv(opts.origin),
    });
    if (r.ok) {
      return;
    }
    const refused = refusedPaths(r.error);
    if (refused.length === 0) {
      throw new Error(r.error ?? "argus save failed");
    }
    paths = paths.filter((p) => !refused.includes(p));
  }
}

/**
 * The files the branch's own commits touch that main does not have yet — `git diff --name-only
 * main...HEAD`, read before this call rebases anything. This is what a fast-forward would carry
 * onto main untouched by `commitAll`'s own list-checking, so `finishConversation` checks it
 * separately (S-58).
 */
export async function branchFiles(worktree: string): Promise<string[]> {
  const out = await git(worktree, ["diff", "--name-only", "main...HEAD"]);
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Which of `paths` a dry-run `argus save` refuses — never argus's own S-12 list duplicated
 * here. `[]` when every path is on the record, or there is nothing to check.
 */
export async function offListFiles(
  worktree: string,
  paths: string[],
  opts: RecordCommitOptions
): Promise<string[]> {
  if (paths.length === 0) {
    return [];
  }
  const r = await argus("save", [...paths, "-m", "check", "--dry-run"], {
    argusDir: opts.argusDir,
    cwd: worktree,
    env: recordCommitEnv(opts.origin),
  });
  return r.ok ? [] : refusedPaths(r.error);
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
 * half (S-44, CTD-223), discarding whatever `discardCounts` counted. `--force` discards what
 * git still calls dirty in each worktree: citadel-data's uncommitted files or a mid-conflict
 * rebase, and the `settings.local.json` this module wrote into citadel, which was never
 * committed there. `-D` because that branch was never merged into the *local* checkout — and,
 * citadel being read-only (S-52), never carried a commit of its own to lose either. Restoring
 * write permission on the citadel tree has to happen first: it was created read-only, and
 * `git worktree remove` deletes files through the directory, which a read-only directory
 * refuses. A no-op when the conversation never got worktrees, so a container-mode or fresh
 * thread costs nothing.
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
