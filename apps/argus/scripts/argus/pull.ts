/**
 * `argus pull`: one batch file from Slack and both repos. The Slack window is the cursor;
 * the landing window per repo is the newest landing any ledger already holds, else
 * `--since`, else seven days back, and landings a ledger already lists are dropped so an
 * overlapping window is harmless. Nothing new means no batch file. The advanced cursor
 * goes to `cursor.next.json`; `argus commit` promotes it, so a crashed run replays.
 *
 * The fetchers are injected so a test can run this against fixtures and no network.
 */

import { mkdir } from "node:fs/promises";
import { type Batch, batchId, batchPath } from "./batch.ts";
import { batchesDir, cursorNextPath, listFeatures } from "./paths.ts";
import { fetchOrigin, type Landing, landingsSince, repoOf } from "./pr-facts.ts";
import type { Repo } from "./schema.ts";
import { flatten, type Pull, pullSlack } from "./slack-pull.ts";
import { readLedger } from "./write.ts";

export type PullSources = {
  slack: (since?: string) => Promise<Pull>;
  landings: (kind: Repo, since: string) => Promise<Landing[]>;
};

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

/** the newest landing date each ledger holds per repo, and every sha already recorded */
async function known(): Promise<{ newest: Record<Repo, string | null>; shas: Set<string> }> {
  const newest: Record<Repo, string | null> = { fe: null, be: null };
  const shas = new Set<string>();
  for (const f of await listFeatures()) {
    const l = await readLedger(f);
    for (const ld of l?.landings ?? []) {
      shas.add(ld.sha);
      if (!newest[ld.repo] || ld.at > newest[ld.repo]!) newest[ld.repo] = ld.at;
    }
  }
  return { newest, shas };
}

export const defaultSources = (fetch = true): PullSources => ({
  slack: (since) => pullSlack({ since }),
  landings: async (kind, since) => {
    const repo = repoOf(kind);
    if (fetch) fetchOrigin(repo);
    return landingsSince(repo, since);
  },
});

export async function pullBatch(opts: PullOptions = {}): Promise<PullResult> {
  const now = opts.now ?? new Date();
  const sources = { ...defaultSources(opts.fetch ?? true), ...opts.sources };
  const { newest, shas } = await known();

  const slack = opts.noSlack ? null : await sources.slack(opts.since);
  const landings: Landing[] = [];
  const since: Batch["since"] = { slack: slack?.since ?? null, fe: null, be: null };
  if (!opts.noLandings)
    for (const kind of ["fe", "be"] as Repo[]) {
      const from = opts.since ?? newest[kind]?.slice(0, 10) ?? daysAgo(7, now);
      since[kind] = from;
      for (const l of await sources.landings(kind, from))
        if (!shas.has(l.sha) && !landings.some((x) => x.sha === l.sha)) landings.push(l);
    }
  landings.sort((a, b) => a.at.localeCompare(b.at));

  const messages = slack ? flatten(slack).length : 0;
  if (!messages && !landings.length) return { batch: null, path: null, reason: "nothing new" };

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
