import type { WorktreeDiscardCounts } from "#/server/worktrees";

/**
 * Finish's confirm (CTD-224, CTD-259, S-61): named off the citadel-data worktree's off-list
 * files, classified by `argus save --dry-run` — an uncommitted one Finish drops rather than
 * landing, a committed one stops Finish outright (S-58) — each named with its count. A file on
 * the record is not named here even when it is uncommitted, since Finish lands it same as
 * always. `null` means neither list has anything, so Finish runs straight through and asks
 * nothing extra, as before this ticket.
 */
export const finishMessage = (
  counts: WorktreeDiscardCounts | null
): string | null => {
  const citadelData = counts?.citadelData;
  if (!citadelData) {
    return null;
  }
  const { offListCommitted, offListUncommitted } = citadelData;
  if (offListUncommitted.length === 0 && offListCommitted.length === 0) {
    return null;
  }
  const parts: string[] = [];
  if (offListUncommitted.length > 0) {
    parts.push(
      `Finish will drop ${offListUncommitted.length} uncommitted file(s) outside the record: ${offListUncommitted.join(", ")}.`
    );
  }
  if (offListCommitted.length > 0) {
    parts.push(
      `This conversation's branch already committed ${offListCommitted.length} file(s) outside the record, which will stop Finish: ${offListCommitted.join(", ")}.`
    );
  }
  return `Commit this conversation's data to main? ${parts.join(" ")}`;
};
