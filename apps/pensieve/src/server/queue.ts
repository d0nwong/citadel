/**
 * Node-only. The Needs-you queue as the home page loads it: `points.json` with `decisions/`
 * laid over it, whether Send is available, and the repos it may target (LIA-120). The token
 * never reaches the client, so the list has to travel with the points; `trackedRepos`
 * swallows its own failures, so a Foundry that cannot answer costs the page nothing but
 * the picker.
 */

import { mergeDecisions, readDecisions } from "./decisions";
import type { FoundryConfig, FoundryRepo } from "./foundry";
import { foundryConfig, trackedRepos } from "./foundry";
import type { PointsFile } from "./workspace";
import { readPoints } from "./workspace";

export interface Queue {
  file: PointsFile | null;
  foundry: FoundryConfig;
  /** What Send offers as the repo; empty when Foundry could not answer with a list. */
  repos: FoundryRepo[];
}

export async function loadQueue(): Promise<Queue> {
  const [file, onDisk, foundry, repos] = await Promise.all([
    readPoints(),
    readDecisions(),
    foundryConfig(),
    trackedRepos(),
  ]);
  return {
    file: file
      ? { ...file, points: mergeDecisions(file.points, onDisk) }
      : null,
    foundry,
    repos,
  };
}
