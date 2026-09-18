import { describe, expect, test } from "bun:test";
import { discardMessage } from "./discard-message";

describe("CTD-223 — discardMessage", () => {
  test("null: no worktrees to discard, the sentence is unchanged", () => {
    expect(discardMessage(null)).toBe(
      "Delete this conversation? Its file under PENSIEVE_HOME is removed."
    );
  });

  test("names the citadel-data worktree's uncommitted files and commits not on main", () => {
    const message = discardMessage({
      citadelData: { uncommitted: 0, unmerged: 3 },
    });
    expect(message).toContain(
      "Delete this conversation? Its file under PENSIEVE_HOME is removed."
    );
    expect(message).toContain("citadel-data: 0 uncommitted, 3 not on main");
  });
});
