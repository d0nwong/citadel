/**
 * `argus commit`: the run's one lasting side effect. Stages every ledger, the committed
 * state files (threads, unplaced, deploys) and the arch docs, and commits when anything
 * is staged. Never pushes.
 *
 * `commitPaths` is the stage-and-commit primitive `commitRun`, `saveRun` (`argus save`) and
 * `commitWrites` (the post-verb commit, `argus/ledger` S-17) sit on: it commits only the
 * paths it is given (`git commit --only`), never whatever else happens to be staged, and
 * retries past a lock another git process is briefly holding. `commitRun` never promotes
 * the Slack cursor itself — only the `commit` verb does, through `promoteCursor`, and only
 * once its own commit has succeeded (or found nothing to commit), so a shared helper future
 * write verbs call mid-tick can never advance it early.
 *
 * `noteWritten` is how a write verb reports a path it wrote, never `git status`: `write.ts`,
 * `state.ts`, `deploy.ts` and `revision.ts` call it beside their own `Bun.write`/`rename`, and
 * `main()` resets the list before a verb runs and reads `writtenPaths()` back after, to build
 * that verb's own commit.
 */

import { rename, stat } from "node:fs/promises";
import { relative } from "node:path";
import { cursorNextPath, cursorPath, root } from "./paths.ts";

const exists = (p: string) => stat(p).then(() => true, () => false);

/** the paths a write verb has reported writing this process, root-relative; `main()` reads and resets it per verb */
let written = new Set<string>();
export const resetWritten = (): void => {
  written = new Set();
};
/** a write verb's report that it wrote (or renamed to/from) `path` — never inferred from `git status` */
export const noteWritten = (path: string): void => {
  written.add(relative(root(), path));
};
export const writtenPaths = (): string[] => [...written];

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

/**
 * Changed paths (modified, added, deleted) the run may commit, from git's own view — of the
 * whole tree by default (the sweep's `commitRun`), or, given `scope`, only beneath those
 * paths: a write verb's own reported roots, a file or a directory a revision verb renamed,
 * whose tracked contents move with it and are discovered here rather than named one by one.
 */
async function changed(cwd: string, scope?: string[]): Promise<string[]> {
  const st = await git(["status", "--porcelain", "--untracked-files=all", ...(scope?.length ? ["--", ...scope] : [])], cwd);
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

/** `loop.sh` exports this around the `claude -p "/sweep"` run it marks as a tick; every shell call inside it inherits it */
export const inTick = () => !!process.env.ARGUS_SWEEP_TICK?.trim();

/** the sweep's git identity for a tick's commit; `SWEEP_GIT_NAME`/`SWEEP_GIT_EMAIL` override it (`argus/ledger` S-15) */
export const sweepAuthor = () => ({
  name: process.env.SWEEP_GIT_NAME?.trim() || "argus sweep",
  email: process.env.SWEEP_GIT_EMAIL?.trim() || "sweep@citadel.local",
});

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

export type CommitResult = { committed: boolean; sha?: string; files: number };

export async function commitRun(
  message: string,
  opts: { dryRun?: boolean; cwd?: string; author?: { name: string; email: string } } = {},
): Promise<CommitResult> {
  const cwd = opts.cwd ?? root();
  const files = await changed(cwd);
  let sha: string | undefined;
  if (files.length && !opts.dryRun) sha = (await commitPaths(files, message, { cwd, author: opts.author })).sha;
  return { committed: !!sha, sha, files: files.length };
}

export type CursorResult = "promoted" | "unchanged" | "none";

/** promotes `state/cursor.next.json` to `state/cursor.json`, once the tick's own commit has succeeded or found nothing to commit */
export async function promoteCursor(opts: { dryRun?: boolean } = {}): Promise<CursorResult> {
  if (await exists(cursorNextPath())) {
    if (!opts.dryRun) await rename(cursorNextPath(), cursorPath());
    return "promoted";
  }
  return (await exists(cursorPath())) ? "unchanged" : "none";
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

/** where a write came from, when a Pensieve conversation sets it (a later ticket sets `ask/<id>`); unset outside one */
export const origin = (): string | null => process.env.ARGUS_ORIGIN?.trim() || null;

/**
 * The post-verb commit (`argus/ledger` S-17, `argus/revisions` S-20): a write verb run on
 * the host outside a sweep tick — by hand, by a skill, or by a click in a host-run Pensieve
 * — commits the files it reported through `noteWritten`, as the person running it, before it
 * exits. `roots` may be a file (a ledger, a state file) or a directory a revision verb
 * renamed; git's own status, scoped to exactly those roots and nowhere else in the tree,
 * says which tracked files actually moved or changed, so a directory rename's other files —
 * a spec, an intent — travel with it into the same commit without being named one by one.
 * Commits nothing inside Pensieve's container (S-19), on a dry run, or with nothing changed.
 */
export async function commitWrites(roots: string[], message: string, opts: { dryRun?: boolean; cwd?: string } = {}): Promise<CommitResult> {
  if (!roots.length) return { committed: false, files: 0 };
  const cwd = opts.cwd ?? root();
  const files = await changed(cwd, roots);
  if (!files.length) return { committed: false, files: 0 };
  if (inContainer() || opts.dryRun) return { committed: false, files: files.length };
  const { sha } = await commitPaths(files, message, { cwd });
  return { committed: true, sha, files: files.length };
}
