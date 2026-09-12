/**
 * The pure half of pr-facts: parsing a first-parent log into landings, ticket keys stated
 * and not guessed, and files mapped to features through the manifest's path prefixes.
 */

import { describe, expect, test } from "bun:test";
import { featureFiles, featuresForFiles, type Manifest } from "./manifest.ts";
import { parseLandings, ticketKeysIn } from "./pr-facts.ts";

const RS = "\x1e", US = "\x1f";
const log = [
  ["a".repeat(40), "2026-09-10T15:07:00+01:00", "2026-09-10", "Sam O", "Merged in feature/ALD-41-due-header (pull request #421)", "Due header follows the payment term\n\nsome body"].join(US),
  ["b".repeat(40), "2026-09-09T09:00:00+01:00", "2026-09-09", "Liam Leung", "fix BR-7 typo in usage labels", ""].join(US),
].join(RS + "\n") + RS;

describe("parseLandings", () => {
  test("a merge carries its PR number, branch, title and ticket; a direct push is its own landing", () => {
    const [merge, direct] = parseLandings("fe", log);
    expect(merge).toMatchObject({ ref: "fe#421", number: 421, branch: "feature/ALD-41-due-header", title: "Due header follows the payment term", by: "Sam O", ticketKeys: ["ALD-41"] });
    expect(merge?.url).toBe("https://bitbucket.org/aldenstudios/alden-portal-fe/pull-requests/421");
    expect(direct).toMatchObject({ ref: `fe@${"b".repeat(9)}`, number: null, url: null, title: "fix BR-7 typo in usage labels", ticketKeys: [] });
  });
  test("an empty log is no landings", () => expect(parseLandings("be", "")).toEqual([]));
});

describe("ticketKeysIn", () => {
  test("rule ids and http talk are not tickets", () => {
    expect(ticketKeysIn("ALD-4 fixes BR-12 and MM-3 on the API-1 path, see CTD-160 and R-2")).toEqual(["ALD-4", "CTD-160"]);
  });
});

describe("featuresForFiles", () => {
  const manifest: Manifest = {
    app: "alden-portal",
    fe_repo: "~/x",
    features: [
      { id: "admin-usage", name: "Admin Usage", type: "feature", entry_routes: [], core_files: ["src/features/usage", "src/lib/roles.ts"], core_files_extra: ["src/components/capacity-ring.tsx"], be_files: ["src/services/historyService.ts"], aliases: [] },
      { id: "admin", name: "Admin", type: "feature", entry_routes: [], core_files: ["src/lib/roles.ts"], aliases: [] },
      { id: "shared-hooks", name: "Shared Hooks", type: "shared", entry_routes: [], core_files: ["src/hooks"], aliases: [] },
      { id: "tasks", name: "Tasks", type: "feature", dir: "tasks", entry_routes: [], core_files: ["src/features/tasks"], be_files: ["src/services/taskService.ts"], aliases: [] },
    ],
  };
  const table = featureFiles(manifest);

  test("directories match by prefix, files exactly, most hits first, nested dirs named as dirs", () => {
    expect(featuresForFiles(["src/features/usage/a.ts", "src/features/usage/b.ts", "src/lib/roles.ts"], table, "fe")).toEqual(["admin/usage", "admin"]);
    expect(featuresForFiles(["src/hooks/use-x.ts"], table, "fe")).toEqual(["shared/hooks"]);
    expect(featuresForFiles(["src/features/usage-extra/a.ts"], table, "fe")).toEqual([]);
    expect(featuresForFiles(["src/components/capacity-ring.tsx"], table, "fe")).toEqual(["admin/usage"]);
  });
  test("a file four or more features list is shared and yields to a feature's own file", () => {
    const wide: Manifest = { ...manifest, features: [
      ...manifest.features,
      { id: "a", name: "A", type: "feature", entry_routes: [], core_files: [], be_files: ["src/config/swaggerSchemas.ts"], aliases: [] },
      { id: "b", name: "B", type: "feature", entry_routes: [], core_files: [], be_files: ["src/config/swaggerSchemas.ts"], aliases: [] },
      { id: "c", name: "C", type: "feature", entry_routes: [], core_files: [], be_files: ["src/config/swaggerSchemas.ts"], aliases: [] },
      { id: "d", name: "D", type: "feature", entry_routes: [], core_files: [], be_files: ["src/config/swaggerSchemas.ts", "src/services/dService.ts"], aliases: [] },
    ] };
    const t = featureFiles(wide);
    expect(featuresForFiles(["src/config/swaggerSchemas.ts", "src/services/dService.ts"], t, "be")).toEqual(["d"]);
    expect(featuresForFiles(["src/config/swaggerSchemas.ts"], t, "be")).toEqual(["a", "b", "c", "d"]);
    expect(featuresForFiles(["src/services/taskService.ts", "src/config/swaggerSchemas.ts"], t, "be")).toEqual(["tasks"]);
  });
  test("backend files use be_files", () => {
    expect(featuresForFiles(["src/services/taskService.ts", "src/services/other.ts"], table, "be")).toEqual(["tasks"]);
    expect(featuresForFiles(["src/services/taskService.ts"], table, "fe")).toEqual([]);
  });
});
