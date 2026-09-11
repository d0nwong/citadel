/**
 * Whether a landing is live. The backend deploys to App Engine from every merge to `dev`
 * through a Bitbucket pipeline, and Bitbucket's pipelines API says for each merge commit
 * whether that pipeline succeeded and when. That answer is the `deployed` fact on a
 * landing blocker. Credentials are the ones `bb` keeps in
 * `~/.bitbucket-rest-cli-config.json` (`BITBUCKET_CONFIG` overrides the path); read here
 * and nowhere else. Terminal answers are cached in `state/deploys.json`, so a sha is asked
 * about once.
 *
 * The frontend's deploy is not read yet: `deployedAt("fe", ...)` answers null, unknown, and
 * a frontend landing blocker waits for a person until that is decided.
 */

import { homedir } from "node:os";
import { join } from "node:path";
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

/** the pipeline that ran for `sha` on `branch`, if Bitbucket lists one among the newest; undefined without credentials */
export async function pipelineFor(
  slug: string,
  branch: string,
  sha: string,
  opts: { fetch?: typeof fetch; auth?: string | null; pagelen?: number } = {},
): Promise<Deploy | null | undefined> {
  const auth = opts.auth === undefined ? await bitbucketAuth() : opts.auth;
  if (!auth) return undefined;
  const f = opts.fetch ?? fetch;
  const url = `https://api.bitbucket.org/2.0/repositories/${slug}/pipelines/?target.branch=${encodeURIComponent(branch)}&sort=-created_on&pagelen=${opts.pagelen ?? 30}`;
  const res = await f(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`bitbucket pipelines: ${res.status}`);
  const d = (await res.json()) as { values: Pipeline[] };
  const hit = d.values.find((v) => {
    const h = v.target?.commit?.hash ?? "";
    return h.length > 0 && (h.startsWith(sha) || sha.startsWith(h));
  });
  if (!hit) return null;
  const result = (hit.state.result?.name ?? "") as Deploy["result"] | "";
  if (!result) return null; // still running
  return {
    result,
    at: hit.completed_on ?? hit.created_on,
    build: hit.build_number,
    url: `https://bitbucket.org/${slug}/addon/pipelines/home#!/results/${hit.build_number}`,
  };
}

const BRANCH: Record<Repo, string | null> = { be: "dev", fe: null };

/** the deploy of a landing, null when it has not happened or is unknown, with the cache in front */
export async function deployedAt(
  repo: Repo,
  sha: string,
  opts: { fetch?: typeof fetch; auth?: string | null; cache?: DeployCache } = {},
): Promise<Deploy | null> {
  const branch = BRANCH[repo];
  if (!branch) return null;
  const cache = opts.cache ?? (await readDeployCache());
  const key = `${repo}@${sha}`;
  if (cache[key]) return cache[key];
  const d = await pipelineFor(REPOS[repo].slug, branch, sha, opts);
  if (!d) return null;
  cache[key] = d;
  if (!opts.cache) await writeDeployCache(cache);
  return d;
}
