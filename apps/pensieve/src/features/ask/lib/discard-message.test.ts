import { describe, expect, test } from "bun:test";
import { discardMessage } from "./discard-message";

describe("CTD-223 — discardMessage", () => {
  test("null: no worktrees to discard, the sentence is unchanged", () => {
    expect(discardMessage(null)).toBe(
      "Delete this conversation? Its file under PENSIEVE_HOME is removed."
    );
  });

  test("names the citadel worktree's uncommitted and unpushed changes, and citadel-data's uncommitted files and commits not on main", () => {
    const message = discardMessage({
      citadel: { uncommitted: 2, unpushed: 1 },
      citadelData: { uncommitted: 0, unmerged: 3 },
    });
    expect(message).toContain(
      "Delete this conversation? Its file under PENSIEVE_HOME is removed."
    );
    expect(message).toContain("citadel: 2 uncommitted, 1 unpushed");
    expect(message).toContain("citadel-data: 0 uncommitted, 3 not on main");
  });
});
