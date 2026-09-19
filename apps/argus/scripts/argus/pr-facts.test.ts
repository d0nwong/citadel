/**
 * The pure half of pr-facts: parsing a first-parent log into landings, ticket keys stated
 * and not guessed, and files mapped to features through the manifest's path prefixes.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { featureFiles, featuresForFiles, type Manifest } from "./manifest.ts";
import { manifestPath, projectsPath } from "./paths.ts";
import { manifestTableFor, parseLandings, ticketKeysIn } from "./pr-facts.ts";
import { defaultProjectsConfig, type ProjectsConfig } from "./projects.ts";

const RS = "\x1e", US = "\x1f";
const log = [
  ["a".repeat(40), "2026-09-10T15:07:00+01:00", "2026-09-10", "Sam O", "Merged in feature/ALD-41-due-header (pull request #421)", "Due header follows the payment term\n\nsome body"].join(US),
  ["b".repeat(40), "2026-09-09T09:00:00+01:00", "2026-09-09", "Liam Leung", "fix BR-7 typo in usage labels", ""].join(US),
].join(RS + "\n") + RS;

const apLog = [
  ["c".repeat(40), "2026-09-11T10:00:00+01:00", "2026-09-11", "Sam O", "Merged in foundry/ap-207-tab-projects-abc12345 (pull request #430)", "AP-207: tab projects\n\nsome body"].join(US),
].join(RS + "\n") + RS;

describe("parseLandings", () => {
  test("a merge carries its PR number, branch, title and ticket; a direct push is its own landing", () => {
    const [merge, direct] = parseLandings("fe", log);
    expect(merge).toMatchObject({ ref: "fe#421", number: 421, branch: "feature/ALD-41-due-header", title: "Due header follows the payment term", by: "Sam O", ticketKeys: ["ALD-41"] });
    expect(merge?.url).toBe("https://bitbucket.org/aldenstudios/alden-portal-fe/pull-requests/421");
    expect(direct).toMatchObject({ ref: `fe@${"b".repeat(9)}`, number: null, url: null, title: "fix BR-7 typo in usage labels", ticketKeys: [] });
  });
  test("an empty log is no landings", () => expect(parseLandings("be", "")).toEqual([]));
  test("CTD-199: a Foundry branch or PR title carrying AP-<n> records a landing carrying that key, as ALD-<n> does", () => {
    const [merge] = parseLandings("fe", apLog);
    expect(merge).toMatchObject({ branch: "foundry/ap-207-tab-projects-abc12345", ticketKeys: ["AP-207"] });
  });
});

describe("ticketKeysIn", () => {
  test("rule ids and http talk are not tickets", () => {
    expect(ticketKeysIn("ALD-4 fixes BR-12 and MM-3 on the API-1 path, see CTD-160 and R-2")).toEqual(["ALD-4", "CTD-160"]);
  });
  test("CTD-199: AP is a ticket, not the A- or P- prefixes NOT_A_TICKET excludes", () => {
    expect(ticketKeysIn("AP-207 tab projects, not A-2 or P-3")).toEqual(["AP-207"]);
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

describe("manifestTableFor (CTD-271, ledger S-27)", () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "argus-pr-facts-"));
    process.env.ARGUS_ROOT = ws;
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });

  test("with no projects.json, resolves alden-portal's own manifest for fe and be", async () => {
    mkdirSync(join(ws, "alden/alden-portal/.doc-workspace"), { recursive: true });
    const manifest: Manifest = { app: "alden-portal", fe_repo: "~/x", features: [{ id: "tasks", name: "Tasks", type: "feature", entry_routes: [], core_files: ["src/features/tasks"], be_files: ["src/services/taskService.ts"], aliases: [] }] };
    writeFileSync(manifestPath(), JSON.stringify(manifest));
    const fe = await manifestTableFor("fe");
    expect(featuresForFiles(["src/features/tasks/a.ts"], fe!.table, "fe")).toEqual(["tasks"]);
    const be = await manifestTableFor("be");
    expect(featuresForFiles(["src/services/taskService.ts"], be!.table, "be")).toEqual(["tasks"]);
  });

  test("null for a repo id no configured project declares", async () => {
    expect(await manifestTableFor("nope")).toBeNull();
  });

  test("a second record project's own repo id resolves through its own area and manifest", async () => {
    const config: ProjectsConfig = {
      ...defaultProjectsConfig(),
      projects: [
        ...defaultProjectsConfig().projects,
        {
          id: "citadel",
          repos: [{ id: "citadel-repo", cloneUrl: "https://example.com/citadel.git", path: "", baseBranch: "main", host: "github", deploy: { kind: "live" } }],
          trackers: [{ provider: "linear", key: "CTD", prefixes: ["CTD"] }],
          jobs: ["docs", "record"],
          areas: [{ id: "argus", repo: "citadel-repo", dir: "argus" }],
        },
      ],
    };
    writeFileSync(projectsPath(), JSON.stringify(config));
    mkdirSync(join(ws, "argus/.doc-workspace"), { recursive: true });
    const manifest: Manifest = { app: "citadel", fe_repo: "~/citadel", features: [{ id: "sweep", name: "Sweep", type: "feature", entry_routes: [], core_files: ["infra/sweep"], aliases: [] }] };
    writeFileSync(manifestPath("argus"), JSON.stringify(manifest));
    const owner = await manifestTableFor("citadel-repo");
    expect(owner).not.toBeNull();
    expect(owner!.manifest.app).toBe("citadel");
    expect(featuresForFiles(["infra/sweep/loop.sh"], owner!.table, "citadel-repo")).toEqual(["sweep"]);
  });
});
