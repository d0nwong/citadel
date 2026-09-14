import type { WorktreeDiscardCounts } from "#/server/worktrees";

/**
 * Finish's confirm (CTD-224, S-43): asked only when the citadel worktree has something Finish
 * would discard — its uncommitted or unpushed changes (citadel-data is landed on main, not
 * discarded, so it plays no part here). `null` means nothing to confirm, so Finish runs
 * straight through and asks nothing extra.
 */
export const finishMessage = (
  counts: WorktreeDiscardCounts | null
): string | null => {
  const citadel = counts?.citadel;
  if (!citadel || (citadel.uncommitted === 0 && citadel.unpushed === 0)) {
    return null;
  }
  return `Commit this conversation's data to main? Its citadel worktree discards ${citadel.uncommitted} uncommitted, ${citadel.unpushed} unpushed.`;
};
