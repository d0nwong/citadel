/**
 * Node-only. The checks behind a verdict on a Needs-you point, in one place: what
 * `decidePoint` and `sendPoint` ask before they write, and what the bridged
 * `propose_decision` tool asks before it answers a proposal (LIA-111).
 *
 * One set of checks means one set of error strings — the sentence Ask reports when a
 * proposal is refused is the sentence the Points page would have shown for the same
 * verdict. Nothing here writes: the writers keep the write, the tool keeps nothing.
 *
 * The readers are injected (`VerdictSources`) rather than imported at the call site, so a
 * test can point them at a temp `decisions/` directory without mutating `WORKSPACE_DIR` —
 * `bun test` shares one module registry across files, so an env override there would leak.
 */

import { isPointId } from "../lib/points";
import type { Decision } from "./decisions";
import { DECISIONS_DIR, readDecision } from "./decisions";
import type { FoundryConfig } from "./foundry";
import type { Point, PointsFile } from "./workspace";
import { readPoints } from "./workspace";

export type VerdictAction = "ignored" | "sent";

/** Where the checks read from. Defaults to the workspace on disk. */
export interface VerdictSources {
  decisionsDir: string;
  foundry: () => Promise<FoundryConfig>;
  readPoints: () => Promise<PointsFile | null>;
}

/**
 * Foundry is imported lazily: `foundry.ts` reads `FOUNDRY_URL` at module load, so pulling
 * it in through this chain would fix that value before a caller that sets it has run.
 */
export const workspaceSources = (): VerdictSources => ({
  decisionsDir: DECISIONS_DIR,
  foundry: async () => (await import("./foundry")).foundryConfig(),
  readPoints,
});

/**
 * Why the verdict cannot be given. `decision` is set when the blocker is a file already on
 * disk — the one case the two writers treat differently: `decidePoint` refuses, `sendPoint`
 * replays it (a retry after a timeout that did in fact land must not ask Foundry again),
 * and the tool refuses so no second Confirm is ever offered.
 */
export interface Blocked {
  decision?: Decision;
  error: string;
  ok: false;
}

export type IgnoreCheck = { ok: true; point: Point; reason: string } | Blocked;
export type SendCheck =
  | { ok: true; point: Point; repo: string; ticket: string }
  | Blocked;
export type VerdictCheck = IgnoreCheck | SendCheck;

const trimmed = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** The point id and the record behind it, or why neither is usable. */
async function locate(
  pointId: string,
  sources: VerdictSources
): Promise<{ ok: true; point: Point } | Blocked> {
  if (!isPointId(pointId)) {
    return { error: `"${pointId}" is not a point id`, ok: false };
  }
  const file = await sources.readPoints();
  const point = file?.points.find((p) => p.id === pointId);
  if (!point) {
    return { error: "that point is not in reports/points.json", ok: false };
  }
  return { ok: true, point };
}

/** The file already on disk for that point, as a blocker. */
async function decided(
  pointId: string,
  sources: VerdictSources
): Promise<Blocked | null> {
  const decision = await readDecision(pointId, sources.decisionsDir);
  return decision
    ? {
        decision,
        error: `already ${decision.action} on ${when(decision.at)}`,
        ok: false,
      }
    : null;
}

/** What `decidePoint` asks before it writes `action: "ignored"`. */
export async function checkIgnore(
  pointId: string,
  reason: string,
  sources: VerdictSources = workspaceSources()
): Promise<IgnoreCheck> {
  const why = trimmed(reason);
  if (!isPointId(pointId)) {
    return { error: `"${pointId}" is not a point id`, ok: false };
  }
  if (!why) {
    return { error: "a reason is required to ignore a point", ok: false };
  }
  const found = await locate(pointId, sources);
  if (!found.ok) {
    return found;
  }
  return (
    (await decided(pointId, sources)) ?? {
      ok: true,
      point: found.point,
      reason: why,
    }
  );
}

/**
 * What `sendPoint` asks before it reaches Foundry. The repo falls back to the point's own
 * (which is what the Points page prefills), so a verdict that names no repo still resolves
 * — hence the repo check sits after the point lookup rather than before it.
 *
 * `repoRequired: false` is the proposal's reading of the same checks: the Points page
 * offers Send on any ticketed point and collects the repo in its form, and a card must be
 * able to do the same. Only the write insists on one — no point in the sweep's `points.json`
 * carries a `repo` today, so a proposal that demanded one could never be made.
 */
export async function checkSend(
  pointId: string,
  repo: string,
  sources: VerdictSources = workspaceSources(),
  opts: { repoRequired?: boolean } = {}
): Promise<SendCheck> {
  const found = await locate(pointId, sources);
  if (!found.ok) {
    return found;
  }
  const { point } = found;
  if (!point.ticket) {
    return {
      error:
        "that point names no ticket — file one first (the sweep's ticket pass)",
      ok: false,
    };
  }
  const where = trimmed(repo) || trimmed(point.repo);
  if (!where && opts.repoRequired !== false) {
    return {
      error: "a repo is required — a path Foundry tracks, or its name",
      ok: false,
    };
  }
  const already = await decided(pointId, sources);
  if (already) {
    return already;
  }
  const foundry = await sources.foundry();
  if (!foundry.configured) {
    return { error: foundry.reason ?? "Foundry is not configured", ok: false };
  }
  return { ok: true, point, repo: where, ticket: point.ticket };
}

/**
 * Either check, by action — what the bridged tool calls, which knows the action only at
 * runtime. A proposal is not a write, so the repo may still be missing here.
 */
export function checkVerdict(
  pointId: string,
  action: VerdictAction,
  input: { reason?: string; repo?: string } = {},
  sources: VerdictSources = workspaceSources()
): Promise<VerdictCheck> {
  return action === "ignored"
    ? checkIgnore(pointId, input.reason ?? "", sources)
    : checkSend(pointId, input.repo ?? "", sources, { repoRequired: false });
}
