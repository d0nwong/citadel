import type { WorktreeDiscardCounts } from "#/server/worktrees";

/**
 * Finish's confirm (CTD-224, S-43): asked only when the citadel-data worktree has uncommitted
 * changes Finish is about to sweep in and land on main (the citadel worktree is read-only and
 * never carries a change of its own, S-52, so it plays no part here). `null` means nothing to
 * confirm, so Finish runs straight through and asks nothing extra.
 */
export const finishMessage = (
  counts: WorktreeDiscardCounts | null
): string | null => {
  const citadelData = counts?.citadelData;
  if (!citadelData || citadelData.uncommitted === 0) {
    return null;
  }
  return `Commit this conversation's data to main? Its citadel-data worktree has ${citadelData.uncommitted} uncommitted change(s) it will land too.`;
};
