import type { WorktreeDiscardCounts } from "#/server/worktrees";

const BASE =
  "Delete this conversation? Its file under PENSIEVE_HOME is removed.";

/**
 * Delete's confirm (CTD-223, S-44): unchanged when the thread has no worktrees to discard
 * (container mode, or before its first question); otherwise names what going with the file —
 * the citadel-data worktree's uncommitted files and commits not on main.
 */
export const discardMessage = (
  counts: WorktreeDiscardCounts | null
): string => {
  if (!counts) {
    return BASE;
  }
  const { citadelData } = counts;
  return `${BASE} Its worktrees go too — citadel-data: ${citadelData.uncommitted} uncommitted, ${citadelData.unmerged} not on main.`;
};
