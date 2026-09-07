import { describe, expect, test } from "bun:test";
import type { FoundryRepo } from "#/server/foundry";
import { isPointId, pickRepo, REPO_REQUIRED } from "./points";

const repos: FoundryRepo[] = [
  { name: "argus", path: "/Users/l/git/argus" },
  { name: "pensieve", path: "/Users/l/git/pensieve" },
];

describe("isPointId", () => {
  test.each(["decide/lia-71-history-rollup", "housekeeping/a1"])(
    "%s is one",
    (id) => expect(isPointId(id)).toBe(true)
  );
  test.each(["", "decide/", "sweep/x", "decide/../etc", 7])("%p is not", (id) =>
    expect(isPointId(id)).toBe(false)
  );
});

describe("LIA-120 — the point's repo against Foundry's list", () => {
  test("AC2 — a name or a path the list carries preselects, and always as the name", () => {
    expect(pickRepo(repos, "pensieve")).toBe("pensieve");
    expect(pickRepo(repos, "/Users/l/git/argus")).toBe("argus");
    expect(pickRepo(repos, "  pensieve  ")).toBe("pensieve");
  });

  test("AC3 — no repo, or one Foundry does not track, opens with nothing selected", () => {
    expect(pickRepo(repos, undefined)).toBe("");
    expect(pickRepo(repos, "")).toBe("");
    // A near miss is still a miss: `~` is display-only on Foundry's side, and the sweep's
    // `[FE]`/`[BE]` tag can name a repo this Foundry never tracked.
    expect(pickRepo(repos, "~/git/argus")).toBe("");
    expect(pickRepo(repos, "alden-portal-fe")).toBe("");
    expect(pickRepo([], "pensieve")).toBe("");
  });

  test("the refusal names a choice, not a path to type", () => {
    expect(REPO_REQUIRED).toContain("choose one Foundry tracks");
  });
});
