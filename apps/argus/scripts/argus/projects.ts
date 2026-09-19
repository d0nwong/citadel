/**
 * `projects.json` (CTD-265): the hand-written file at the citadel-data root describing every
 * project the sweep watches — its repos, tracker(s), jobs and doc areas — and every Slack
 * channel, and which projects it may carry. Repo ids are unique across every project; a doc
 * area ties one directory under the checkout root to the one repo its features come from.
 *
 * `loadProjects` returns the config typed. With no file present it returns alden-portal's
 * own values unchanged — one project, one area at `DEFAULT_APP` — so a checkout without the
 * file behaves exactly as it did before this feature (ledger S-21, S-25).
 *
 * `parseProjectsConfig` checks the file's shape and throws the first broken path, as
 * `parseLedger` does. `validateProjectsConfig` checks the policy across the whole config —
 * duplicate ids, dangling references, an area's directory missing or shared — and returns
 * every problem, never just the first (ledger S-21, S-24, S-25).
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { providerNameForTeam } from "@citadel/tickets";
import { DEFAULT_APP, listApps, listFeatures, projectsPath, root } from "./paths.ts";
import { SchemaError } from "./schema.ts";
import type { Problem } from "./validate.ts";

export { projectsPath };

export const REPO_HOSTS = ["github", "bitbucket"] as const;
export type RepoHost = (typeof REPO_HOSTS)[number];

export const DEPLOY_KINDS = ["live", "pipeline"] as const;
export type DeployKind = (typeof DEPLOY_KINDS)[number];
export type DeploySource = { kind: DeployKind };

export const JOBS = ["docs", "record"] as const;
export type Job = (typeof JOBS)[number];

export const TRACKER_PROVIDERS = ["linear", "trello"] as const;
export type TrackerProvider = (typeof TRACKER_PROVIDERS)[number];

/** id: unique across every project's repos. `path`: the local checkout, unvalidated here (a clone target, not required to exist yet). */
export type ProjectRepo = {
  id: string;
  cloneUrl: string;
  path: string;
  baseBranch: string;
  host: RepoHost;
  deploy: DeploySource;
};

/** one tracker a project's tickets may live on; `key` is the Linear team or the Trello board it reads. */
export type Tracker = {
  provider: TrackerProvider;
  key: string;
  prefixes: string[];
};

/** a doc area: `dir` is the checkout-root-relative directory `listFeatures`/`listApps` walk; `repo` must be one of the owning project's own repo ids. */
export type DocArea = {
  id: string;
  repo: string;
  dir: string;
  routeTree?: string;
  apiSpec?: string;
};

export type Project = {
  id: string;
  repos: ProjectRepo[];
  trackers: Tracker[];
  jobs: Job[];
  areas: DocArea[];
};

export type Channel = {
  id: string;
  projects: string[];
};

export type ProjectsConfig = {
  projects: Project[];
  channels: Channel[];
};

// ---------------------------------------------------------------- shape (throws the first broken path)

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw new SchemaError(path, "expected an object");
  return v;
}
function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string" || !v) throw new SchemaError(`${path}.${key}`, "expected a non-empty string");
  return v;
}
function optStr(o: Obj, key: string, path: string): string | undefined {
  if (o[key] === undefined) return undefined;
  return str(o, key, path);
}
/** a plain string field allowed to be empty — the local clone path, unset before the first clone */
function anyStr(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new SchemaError(`${path}.${key}`, "expected a string");
  return v;
}
function arr(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new SchemaError(`${path}.${key}`, "expected an array");
  return v;
}
function strs(o: Obj, key: string, path: string): string[] {
  return arr(o, key, path).map((v, i) => {
    if (typeof v !== "string") throw new SchemaError(`${path}.${key}[${i}]`, "expected a string");
    return v;
  });
}
function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], path: string): T {
  const v = str(o, key, path);
  if (!(allowed as readonly string[]).includes(v)) throw new SchemaError(`${path}.${key}`, `expected one of ${allowed.join(", ")}, got "${v}"`);
  return v as T;
}

function parseRepo(v: unknown, path: string): ProjectRepo {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    cloneUrl: str(o, "cloneUrl", path),
    path: anyStr(o, "path", path),
    baseBranch: str(o, "baseBranch", path),
    host: oneOf(o, "host", REPO_HOSTS, path),
    deploy: { kind: oneOf(obj(o.deploy, `${path}.deploy`), "kind", DEPLOY_KINDS, `${path}.deploy`) },
  };
}

function parseTracker(v: unknown, path: string): Tracker {
  const o = obj(v, path);
  return { provider: oneOf(o, "provider", TRACKER_PROVIDERS, path), key: str(o, "key", path), prefixes: strs(o, "prefixes", path) };
}

function parseArea(v: unknown, path: string): DocArea {
  const o = obj(v, path);
  const a: DocArea = { id: str(o, "id", path), repo: str(o, "repo", path), dir: str(o, "dir", path) };
  const routeTree = optStr(o, "routeTree", path);
  const apiSpec = optStr(o, "apiSpec", path);
  if (routeTree !== undefined) a.routeTree = routeTree;
  if (apiSpec !== undefined) a.apiSpec = apiSpec;
  return a;
}

function parseProject(v: unknown, path: string): Project {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    repos: arr(o, "repos", path).map((r, i) => parseRepo(r, `${path}.repos[${i}]`)),
    trackers: arr(o, "trackers", path).map((t, i) => parseTracker(t, `${path}.trackers[${i}]`)),
    jobs: arr(o, "jobs", path).map((j, i) => {
      const jo = { job: j };
      return oneOf(jo, "job", JOBS, `${path}.jobs[${i}]`);
    }),
    areas: arr(o, "areas", path).map((a, i) => parseArea(a, `${path}.areas[${i}]`)),
  };
}

function parseChannel(v: unknown, path: string): Channel {
  const o = obj(v, path);
  return { id: str(o, "id", path), projects: strs(o, "projects", path) };
}

/** Checks `projects.json`'s shape and returns it typed, or throws the first broken path (as `parseLedger` does). */
export function parseProjectsConfig(v: unknown): ProjectsConfig {
  const o = obj(v, "projects.json");
  return {
    projects: arr(o, "projects", "projects.json").map((p, i) => parseProject(p, `projects.json.projects[${i}]`)),
    channels: arr(o, "channels", "projects.json").map((c, i) => parseChannel(c, `projects.json.channels[${i}]`)),
  };
}

// ---------------------------------------------------------------- the default (no file present)

/** alden-portal's own values, unchanged by this feature: one project, one area at `DEFAULT_APP` (ledger S-21, S-25). */
export function defaultProjectsConfig(): ProjectsConfig {
  return {
    projects: [
      {
        id: "alden-portal",
        repos: [
          {
            id: "fe",
            cloneUrl: process.env.ALDEN_FE_REPO_URL ?? "https://bitbucket.org/aldenstudios/alden-portal-fe.git",
            path: process.env.ALDEN_FE_REPO ?? "",
            baseBranch: "staging",
            host: "bitbucket",
            deploy: { kind: "live" },
          },
          {
            id: "be",
            cloneUrl: process.env.ALDEN_BE_REPO_URL ?? "https://bitbucket.org/aldenstudios/alden-connect-portal-be.git",
            path: process.env.ALDEN_BE_REPO ?? "",
            baseBranch: "dev",
            host: "bitbucket",
            deploy: { kind: "pipeline" },
          },
        ],
        trackers: [
          { provider: "trello", key: "AP", prefixes: ["AP"] },
          { provider: "linear", key: "ALD", prefixes: ["ALD"] },
        ],
        jobs: ["docs", "record"],
        areas: [{
          id: "alden-portal", repo: "fe", dir: DEFAULT_APP,
          // alden-portal's own: a TanStack file-based route tree, and its team's published
          // OpenAPI doc (scraped — see accio/spec.ts) — the two things map/sync need (S-10).
          routeTree: "src/routes",
          apiSpec: "https://dev-alden-portal.uc.r.appspot.com/api-docs/",
        }],
      },
    ],
    channels: [{ id: "C07KG06L601", projects: ["alden-portal"] }],
  };
}

/** `projects.json`, typed — the default when the checkout has none (a checkout without it validates as today). */
export async function loadProjects(): Promise<ProjectsConfig> {
  const file = Bun.file(projectsPath());
  if (!(await file.exists())) return defaultProjectsConfig();
  return parseProjectsConfig(await file.json());
}

// ---------------------------------------------------------------- policy (every problem, never just the first)

const exists = (p: string) => stat(p).then(() => true, () => false);

/** every doc area across every project, each carrying its owning project's id */
export function allAreas(config: ProjectsConfig): (DocArea & { project: string })[] {
  return config.projects.flatMap((p) => p.areas.map((a) => ({ ...a, project: p.id })));
}

/**
 * What an area needs before `accio map`/`accio sync` can generate anything for it
 * (CTD-267, spec S-10): a route tree to derive a manifest from, and an API spec to join
 * it to. Empty when the area declares both; citadel's areas declare neither, so this
 * names both.
 */
export function missingForGenerate(area: DocArea): string[] {
  const missing: string[] = [];
  if (!area.routeTree) missing.push("route tree");
  if (!area.apiSpec) missing.push("API spec");
  return missing;
}

function duplicates<T>(items: T[], key: (t: T) => string): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const it of items) {
    const k = key(it);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

/**
 * Every policy rule on `projects.json` beyond its shape (ledger S-21, S-24, S-25): ids
 * unique everywhere they must be, a channel's project known and record-capable, an area's
 * directory neither shared nor missing, an area's repo declared by its own project, and
 * every tracker's prefix owned by a real provider. Returns every problem found, not just
 * the first — `parseProjectsConfig`'s shape errors are the only ones that stop at one.
 */
export async function validateProjectsConfig(config: ProjectsConfig): Promise<Problem[]> {
  const out: Problem[] = [];
  const path = "projects.json";

  for (const id of duplicates(config.projects, (p) => p.id)) out.push({ path: `${path}.projects`, rule: `${id} is a project id more than once` });
  const allRepos = config.projects.flatMap((p) => p.repos);
  for (const id of duplicates(allRepos, (r) => r.id)) out.push({ path: `${path}.projects[].repos`, rule: `${id} is a repo id more than once, and repo ids are unique across every project` });
  const areas = allAreas(config);
  for (const id of duplicates(areas, (a) => a.id)) out.push({ path: `${path}.projects[].areas`, rule: `${id} is an area id more than once` });
  for (const id of duplicates(config.channels, (c) => c.id)) out.push({ path: `${path}.channels`, rule: `${id} is a channel id more than once` });

  const projectsById = new Map(config.projects.map((p) => [p.id, p]));
  for (const [i, c] of config.channels.entries()) {
    const cpath = `${path}.channels[${i}]`;
    for (const pid of c.projects) {
      const project = projectsById.get(pid);
      if (!project) out.push({ path: `${cpath}.projects`, rule: `${pid} is not a project in this config` });
      else if (!project.jobs.includes("record")) out.push({ path: `${cpath}.projects`, rule: `${pid} does not have the record job, so ${c.id} cannot carry it` });
    }
  }

  for (const dir of duplicates(areas, (a) => a.dir)) out.push({ path: `${path}.projects[].areas`, rule: `two areas share the data directory "${dir}"` });
  for (const a of areas) {
    if (!(await exists(join(root(), a.dir)))) out.push({ path: `${path}.projects[].areas`, rule: `${a.id}: data directory "${a.dir}" does not exist` });
    const project = projectsById.get(a.project)!;
    if (!project.repos.some((r) => r.id === a.repo)) out.push({ path: `${path}.projects[].areas`, rule: `${a.id}: repo ${a.repo} is not declared by ${a.project}` });
  }

  for (const [i, project] of config.projects.entries()) {
    for (const [j, t] of project.trackers.entries()) {
      for (const prefix of t.prefixes) {
        if (!providerNameForTeam(prefix)) out.push({ path: `${path}.projects[${i}].trackers[${j}].prefixes`, rule: `no ticket provider owns the prefix "${prefix}"` });
      }
    }
  }

  return out;
}

/**
 * The feature directories no configured doc area holds (ledger S-24): every app `listApps`
 * finds under the checkout root whose path names no area's `dir`, with the features under
 * it. Meaningful only once `projects.json` exists — with the default config, `DEFAULT_APP`
 * is always held, so this always answers empty.
 */
export async function unheldFeatures(config: ProjectsConfig): Promise<{ app: string; feature: string }[]> {
  const held = new Set(allAreas(config).map((a) => a.dir));
  const out: { app: string; feature: string }[] = [];
  for (const app of await listApps()) {
    if (held.has(app)) continue;
    for (const feature of await listFeatures(app)) out.push({ app, feature });
  }
  return out;
}
