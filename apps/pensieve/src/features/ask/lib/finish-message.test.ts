import { describe, expect, test } from "bun:test";
import { finishMessage } from "./finish-message";

describe("CTD-259 — finishMessage", () => {
  test("null: no worktrees, nothing to confirm", () => {
    expect(finishMessage(null)).toBeNull();
  });

  test("nothing to confirm when every changed file is on the record, even with plenty of uncommitted and unmerged activity", () => {
    expect(
      finishMessage({
        citadelData: {
          offListCommitted: [],
          offListUncommitted: [],
          uncommitted: 4,
          unmerged: 2,
        },
      })
    ).toBeNull();
  });

  test("names the uncommitted off-list files Finish drops, with their count", () => {
    const message = finishMessage({
      citadelData: {
        offListCommitted: [],
        offListUncommitted: ["SCRATCH.md", "notes.txt"],
        uncommitted: 2,
        unmerged: 0,
      },
    });
    expect(message).toContain("2 uncommitted file(s)");
    expect(message).toContain("SCRATCH.md, notes.txt");
    expect(message).not.toContain("stop Finish");
  });

  test("names the committed off-list files that stop Finish, with their count", () => {
    const message = finishMessage({
      citadelData: {
        offListCommitted: ["stray.json"],
        offListUncommitted: [],
        uncommitted: 0,
        unmerged: 1,
      },
    });
    expect(message).toContain("1 file(s)");
    expect(message).toContain("stray.json");
    expect(message).toContain("stop Finish");
  });

  test("names both lists together when the worktree has both kinds", () => {
    const message = finishMessage({
      citadelData: {
        offListCommitted: ["stray.json"],
        offListUncommitted: ["SCRATCH.md"],
        uncommitted: 1,
        unmerged: 1,
      },
    });
    expect(message).toContain("SCRATCH.md");
    expect(message).toContain("stray.json");
    expect(message).toContain("stop Finish");
  });
});
