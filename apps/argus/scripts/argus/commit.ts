/**
 * `argus commit`: the run's one lasting side effect. Stages every ledger, the committed
 * state files (threads, unplaced, deploys) and the arch docs, commits when anything is
 * staged, and only then promotes the Slack cursor, so a run that dies before its commit
 * replays the channel rather than skipping it. Never pushes.
 */

import { rename, stat } from "node:fs/promises";
import { cursorNextPath, cursorPath, root } from "./paths.ts";

const exists = (p: string) => stat(p).then(() => true, () => false);

async function git(args: string[], cwd = root()): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  // trimEnd only: a porcelain status line starts with a space for a file modified in the tree
  return { code: await p.exited, out: out.trimEnd(), err: err.trim() };
}

/** what a run may commit: ledgers, arch docs, the committed state files, the manifest */
export const COMMITTABLE = /(^|\/)features\/.*\/(ledger\.json|docs\/arch\.md)$|^state\/(threads|unplaced|deploys)\.json$|\/\.doc-workspace\/feature-manifest\.json$/;

/** changed paths (modified, added, deleted) the run may commit, from git's own view */
async function changed(cwd: string): Promise<string[]> {
  const st = await git(["status", "--porcelain", "--untracked-files=all"], cwd);
  return st.out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .filter((p) => COMMITTABLE.test(p));
}

export type CommitResult = { committed: boolean; sha?: string; files: number; cursor: "promoted" | "unchanged" | "none" };

export async function commitRun(message: string, opts: { dryRun?: boolean; cwd?: string } = {}): Promise<CommitResult> {
  const cwd = opts.cwd ?? root();
  const files = await changed(cwd);
  if (files.length) {
    const add = await git(["add", "-A", "--", ...files], cwd);
    if (add.code !== 0) throw new Error(`git add: ${add.err}`);
  }
  const staged = (await git(["diff", "--cached", "--name-only"], cwd)).out.split("\n").map((l) => l.trim()).filter(Boolean);
  let sha: string | undefined;
  if (staged.length && !opts.dryRun) {
    const c = await git(["commit", "-q", "-m", message], cwd);
    if (c.code !== 0) throw new Error(`git commit: ${c.err}`);
    sha = (await git(["rev-parse", "--short", "HEAD"], cwd)).out.trim();
  }
  let cursor: CommitResult["cursor"] = "none";
  if (await exists(cursorNextPath())) {
    if (!opts.dryRun) await rename(cursorNextPath(), cursorPath());
    cursor = "promoted";
  } else if (await exists(cursorPath())) cursor = "unchanged";
  return { committed: !!sha, sha, files: staged.length, cursor };
}
