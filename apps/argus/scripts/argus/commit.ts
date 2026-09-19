/**
 * `argus commit`: the run's one lasting side effect. Stages every ledger, the committed
 * state files (threads, unplaced, deploys) and the arch docs, commits when anything is
 * staged, and only then promotes the Slack cursor, so a run that dies before its commit
 * replays the channel rather than skipping it. Never pushes.
 *
 * `commitPaths` is the stage-and-commit primitive both `commitRun` and `saveRun` (`argus
 * save`) sit on: it commits only the paths it is given (`git commit --only`), never
 * whatever else happens to be staged, and retries past a lock another git process is
 * briefly holding.
 */

import { rename, stat } from "node:fs/promises";
import { cursorNextPath, cursorPath, root } from "./paths.ts";

const exists = (p: string) => stat(p).then(() => true, () => false);

async function git(args: string[], cwd = root(), env?: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["git", ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  // trimEnd only: a porcelain status line starts with a space for a file modified in the tree
  return { code: await p.exited, out: out.trimEnd(), err: err.trim() };
}

/** what a run may commit: ledgers, arch docs and specs, the revisions, the committed state files, the manifest */
export const COMMITTABLE = /(^|\/)features\/.*\/(ledger\.json|docs\/arch\.md|docs\/spec\.md)$|^revisions\/|^state\/(threads|unplaced|deploys)\.json$|\/\.doc-workspace\/feature-manifest\.json$/;

/** a product doc a fold removed: committed as a deletion, never as an edit — only a fold touches it */
export const RETIRED = /(^|\/)features\/.*\/docs\/product\.md$/;

/** a path this run may commit, given git's status code for it ("" when it has none) */
const onList = (path: string, code: string) => COMMITTABLE.test(path) || (code.includes("D") && RETIRED.test(path));

/** changed paths (modified, added, deleted) the run may commit, from git's own view */
async function changed(cwd: string): Promise<string[]> {
  const st = await git(["status", "--porcelain", "--untracked-files=all"], cwd);
  return st.out
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, "") }))
    .filter(({ code, path }) => onList(path, code))
    .map(({ path }) => path);
}

/** git's status for exactly the named paths, path → its two-letter code */
async function statusOf(paths: string[], cwd: string): Promise<Map<string, string>> {
  const st = await git(["status", "--porcelain", "--untracked-files=all", "--", ...paths], cwd);
  const m = new Map<string, string>();
  for (const l of st.out.split("\n").filter(Boolean)) m.set(l.slice(3).replace(/^"|"$/g, ""), l.slice(0, 2));
  return m;
}

/** Pensieve's own container image is the one place `PENSIEVE_RUNNER=container` is set (its Dockerfile) */
export const inContainer = () => process.env.PENSIEVE_RUNNER?.trim() === "container";

const INDEX_LOCK_RETRIES = 20;
const INDEX_LOCK_DELAY_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Adds and commits exactly `paths` — never the whole index, so something the operator
 * staged by hand does not ride along — retrying past a held `index.lock`. With no
 * `author`, git's own identity commits it (the person's, on the host); with one, it
 * commits as `GIT_AUTHOR_*`/`GIT_COMMITTER_*` say.
 */
async function commitPaths(paths: string[], message: string, opts: { cwd: string; author?: { name: string; email: string } }): Promise<{ sha: string }> {
  const env = opts.author
    ? { GIT_AUTHOR_NAME: opts.author.name, GIT_AUTHOR_EMAIL: opts.author.email, GIT_COMMITTER_NAME: opts.author.name, GIT_COMMITTER_EMAIL: opts.author.email }
    : undefined;
  for (let attempt = 1; ; attempt++) {
    const add = await git(["add", "--", ...paths], opts.cwd);
    const c = add.code === 0 ? await git(["commit", "-q", "-m", message, "--only", "--", ...paths], opts.cwd, env) : add;
    if (c.code === 0) break;
    if (attempt < INDEX_LOCK_RETRIES && /index\.lock/.test(c.err)) {
      await sleep(INDEX_LOCK_DELAY_MS);
      continue;
    }
    throw new Error(`git ${add.code === 0 ? "commit" : "add"}: ${c.err}`);
  }
  return { sha: (await git(["rev-parse", "--short", "HEAD"], opts.cwd)).out.trim() };
}

export type CommitResult = { committed: boolean; sha?: string; files: number; cursor: "promoted" | "unchanged" | "none" };

export async function commitRun(message: string, opts: { dryRun?: boolean; cwd?: string } = {}): Promise<CommitResult> {
  const cwd = opts.cwd ?? root();
  const files = await changed(cwd);
  let sha: string | undefined;
  if (files.length && !opts.dryRun) sha = (await commitPaths(files, message, { cwd })).sha;
  let cursor: CommitResult["cursor"] = "none";
  if (await exists(cursorNextPath())) {
    if (!opts.dryRun) await rename(cursorNextPath(), cursorPath());
    cursor = "promoted";
  } else if (await exists(cursorPath())) cursor = "unchanged";
  return { committed: !!sha, sha, files: files.length, cursor };
}

export type SaveResult = { committed: boolean; sha?: string; files: number };

/**
 * `argus save`: commits exactly the named paths, authored by the person running it
 * (`argus/ledger` S-20). Refuses, naming every one, a path off S-12's list — even in
 * container mode or a dry run, before either short-circuits. Commits nothing inside
 * Pensieve's container (S-19), and nothing when none of the named paths changed (S-13).
 */
export async function saveRun(paths: string[], message: string, opts: { dryRun?: boolean; cwd?: string } = {}): Promise<SaveResult> {
  const cwd = opts.cwd ?? root();
  const statuses = await statusOf(paths, cwd);
  const refused = paths.filter((p) => !onList(p, statuses.get(p) ?? ""));
  if (refused.length) throw new Error(`not part of the record, refused: ${refused.join(", ")}`);
  const changedPaths = paths.filter((p) => statuses.has(p));
  if (!changedPaths.length) return { committed: false, files: 0 };
  if (inContainer() || opts.dryRun) return { committed: false, files: changedPaths.length };
  const { sha } = await commitPaths(changedPaths, message, { cwd });
  return { committed: true, sha, files: changedPaths.length };
}
