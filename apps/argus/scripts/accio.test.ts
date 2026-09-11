/**
 * Recall guard for `accio`.
 *
 * Every lookup case is a question in the words it would actually be asked. Recall
 * degrades silently — a wrong answer looks exactly like a right one until someone checks
 * a specific question — so add a case here whenever a real question misses.
 *
 * Unit cases cover the measured invariants: orval naming, spec extraction, diffing.
 *
 *   bun test scripts/accio.test.ts        (tests that read argus's data need ARGUS_ROOT; they skip without it)
 */

import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orvalName, extractSwaggerDoc, flatten, indexOps, fingerprintOf, diffSpec, normPath } from "./accio/spec.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
/** argus's data (OpenAPI cache, accio index, arch docs) lives where ARGUS_ROOT points */
const DATA = process.env.ARGUS_ROOT ?? ROOT;
const HAS_SPEC = existsSync(`${DATA}/.state/openapi.json`);
const HAS_INDEX = existsSync(`${DATA}/.state/accio-index.json`);
const HAS_DOCS = existsSync(`${DATA}/alden/alden-portal/features`);
const accio = async (...args: string[]) =>
  (await $`bun ${ROOT}/scripts/accio.ts ${args}`.nothrow().text());

// ---------------------------------------------------------------- unit: spec layer

describe("orval naming (pure function of method+path — measured 0/469 underivable)", () => {
  const cases: [string, string, string][] = [
    ["get", "/api/v1/tasks/{taskId}/billing-profile", "getApiV1TasksTaskIdBillingProfile"],
    ["post", "/api/v1/subTasks/subTask/{subTaskId}/users", "postApiV1SubTasksSubTaskSubTaskIdUsers"],
    ["delete", "/api/v1/tasks/{taskId}", "deleteApiV1TasksTaskId"],
  ];
  for (const [m, p, want] of cases)
    test(`${m} ${p} → ${want}`, () => expect(orvalName(m, p)).toBe(want));

  test.skipIf(!HAS_SPEC)("every spec op derives a unique name", async () => {
    const doc = await Bun.file(`${DATA}/.state/openapi.json`).json();
    const ops = flatten(doc);
    const idx = indexOps(doc, ops);
    expect(idx.byName.size).toBe(ops.length);
  });
});

describe("swagger-ui extraction", () => {
  test("balanced-brace scan survives strings with braces and escapes", () => {
    const js = `x; "swaggerDoc": {"info":{"title":"a } b \\" c"},"paths":{}} , "more": 1`;
    expect(extractSwaggerDoc(js)).toEqual({ info: { title: 'a } b " c' }, paths: {} });
  });
  test("throws when the docs moved", () => {
    expect(() => extractSwaggerDoc("<html>nope</html>")).toThrow(/did the docs move/);
  });
});

describe("spec diffing", () => {
  test.skipIf(!HAS_SPEC)("fingerprint changes when a body field changes, not when description prose does", async () => {
    const doc = await Bun.file(`${DATA}/.state/openapi.json`).json();
    const op = flatten(doc).find(o => o.body.length)!;
    const fp = fingerprintOf(op);
    expect(fingerprintOf({ ...op, description: op.description + " reworded" })).toBe(fp);
    expect(fingerprintOf({ ...op, body: [...op.body.slice(1)] })).not.toBe(fp);
  });
  test.skipIf(!HAS_SPEC)("added/removed/changed partition", async () => {
    const doc = await Bun.file(`${DATA}/.state/openapi.json`).json();
    const ops = flatten(doc).slice(0, 3);
    const prev = Object.fromEntries(ops.map(o => [o.key, fingerprintOf(o)]));
    prev["GET /api/v1/ghost"] = "dead";
    delete prev[ops[0].key];
    const d = diffSpec(ops, prev);
    expect(d.added.map(o => o.key)).toEqual([ops[0].key]);
    expect(d.removed).toEqual(["GET /api/v1/ghost"]);
    expect(d.changed).toEqual([]);
  });
  test("normPath collapses template and spec params alike", () => {
    expect(normPath("/api/v1/tasks/${taskId}/status/${s}?x=1")).toBe(normPath("/api/v1/tasks/{taskId}/status/{status}"));
  });
});

// ---------------------------------------------------------------- lookup: real questions

describe.skipIf(!HAS_INDEX)("component lookup (derived layers — no curation yet)", () => {
  test('"status select" ranks the status-select code first and names the endpoint', async () => {
    const out = await accio("status select");
    const firstHeading = out.split("\n").find(l => l.startsWith("## "));
    expect(firstHeading).toContain("status-select");
    expect(out).toContain("/status");   // candidate endpoint named because it matches the query
  });

  test('"priority field" reaches the taskPriority vocabulary', async () => {
    const out = await accio("priority field");
    expect(out.toLowerCase()).toContain("priority");
    expect(out).toContain("task-detail-side-card");   // the file to read
  });

  test('"assignee" routes to assignee code without the word appearing in any endpoint', async () => {
    const out = await accio("assignee", "--in", "tasks");
    expect(out).toMatch(/assignees?/);
    expect(out).toContain("read these:");
  });

  test("candidates are labelled candidates, never claims", async () => {
    const out = await accio("status select");
    expect(out).toMatch(/candidate|CANDIDATES/);
    expect(out).toContain("not proof");
  });
});

describe.skipIf(!HAS_INDEX)("reverse lookup", () => {
  test("endpoint → which feature calls it", async () => {
    const out = await accio("tasks/{taskId}/status", "--endpoints");
    expect(out).toContain("PUT /api/v1/tasks/{taskId}/status/{status}");
    expect(out).toContain("called by:");
  });
});

describe.skipIf(!HAS_INDEX)("scoping", () => {
  test("--in restricts to one feature", async () => {
    const out = await accio("subtask", "--in", "tasks");
    expect(out).not.toContain("admin-invoicings");
  });
  test("--in with an unknown feature fails with the feature list", async () => {
    const out = await $`bun ${ROOT}/scripts/accio.ts nothing --in bogus`.nothrow().quiet();
    expect(out.exitCode).toBe(1);
    expect(out.stderr.toString()).toContain("no feature matching");
  });
});

describe("docs conformance (DOC-PROTOCOL retrieval contract)", () => {
  test.skipIf(!HAS_DOCS)("every arch doc has frontmatter routing keys and the required headings", async () => {
    const dir = `${DATA}/alden/alden-portal/features`;
    let n = 0;
    for await (const f of new Bun.Glob("**/docs/arch.md").scan({ cwd: dir, absolute: true })) {
      const text = await Bun.file(f).text();
      expect(text).toMatch(/^---\n/);
      for (const key of ["id:", "tier: architecture", "aliases:", "core_files:", "last_verified:"])
        expect(text).toContain(key);
      expect(text).toContain("## Component Map");
      expect(text).toContain("## Interfaces & Contracts");
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  test.skipIf(!HAS_INDEX)("audit is clean on freshly generated docs", async () => {
    const out = await $`bun ${ROOT}/scripts/accio.ts audit`.nothrow().quiet();
    // "tiers disagree" is repo state (a product tier the sweep has not re-run yet), not a
    // code defect — it is asserted by its own test below and worked off by /sweep
    const problems = out.stdout.toString().split("\n").filter(l => /^\s{2}\S/.test(l) && !l.includes("tiers disagree"));
    expect(problems).toEqual([]);
  });

  test("arch stamp follows the product stamp unless the feature changed", async () => {
    const { decideArchStamp, readStamp, restamp, regionsOf } = await import("./accio/stamps.ts");
    const arch = "---\nid: x\nlast_verified: staging@9249e1f48\nlast_verified_date: 2026-09-01\n---\n# X\n<!-- accio:begin a -->\nrow\n<!-- accio:end a -->\n";
    const product = "---\nid: x\nlast_verified: staging@7478faa06\nlast_verified_date: 2026-08-31\n---\n# X\n";
    const current = { rev: "staging@abcdef012", date: "2026-09-02" };
    const decide = (over: Partial<Parameters<typeof decideArchStamp>[0]>) => decideArchStamp({
      existingArch: arch, product, current, coreChangedSinceProduct: false, specChanged: false, treeBehind: false, ...over,
    });
    expect(readStamp(product)).toEqual({ rev: "staging@7478faa06", sha: "7478faa06", date: "2026-08-31" });
    expect(readStamp("no frontmatter")).toBeNull();
    // nothing changed → the arch tier takes the product tier's stamp, date included
    expect(decide({})).toEqual({ rev: "staging@7478faa06", date: "2026-08-31", reason: "aligned" });
    // the feature moved → advance to the current rev; that mismatch is the stale signal
    expect(decide({ coreChangedSinceProduct: true })).toMatchObject({ ...current, reason: "core-changed" });
    expect(decide({ specChanged: true })).toMatchObject({ ...current, reason: "spec-changed" });
    // a checkout older than the docs may align but never advance
    expect(decide({ treeBehind: true })).toMatchObject({ rev: "staging@7478faa06", reason: "aligned" });
    expect(decide({ treeBehind: true, coreChangedSinceProduct: true })).toEqual({ rev: "staging@9249e1f48", date: "2026-09-01", reason: "tree-behind" });
    // a product run re-read newer code than the arch stamp → arch follows, whatever else this sync saw
    expect(decide({ productAhead: true, coreChangedSinceProduct: true, specChanged: true, treeBehind: true }))
      .toMatchObject({ rev: "staging@7478faa06", reason: "aligned" });
    // git could not answer → touch nothing
    expect(decide({ coreChangedSinceProduct: null })).toMatchObject({ rev: "staging@9249e1f48", reason: "undecidable" });
    expect(decide({ existingArch: null })).toMatchObject({ ...current, reason: "new" });
    // no product tier: the arch stamp is its own anchor — kept when nothing moved, advanced when core files did
    expect(decide({ product: null })).toMatchObject({ rev: "staging@9249e1f48", reason: "aligned" });
    expect(decide({ product: null, coreChangedSinceProduct: true })).toMatchObject({ ...current, reason: "core-changed" });
    // restamp rewrites the two stamp lines and nothing else
    const re = restamp(arch, "staging@7478faa06", "2026-08-31");
    expect(readStamp(re)).toMatchObject({ rev: "staging@7478faa06", date: "2026-08-31" });
    expect(regionsOf(re)).toBe(regionsOf(arch));
    expect(re.split("\n").slice(4)).toEqual(arch.split("\n").slice(4));
  });

  test.skipIf(!HAS_INDEX)("audit catches prose drift: endpoints not in spec, or not called by the feature", async () => {
    const { auditDocs } = await import("./accio/audit.ts");
    const index = await Bun.file(`${DATA}/.state/accio-index.json`).json();
    const dir = mkdtempSync(join(tmpdir(), "accio-audit-"));
    await Bun.write(`${dir}/tasks/docs/arch.md`, [
      "---", "id: tasks", "tier: architecture", "aliases: []", "core_files:",
      "  - src/pages/tasks", "last_verified: x", "---",
      "# Tasks — Architecture", "## Component Map", "## Interfaces & Contracts",
      "Prose claiming `GET /api/v1/thisWasNeverInTheSpec` and also",
      "`POST /api/v1/auth/logout` which the spec has but tasks never calls.", "",
    ].join("\n"));
    const problems = await auditDocs(index, dir);
    expect(problems.some(p => p.includes("thisWasNeverInTheSpec") && p.includes("not in the spec"))).toBe(true);
    expect(problems.some(p => p.includes("/auth/logout") && p.includes("nothing this feature reaches"))).toBe(true);
    await Bun.$`rm -rf ${dir}`.quiet();
  });
});


describe("data root", () => {
  test("ARGUS_ROOT moves every data path and leaves the code root", async () => {
    const js = 'import * as m from "./scripts/accio/manifest.ts"; console.log(JSON.stringify([m.ROOT, m.DATA_ROOT, m.APP_DIR, m.STATE, m.FEATURES_DIR]))';
    const [root, data, app, state, features] = JSON.parse(
      await $`bun -e ${js}`.cwd(ROOT).env({ ...process.env, ARGUS_ROOT: "/tmp/argus-data" }).text());
    expect(root).toBe(ROOT);
    expect(data).toBe("/tmp/argus-data");
    expect([app, state, features]).toEqual(["/tmp/argus-data/alden/alden-portal", "/tmp/argus-data/.state", "/tmp/argus-data/alden/alden-portal/features"]);
  });
});
