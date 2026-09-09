/**
 * Node-only. The Needs-you queue as the home page loads it: `points.json` with `decisions/`
 * laid over it, whether Send is available, and the repos it may target (LIA-120). The token
 * never reaches the client, so the list has to travel with the points; `trackedRepos`
 * swallows its own failures, so a Foundry that cannot answer costs the page nothing but
 * the picker.
 */

import { byLastRewrite } from "../lib/arcs";
import { mergeDecisions, readDecisions } from "./decisions";
import type { FoundryConfig, FoundryRepo } from "./foundry";
import { foundryConfig, trackedRepos } from "./foundry";
import type { ArcMeta, PointsFile } from "./workspace";
import { listArcs, readPoints } from "./workspace";

export interface Queue {
  /** The open arcs, newest rewrite first — the headings the queue groups under (LIA-149). */
  arcs: ArcMeta[];
  file: PointsFile | null;
  foundry: FoundryConfig;
  /** What Send offers as the repo; empty when Foundry could not answer with a list. */
  repos: FoundryRepo[];
}

/** Open arcs, last rewrite first — the one order the index and the queue's headings share. */
export const openArcsFirst = (arcs: ArcMeta[]): ArcMeta[] =>
  arcs.filter((a) => a.status === "open").sort(byLastRewrite);

export async function loadQueue(): Promise<Queue> {
  const [file, onDisk, foundry, repos, arcs] = await Promise.all([
    readPoints(),
    readDecisions(),
    foundryConfig(),
    trackedRepos(),
    listArcs(),
  ]);
  return {
    arcs: openArcsFirst(arcs),
    file: file
      ? { ...file, points: mergeDecisions(file.points, onDisk) }
      : null,
    foundry,
    repos,
  };
}
