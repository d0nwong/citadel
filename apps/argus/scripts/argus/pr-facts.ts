#!/usr/bin/env bun
/**
 * pr-facts — the landings on a repo's base branch, as data.
 *
 * A landing is one merge on the base branch (FE `origin/staging`, BE `origin/dev`) or a
 * commit pushed straight at it. `landingsSince` lists them with the files each changed and
 * the features those files map to through the manifest; for the backend, the routes a
 * landing added or removed are inverted through the accio index when it is present, so a
 * route change names the features that call it. Resolution runs against `origin/<ref>`,
 * never a local branch: the checkouts are shared and their local branches go stale.
 *
 *   pr-facts --since 2026-08-27 [--be]   landings since that date, as JSON
 *   pr-facts 363 [--be]                  one landing's facts
 *
 * Repo paths: ALDEN_FE_REPO and ALDEN_BE_REPO in the environment, else ~/git/alden-portal-fe and
 * ~/git/alden-connect-portal-be.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { type FeatureFileEntry, featureFiles, featuresForFiles, loadManifest, type Manifest } from "./manifest.ts";
import { root } from "./paths.ts";
import { allAreas, loadProjects } from "./projects.ts";

/** alden-portal's own two repos; pulling and reconciling a third project's repos is out of scope until tickets 8 and 9 generalize this */
export type RepoKind = "fe" | "be";

const expand = (p: string) => p.replace(/^~/, homedir());
export const repoPath = (kind: RepoKind) =>
  expand(kind === "fe" ? (process.env.ALDEN_FE_REPO ?? "~/git/alden-portal-fe") : (process.env.ALDEN_BE_REPO ?? "~/git/alden-connect-portal-be"));

export const REPOS = {
  fe: { slug: "aldenstudios/alden-portal-fe", ref: "origin/staging" },
  be: { slug: "aldenstudios/alden-connect-portal-be", ref: "origin/dev" },
} as const;

export type Repo = { kind: RepoKind; path: string; slug: string; ref: string };
export const repoOf = (kind: RepoKind, path = repoPath(kind)): Repo => ({ kind, path, ...REPOS[kind] });

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
/** bitbucket writes `Merged in <branch> (pull request #N)` as the merge subject */
export const MERGE_RE = /^Merged in (\S+) \(pull request #(\d+)\)/;
/** ids that look like tickets and are not */
export const NOT_A_TICKET = /^(BR|MM|PR|CI|BE|FE|UI|API|HTTP|UTF|SHA|ISO|RGB|R|A|P)-/;

export async function git(repo: Repo, ...args: string[]): Promise<string> {
  const p = Bun.spawnSync(["git", "-C", repo.path, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString().trimEnd();
}

export const fetchOrigin = (repo: Repo) =>
  Bun.spawnSync(["git", "-C", repo.path, "fetch", "--quiet", "origin"], { stdout: "ignore", stderr: "ignore" });

const lines = (s: string) => (s ? s.split("\n") : []);

export const ticketKeysIn = (text: string) =>
  [...new Set([...text.toUpperCase().matchAll(TICKET_RE)].map((x) => x[1]!))].filter((t) => !NOT_A_TICKET.test(t));

export type Landing = {
  repo: RepoKind;
  /** `fe#417`, or `fe@ac1caffd6` for a commit pushed straight at the branch */
  ref: string;
  number: number | null;
  sha: string;
  short: string;
  /** when it reached the branch, ISO */
  at: string;
  date: string;
  by: string;
  url: string | null;
  branch: string | null;
  title: string;
  ticketKeys: string[];
  files: string[];
  /** feature directories the files map to, most hits first */
  features: string[];
  /** backend only: routes whose definition the landing added or removed */
  routes: string[];
};

/** the git log record format `landingsSince` reads; one record per landing */
export const LOG_FORMAT = "--format=%H%x1f%cI%x1f%cd%x1f%an%x1f%s%x1f%b%x1e";

/** parse one `git log --first-parent` output in LOG_FORMAT into landings without files or features */
export function parseLandings(kind: RepoKind, log: string): Omit<Landing, "files" | "features" | "routes">[] {
  const slug = REPOS[kind].slug;
  return log
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.trim())
    .map((record) => {
      const [sha, at, date, by, subject, body] = record.split("\x1f");
      const m = subject!.match(MERGE_RE);
      const number = m ? Number(m[2]) : null;
      const branch = m?.[1] ?? null;
      const title = ((m ? (body ?? "").split("\n").find(Boolean) : subject) ?? subject!).trim();
      return {
        repo: kind,
        ref: number ? `${kind}#${number}` : `${kind}@${sha!.slice(0, 9)}`,
        number,
        sha: sha!,
        short: sha!.slice(0, 9),
        at: at!,
        date: date!,
        by: by!,
        url: number ? `https://bitbucket.org/${slug}/pull-requests/${number}` : null,
        branch,
        title,
        ticketKeys: ticketKeysIn(`${branch ?? ""}\n${title}\n${subject}`),
      };
    });
}

/** the files a landing changed: a merge's second parent against its first, a direct push against its parent */
export async function filesOf(repo: Repo, sha: string): Promise<string[]> {
  return lines(await git(repo, "diff", "--name-only", `${sha}^1..${sha}`).catch(() => ""));
}

const ROUTE_OPEN_RE = /router\.(get|post|put|patch|delete)\(/;
const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/;

/**
 * Backend routes whose line was added or removed by a landing, spelled the way the spec
 * does (`:id` → `{id}`), joined onto the mount prefix `src/routers/v1/index.ts` gives each
 * router at the landing's sha. v1 itself mounts at /api/v1.
 */
export async function changedRoutes(repo: Repo, sha: string, files: string[]): Promise<string[]> {
  const routers = files.filter((f) => /^src\/routers\/v1\/[^/]+\.ts$/.test(f) && !f.endsWith("/index.ts"));
  if (!routers.length) return [];
  const index = await git(repo, "show", `${sha}:src/routers/v1/index.ts`).catch(() => "");
  const importOf = new Map<string, string>();
  for (const m of index.matchAll(/^import\s+(\w+)\s+from\s+["']\.\/([^"']+)["']/gm)) importOf.set(m[2]!, m[1]!);
  const mountOf = new Map<string, string>();
  for (const m of index.matchAll(/^\s*router\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\(/gm)) mountOf.set(m[2]!, m[1]!);
  const keys = new Set<string>();
  for (const file of routers) {
    const base = file.replace(/^src\/routers\/v1\//, "").replace(/\.ts$/, "");
    const mount = mountOf.get(importOf.get(base) ?? "");
    if (mount === undefined) continue;
    const diff = await git(repo, "diff", `${sha}^1..${sha}`, "--", file).catch(() => "");
    const rows = lines(diff).filter((l) => /^[ +-]/.test(l) && !/^(\+\+\+|---)/.test(l));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!/^[+-]/.test(row)) continue;
      if (!ROUTE_OPEN_RE.test(row.slice(1).replace(/^\s*\/\/.*$/, ""))) continue;
      const m = rows.slice(i, i + 4).map((r) => r.slice(1)).join(" ").match(ROUTE_RE);
      if (!m) continue;
      const path = `/api/v1${mount}${m[2]!.startsWith("/") ? "" : "/"}${m[2]}`.replace(/:(\w+)/g, "{$1}").replace(/\/+$/, "");
      keys.add(`${m[1]!.toUpperCase()} ${path}`);
    }
  }
  return [...keys].sort();
}

/**
 * The project that declares `repoId`, its own manifest, and the file→feature table keyed
 * by that project's own repo ids — `area.repo` is the "fe" side (the repo its route tree
 * comes from), the project's other repo is the "be" side. Null when no configured project
 * declares the repo (CTD-271, ledger S-27): today `repoId` is always alden-portal's "fe" or
 * "be", so this always resolves, from the default config, to exactly what `loadManifest()`
 * and `featureFiles(manifest)` gave before this feature. Exported so a test can prove the
 * resolution for a repo id a second project declares, ahead of a second project's landings
 * actually being pulled (ticket 8).
 */
export async function manifestTableFor(repoId: string): Promise<{ manifest: Manifest; table: FeatureFileEntry[] } | null> {
  const config = await loadProjects();
  const project = config.projects.find((p) => p.repos.some((r) => r.id === repoId));
  const area = project && allAreas(config).find((a) => a.project === project.id);
  if (!project || !area) return null;
  const manifest = await loadManifest(area.dir);
  const be = project.repos.find((r) => r.id !== area.repo)?.id;
  return { manifest, table: featureFiles(manifest, { fe: area.repo, ...(be ? { be } : {}) }) };
}

/** the accio index's route → feature-ids map, when the index exists; ids are manifest ids, mapped to dirs by the caller */
async function routeOwners(): Promise<Map<string, string[]> | null> {
  const idx = await Bun.file(join(root(), ".state/accio-index.json")).json().catch(() => null);
  if (!idx?.ops) return null;
  const norm = (u: string) => u.replace(/\{[^}]*\}/g, "{p}").replace(/\/+$/, "");
  const ops = new Map<string, string[]>();
  for (const [k, v] of Object.entries<any>(idx.ops)) ops.set(norm(k.replace(/^~/, "")), v.features ?? []);
  return ops;
}

/** every landing on the base branch since `from` (a date or a git date), newest first, with files and features */
export async function landingsSince(repo: Repo, from: string): Promise<Landing[]> {
  const since = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from} 00:00` : from;
  const log = await git(repo, "log", "--first-parent", `--since=${since}`, LOG_FORMAT, "--date=short", repo.ref);
  const owner = await manifestTableFor(repo.kind);
  const idToDir = new Map((owner?.manifest.features ?? []).map((f) => [f.id, owner!.table.find((t) => t.name === f.name)!.dir]));
  const owners = repo.kind === "be" ? await routeOwners() : null;
  const out: Landing[] = [];
  for (const l of parseLandings(repo.kind, log)) {
    const files = await filesOf(repo, l.sha);
    const features = owner ? featuresForFiles(files, owner.table, repo.kind) : [];
    const routes = repo.kind === "be" ? await changedRoutes(repo, l.sha, files) : [];
    if (owners) {
      const norm = (u: string) => u.replace(/\{[^}]*\}/g, "{p}").replace(/\/+$/, "");
      for (const r of routes) for (const id of owners.get(norm(r)) ?? []) {
        const dir = idToDir.get(id);
        if (dir && !features.includes(dir)) features.push(dir);
      }
    }
    out.push({ ...l, files, features, routes });
  }
  return out;
}

/** the landing that carried a PR number */
export async function landingOfPr(repo: Repo, pr: number): Promise<Landing | null> {
  const log = await git(repo, "log", "--first-parent", LOG_FORMAT, "--date=short", "-n", "2000", repo.ref);
  const hit = parseLandings(repo.kind, log).find((l) => l.number === pr);
  if (!hit) return null;
  const files = await filesOf(repo, hit.sha);
  const owner = await manifestTableFor(repo.kind);
  return { ...hit, files, features: owner ? featuresForFiles(files, owner.table, repo.kind) : [], routes: repo.kind === "be" ? await changedRoutes(repo, hit.sha, files) : [] };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const kind: RepoKind = argv.includes("--be") ? "be" : "fe";
  const repo = repoOf(kind);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log("pr-facts --since <date> [--be] [--no-fetch]   landings as JSON\npr-facts <pr-number> [--be]                  one landing");
    process.exit(argv.length ? 0 : 1);
  }
  if (!argv.includes("--no-fetch")) fetchOrigin(repo);
  const sinceFlag = argv.indexOf("--since");
  if (sinceFlag >= 0) {
    console.log(JSON.stringify(await landingsSince(repo, argv[sinceFlag + 1]!), null, 2));
    process.exit(0);
  }
  const pr = argv.find((a) => /^\d+$/.test(a));
  if (!pr) { console.error("give --since <date> or a PR number"); process.exit(1); }
  const l = await landingOfPr(repo, Number(pr));
  if (!l) { console.error(`no merge for PR #${pr} on ${repo.ref}`); process.exit(1); }
  console.log(JSON.stringify(l, null, 2));
}
