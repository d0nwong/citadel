/**
 * Whether a landing is live. The backend deploys to App Engine from every merge to `dev`
 * through a Bitbucket pipeline, and Bitbucket's pipelines API says for each merge commit
 * whether that pipeline finished, how, and when, or is still running. A finished answer is
 * the `deployed` fact on a backend landing and on a landing blocker; argus asks again every
 * run until there is one. Credentials are the ones `bb` keeps in
 * `~/.bitbucket-rest-cli-config.json` (`BITBUCKET_CONFIG` overrides the path); read here
 * and nowhere else. Finished answers are cached in `state/deploys.json`, so a sha is
 * settled once.
 *
 * The frontend's deploy is not read yet: `deployCheck("fe", ...)` answers unknown, and a
 * frontend landing blocker waits for a person until that is decided.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { noteWritten } from "./commit.ts";
import { stateDir } from "./paths.ts";
import { REPOS } from "./pr-facts.ts";
import type { Repo } from "./schema.ts";

export type Deploy = { result: "SUCCESSFUL" | "FAILED" | "STOPPED" | "ERROR"; at: string; build: number; url: string };

export type DeployCache = Record<string, Deploy>;
const cachePath = () => join(stateDir(), "deploys.json");

export async function readDeployCache(): Promise<DeployCache> {
  const f = Bun.file(cachePath());
  return (await f.exists()) ? ((await f.json()) as DeployCache) : {};
}
export async function writeDeployCache(c: DeployCache): Promise<void> {
  await Bun.write(cachePath(), JSON.stringify(c, null, 2) + "\n");
  noteWritten(cachePath());
}

export async function bitbucketAuth(path = process.env.BITBUCKET_CONFIG ?? join(homedir(), ".bitbucket-rest-cli-config.json")): Promise<string | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  const c = (await f.json()) as { auth?: { username?: string; appPassword?: string } };
  const u = c.auth?.username;
  const p = c.auth?.appPassword;
  return u && p ? `Basic ${btoa(`${u}:${p}`)}` : null;
}

type Pipeline = {
  build_number: number;
  state: { name: string; result?: { name: string } };
  target?: { ref_name?: string; commit?: { hash?: string } };
  completed_on?: string;
  created_on: string;
};

/**
 * What Bitbucket says about one sha: its pipeline finished (`done`, any result), is still
 * going (`running`), or is not among the newest pipelines on the branch (`not-found`).
 * `unknown` is a question nobody could ask: no credentials, or the frontend.
 */
export type Check = { state: "done"; deploy: Deploy } | { state: "running" } | { state: "not-found" } | { state: "unknown"; why: string };

/** Bitbucket's largest page, so a busy week's merges are still on it */
const PAGELEN = 100;
/** one page per branch per minute: a run asks about many shas, and they share it */
const pages = new Map<string, { at: number; values: Promise<Pipeline[]> }>();

async function newestPipelines(slug: string, branch: string, auth: string, f: typeof fetch, pagelen: number): Promise<Pipeline[]> {
  const url = `https://api.bitbucket.org/2.0/repositories/${slug}/pipelines/?target.branch=${encodeURIComponent(branch)}&sort=-created_on&pagelen=${pagelen}`;
  const res = await f(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`bitbucket pipelines: ${res.status}`);
  return ((await res.json()) as { values: Pipeline[] }).values;
}

/** the pipeline that ran for `sha` on `branch`, among the newest; undefined without credentials */
export async function pipelineFor(
  slug: string,
  branch: string,
  sha: string,
  opts: { fetch?: typeof fetch; auth?: string | null; pagelen?: number } = {},
): Promise<Check | undefined> {
  const auth = opts.auth === undefined ? await bitbucketAuth() : opts.auth;
  if (!auth) return undefined;
  let values: Promise<Pipeline[]>;
  if (opts.fetch) values = newestPipelines(slug, branch, auth, opts.fetch, opts.pagelen ?? PAGELEN);
  else {
    const key = `${slug}@${branch}`;
    const hit = pages.get(key);
    if (hit && Date.now() - hit.at < 60_000) values = hit.values;
    else {
      values = newestPipelines(slug, branch, auth, fetch, opts.pagelen ?? PAGELEN);
      pages.set(key, { at: Date.now(), values });
      values.catch(() => pages.delete(key));
    }
  }
  const hit = (await values).find((v) => {
    const h = v.target?.commit?.hash ?? "";
    return h.length > 0 && (h.startsWith(sha) || sha.startsWith(h));
  });
  if (!hit) return { state: "not-found" };
  const result = (hit.state.result?.name ?? "") as Deploy["result"] | "";
  if (!result) return { state: "running" };
  return {
    state: "done",
    deploy: {
      result,
      at: hit.completed_on ?? hit.created_on,
      build: hit.build_number,
      url: `https://bitbucket.org/${slug}/addon/pipelines/home#!/results/${hit.build_number}`,
    },
  };
}

const BRANCH: Record<Repo, string | null> = { be: "dev", fe: null };

export type CheckOptions = { fetch?: typeof fetch; auth?: string | null; cache?: DeployCache };

/** what Bitbucket says about a landing's deploy, with the cache in front; only a finished pipeline is cached */
export async function deployCheck(repo: Repo, sha: string, opts: CheckOptions = {}): Promise<Check> {
  const branch = BRANCH[repo];
  if (!branch) return { state: "unknown", why: "the frontend's deploy is not read" };
  const cache = opts.cache ?? (await readDeployCache());
  const key = `${repo}@${sha}`;
  if (cache[key]) return { state: "done", deploy: cache[key] };
  const c = await pipelineFor(REPOS[repo].slug, branch, sha, opts);
  if (!c) return { state: "unknown", why: "no Bitbucket credentials" };
  if (c.state !== "done") return c;
  cache[key] = c.deploy;
  if (!opts.cache) await writeDeployCache(cache);
  return c;
}

/** the deploy of a landing, null when it has not finished or is unknown */
export async function deployedAt(repo: Repo, sha: string, opts: CheckOptions = {}): Promise<Deploy | null> {
  const c = await deployCheck(repo, sha, opts);
  return c.state === "done" ? c.deploy : null;
}
