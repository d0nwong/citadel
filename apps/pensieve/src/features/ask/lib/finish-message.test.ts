import { describe, expect, test } from "bun:test";
import { finishMessage } from "./finish-message";

describe("CTD-224 — finishMessage", () => {
  test("null: no worktrees, nothing to confirm", () => {
    expect(finishMessage(null)).toBeNull();
  });

  test("citadel clean: nothing to confirm, even with citadel-data commits pending", () => {
    expect(
      finishMessage({
        citadel: { uncommitted: 0, unpushed: 0 },
        citadelData: { uncommitted: 4, unmerged: 2 },
      })
    ).toBeNull();
  });

  test("names the citadel worktree's uncommitted and unpushed changes Finish discards", () => {
    const message = finishMessage({
      citadel: { uncommitted: 2, unpushed: 1 },
      citadelData: { uncommitted: 0, unmerged: 3 },
    });
    expect(message).toContain("citadel worktree discards");
    expect(message).toContain("2 uncommitted, 1 unpushed");
  });
});
