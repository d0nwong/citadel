import { describe, expect, test } from "bun:test";
import { finishMessage } from "./finish-message";

describe("CTD-224 — finishMessage", () => {
  test("null: no worktrees, nothing to confirm", () => {
    expect(finishMessage(null)).toBeNull();
  });

  test("nothing to confirm when citadel-data has no uncommitted changes, even with commits not on main", () => {
    expect(
      finishMessage({
        citadelData: { uncommitted: 0, unmerged: 2 },
      })
    ).toBeNull();
  });

  test("names the citadel-data worktree's uncommitted changes Finish is about to land", () => {
    const message = finishMessage({
      citadelData: { uncommitted: 2, unmerged: 3 },
    });
    expect(message).toContain("citadel-data worktree");
    expect(message).toContain("2 uncommitted");
  });
});
