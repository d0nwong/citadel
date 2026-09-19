/**
 * `featureFiles`/`featuresForFiles`, generalized to key the table by a project's own repo
 * ids (CTD-271, ledger S-27): defaulting to alden-portal's "fe"/"be" so every existing
 * caller sees exactly what it did before, and working the same way for a second project's
 * own repo id, single-repo areas included.
 */

import { describe, expect, test } from "bun:test";
import { featureFiles, featuresForFiles, type Manifest } from "./manifest.ts";

describe("featureFiles / featuresForFiles", () => {
  const manifest: Manifest = {
    app: "alden-portal",
    fe_repo: "~/x",
    features: [
      { id: "admin-usage", name: "Admin Usage", type: "feature", entry_routes: [], core_files: ["src/features/usage"], be_files: ["src/services/usageService.ts"], aliases: [] },
      { id: "tasks", name: "Tasks", type: "feature", dir: "tasks", entry_routes: [], core_files: ["src/features/tasks"], be_files: ["src/services/taskService.ts"], aliases: [] },
    ],
  };

  test("with no repos given, keys the table fe/be — byte-identical to every caller from before this feature", () => {
    const table = featureFiles(manifest);
    expect(featuresForFiles(["src/features/usage/a.ts"], table, "fe")).toEqual(["admin/usage"]);
    expect(featuresForFiles(["src/services/taskService.ts"], table, "be")).toEqual(["tasks"]);
    expect(featuresForFiles(["src/services/taskService.ts"], table, "fe")).toEqual([]);
  });

  test("a second project's own repo id keys the table the same way", () => {
    const table = featureFiles(manifest, { fe: "web", be: "api" });
    expect(featuresForFiles(["src/features/usage/a.ts"], table, "web")).toEqual(["admin/usage"]);
    expect(featuresForFiles(["src/services/taskService.ts"], table, "api")).toEqual(["tasks"]);
    // the alden-portal-shaped literal "fe"/"be" no longer matches once the project has its own ids
    expect(featuresForFiles(["src/features/usage/a.ts"], table, "fe")).toEqual([]);
  });

  test("a single-repo project (no be side) maps every file through its one repo id", () => {
    const singleRepo: Manifest = { app: "citadel", fe_repo: "~/citadel", features: [
      { id: "sweep", name: "Sweep", type: "feature", entry_routes: [], core_files: ["infra/sweep"], aliases: [] },
    ] };
    const table = featureFiles(singleRepo, { fe: "citadel-repo" });
    expect(featuresForFiles(["infra/sweep/loop.sh"], table, "citadel-repo")).toEqual(["sweep"]);
    expect(featuresForFiles(["infra/sweep/loop.sh"], table, "be")).toEqual([]);
  });
});
