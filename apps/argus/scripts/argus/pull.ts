/**
 * `argus pull`: one batch file from Slack and every record project's repos. The Slack window
 * is the cursor; the landing window per repo is the newest landing any ledger already holds,
 * else `--since`, else seven days back, and landings a ledger already lists are dropped so an
 * overlapping window is harmless. A repo that cannot be fetched or read is logged and skipped
 * for this run — its window stays put, so the next run tries it again, and every other repo
 * and Slack still get pulled (CTD-272, sweep S-14). Nothing new means no batch file, unless a
 * backend landing's pipeline finished since the last run: that is news for its feature's
 * reader, and `place` carries it. The advanced cursor
 * goes to `cursor.next.json`; `argus commit` promotes it, so a crashed run replays.
 *
 * The fetchers are injected so a test can run this against fixtures and no network.
 */

import { mkdir } from "node:fs/promises";
import { type Batch, batchId, batchPath } from "./batch.ts";
import { batchesDir, cursorNextPath, tickUnreachablePath } from "./paths.ts";
import { fetchOrigin, type Landing, landingsSince, repoFor } from "./pr-facts.ts";
import { awaitsDeploy } from "./blockers.ts";
import { type Deploy, deployedAt } from "./deploy.ts";
import { loadProjects, type ProjectRepo, recordFeatures, recordRepos } from "./projects.ts";
import type { Landing as RecordedLanding } from "./schema.ts";
import { flatten, type Pull, pullSlack } from "./slack-pull.ts";
import { readLedger } from "./write.ts";

export type PullSources = {
  slack: (since?: string) => Promise<Pull>;
  /** every landing on `repoId`'s base branch since `since`; throws when the repo can't be fetched or read */
  landings: (repoId: string, since: string) => Promise<Landing[]>;
  /** a backend merge's finished pipeline, or null */
  deployed: (sha: string) => Promise<Deploy | null>;
};

/** adds `id` to the tick's unreachable-repo record, de-duped, so the docs step can skip its areas this tick (CTD-272) */
async function markUnreachable(id: string): Promise<void> {
  const path = tickUnreachablePath();
  const existing = (await Bun.file(path).json().catch(() => [])) as string[];
  if (!existing.includes(id)) await Bun.write(path, JSON.stringify([...existing, id]) + "\n");
}

export type PullOptions = {
  since?: string;
  now?: Date;
  /** skip Slack or the repos */
  noSlack?: boolean;
  noLandings?: boolean;
  fetch?: boolean;
  /** write the batch here instead of state/batches, and never touch the cursor */
  outDir?: string;
  sources?: Partial<PullSources>;
  dryRun?: boolean;
};

export type PullResult = { batch: Batch | null; path: string | null; reason?: string };

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86400_000).toISOString().slice(0, 10);

/** the newest landing date each ledger holds per repo id, every sha already recorded, and the deploy news pending */
async function known(): Promise<{ newest: Record<string, string | null>; shas: Set<string>; untold: boolean; waiting: RecordedLanding[] }> {
  const newest: Record<string, string | null> = {};
  const shas = new Set<string>();
  let untold = false;
  const waiting: RecordedLanding[] = [];
  for (const { app, feature } of await recordFeatures()) {
    const l = await readLedger(feature, app);
    for (const ld of l?.landings ?? []) {
      shas.add(ld.sha);
      if (ld.deployed && !ld.deployed.told) untold = true;
      if (awaitsDeploy(ld)) waiting.push(ld);
      if (!newest[ld.repo] || ld.at > newest[ld.repo]!) newest[ld.repo] = ld.at;
    }
  }
  return { newest, shas, untold, waiting };
}

export const defaultSources = (repos: ProjectRepo[], fetch = true): PullSources => {
  const byId = new Map(repos.map((r) => [r.id, r]));
  return {
    slack: (since) => pullSlack({ since }),
    landings: async (id, since) => {
      const pr = byId.get(id);
      if (!pr) return [];
      const repo = repoFor(pr);
      if (fetch) {
        const code = fetchOrigin(repo);
        if (code !== 0) throw new Error(`fetch failed (exit ${code})`);
      }
      return landingsSince(repo, since);
    },
    deployed: (sha) => deployedAt("be", sha),
  };
};

/** true when a reader has a deploy to hear about: one recorded and untold, or a recent one that just finished */
async function deployNews(k: { untold: boolean; waiting: RecordedLanding[] }, deployed: PullSources["deployed"], now: Date): Promise<boolean> {
  if (k.untold) return true;
  const recent = daysAgo(7, now);
  for (const ld of k.waiting) if (ld.at >= recent && (await deployed(ld.sha))) return true;
  return false;
}

export async function pullBatch(opts: PullOptions = {}): Promise<PullResult> {
  const now = opts.now ?? new Date();
  const repos = recordRepos(await loadProjects());
  const sources = { ...defaultSources(repos, opts.fetch ?? true), ...opts.sources };
  const k = await known();
  const { newest, shas } = k;

  const slack = opts.noSlack ? null : await sources.slack(opts.since);
  const landings: Landing[] = [];
  const since: Batch["since"] = { slack: slack?.since ?? null };
  if (!opts.noLandings)
    for (const repo of repos) {
      const from = opts.since ?? newest[repo.id]?.slice(0, 10) ?? daysAgo(7, now);
      since[repo.id] = from;
      try {
        for (const l of await sources.landings(repo.id, from))
          if (!shas.has(l.sha) && !landings.some((x) => x.sha === l.sha)) landings.push(l);
      } catch (err) {
        console.error(`pull: ${repo.id} unreachable this run, skipping: ${(err as Error).message}`);
        await markUnreachable(repo.id);
      }
    }
  landings.sort((a, b) => a.at.localeCompare(b.at));

  const messages = slack ? flatten(slack).length : 0;
  if (!messages && !landings.length && !(await deployNews(k, sources.deployed, now))) return { batch: null, path: null, reason: "nothing new" };

  const batch: Batch = { id: batchId(now), pulled_at: now.toISOString(), since, slack, landings };
  const dir = opts.outDir ?? batchesDir();
  const path = batchPath(batch.id, dir);
  if (!opts.dryRun) {
    await mkdir(dir, { recursive: true });
    await Bun.write(path, JSON.stringify(batch, null, 2) + "\n");
    if (slack && !opts.since && !opts.outDir) {
      await mkdir(batchesDir(), { recursive: true });
      await Bun.write(cursorNextPath(), JSON.stringify(slack.next, null, 2) + "\n");
    }
  }
  return { batch, path };
}
