/**
 * `projects.json` (CTD-265): with no file, the loader answers alden-portal's own values
 * unchanged; with one, the shape parser throws the first broken path and the policy
 * validator names every problem a well-shaped file can still have.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_APP, projectsPath } from "./paths.ts";
import { allAreas, defaultProjectsConfig, loadProjects, parseProjectsConfig, type ProjectsConfig, unheldFeatures, validateProjectsConfig } from "./projects.ts";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-projects-"));
  process.env.ARGUS_ROOT = ws;
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

/** a minimal, valid two-project config: alden-portal (unchanged) and citadel (four areas, one repo) */
function validConfig(): ProjectsConfig {
  return {
    projects: [
      {
        id: "alden-portal",
        repos: [
          { id: "fe", cloneUrl: "https://example.com/fe.git", path: "", baseBranch: "staging", host: "bitbucket", deploy: { kind: "live" } },
          { id: "be", cloneUrl: "https://example.com/be.git", path: "", baseBranch: "dev", host: "bitbucket", deploy: { kind: "pipeline" } },
        ],
        trackers: [
          { provider: "trello", key: "AP", prefixes: ["AP"] },
          { provider: "linear", key: "ALD", prefixes: ["ALD"] },
        ],
        jobs: ["docs", "record"],
        areas: [{ id: "alden-portal", repo: "fe", dir: DEFAULT_APP }],
      },
      {
        id: "citadel",
        repos: [{ id: "citadel", cloneUrl: "https://example.com/citadel.git", path: "", baseBranch: "main", host: "github", deploy: { kind: "live" } }],
        trackers: [{ provider: "linear", key: "CTD", prefixes: ["CTD"] }],
        jobs: ["docs"],
        areas: [
          { id: "argus", repo: "citadel", dir: "argus" },
          { id: "pensieve", repo: "citadel", dir: "pensieve" },
        ],
      },
    ],
    channels: [{ id: "C07KG06L601", projects: ["alden-portal"] }],
  };
}

const mkFeatureDirs = (...dirs: string[]) => {
  for (const d of dirs) mkdirSync(join(ws, d, "docs"), { recursive: true });
};

describe("loadProjects", () => {
  test("with no file, answers alden-portal's own values: one area at DEFAULT_APP, unchanged", async () => {
    const config = await loadProjects();
    expect(config).toEqual(defaultProjectsConfig());
    expect(allAreas(config)).toEqual([{ id: "alden-portal", repo: "fe", dir: DEFAULT_APP, project: "alden-portal" }]);
  });

  test("with a file, parses and returns it typed", async () => {
    writeFileSync(projectsPath(), JSON.stringify(validConfig()));
    const config = await loadProjects();
    expect(config.projects.map((p) => p.id)).toEqual(["alden-portal", "citadel"]);
  });
});

describe("parseProjectsConfig", () => {
  test("refuses a non-object, and a repo missing its clone URL, base branch or deploy source", () => {
    expect(() => parseProjectsConfig("nope")).toThrow(/projects\.json: expected an object/);
    const bad = validConfig();
    // @ts-expect-error - deliberately malformed for the test
    delete bad.projects[0]!.repos[0]!.cloneUrl;
    expect(() => parseProjectsConfig(bad)).toThrow(/repos\[0\]\.cloneUrl/);
  });

  test("refuses a job that is not docs or record, and a tracker provider that is not linear or trello", () => {
    const badJob = validConfig();
    // @ts-expect-error - deliberately malformed for the test
    badJob.projects[0]!.jobs = ["docs", "sync"];
    expect(() => parseProjectsConfig(badJob)).toThrow(/expected one of docs, record/);

    const badProvider = validConfig();
    // @ts-expect-error - deliberately malformed for the test
    badProvider.projects[0]!.trackers[0]!.provider = "jira";
    expect(() => parseProjectsConfig(badProvider)).toThrow(/expected one of linear, trello/);
  });

  test("round-trips a valid config with no problems", async () => {
    const config = parseProjectsConfig(validConfig());
    mkFeatureDirs("alden/alden-portal", "argus", "pensieve");
    expect(await validateProjectsConfig(config)).toEqual([]);
  });
});

describe("validateProjectsConfig", () => {
  test("names a duplicate project id", async () => {
    const c = validConfig();
    c.projects[1]!.id = "alden-portal";
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("alden-portal is a project id more than once"))).toBe(true);
  });

  test("names a repo id reused across projects", async () => {
    const c = validConfig();
    c.projects[1]!.repos[0]!.id = "fe";
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("fe is a repo id more than once"))).toBe(true);
  });

  test("names a duplicate area id", async () => {
    const c = validConfig();
    c.projects[1]!.areas[1]!.id = "argus";
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("argus is an area id more than once"))).toBe(true);
  });

  test("names a duplicate channel id", async () => {
    const c = validConfig();
    c.channels.push({ id: "C07KG06L601", projects: ["alden-portal"] });
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("C07KG06L601 is a channel id more than once"))).toBe(true);
  });

  test("names a channel naming an unknown project", async () => {
    const c = validConfig();
    c.channels[0]!.projects = ["nope"];
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("nope is not a project in this config"))).toBe(true);
  });

  test("names a channel naming a project without the record job", async () => {
    const c = validConfig();
    c.channels[0]!.projects = ["citadel"];
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("citadel does not have the record job"))).toBe(true);
  });

  test("names two areas sharing a data directory", async () => {
    const c = validConfig();
    c.projects[1]!.areas[1]!.dir = "argus";
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes('two areas share the data directory "argus"'))).toBe(true);
  });

  test("names an area whose data directory does not exist", async () => {
    const c = validConfig();
    mkFeatureDirs("alden/alden-portal"); // "argus" and "pensieve" left missing
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes('argus: data directory "argus" does not exist'))).toBe(true);
    expect(problems.some((p) => p.rule.includes('pensieve: data directory "pensieve" does not exist'))).toBe(true);
  });

  test("names an area whose repo its project does not declare", async () => {
    const c = validConfig();
    mkFeatureDirs("alden/alden-portal", "argus", "pensieve");
    c.projects[1]!.areas[0]!.repo = "be"; // "be" belongs to alden-portal, not citadel
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes("argus: repo be is not declared by citadel"))).toBe(true);
  });

  test("names a key prefix no ticket provider owns", async () => {
    const c = validConfig();
    mkFeatureDirs("alden/alden-portal", "argus", "pensieve");
    c.projects[1]!.trackers[0]!.prefixes = ["ZZZ"];
    const problems = await validateProjectsConfig(c);
    expect(problems.some((p) => p.rule.includes('no ticket provider owns the prefix "ZZZ"'))).toBe(true);
  });
});

describe("unheldFeatures", () => {
  test("empty for the default config, since DEFAULT_APP is always held", async () => {
    mkFeatureDirs("alden/alden-portal/features/tasks");
    expect(await unheldFeatures(defaultProjectsConfig())).toEqual([]);
  });

  test("names a feature directory under an app no area's dir names", async () => {
    mkFeatureDirs("alden/alden-portal/features/tasks", "foundry/features/jobs");
    const config = defaultProjectsConfig(); // only alden-portal's area; foundry is unheld
    expect(await unheldFeatures(config)).toEqual([{ app: "foundry", feature: "jobs" }]);
  });
});
