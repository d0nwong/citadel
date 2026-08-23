/**
 * Recall guard for `accio`.
 *
 * Every lookup case is a question in the words it would actually be asked. Recall
 * degrades silently — a wrong answer looks exactly like a right one until someone checks
 * a specific question — so add a case here whenever a real question misses.
 *
 * Unit cases cover the measured invariants: orval naming, spec extraction, diffing.
 *
 *   bun test scripts/accio.test.ts        (needs .state/accio-index.json — run sync first)
 */

import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import { orvalName, extractSwaggerDoc, flatten, indexOps, fingerprintOf, diffSpec, normPath } from "./lib/spec.ts";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
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

  test("every spec op derives a unique name", async () => {
    const doc = await Bun.file(`${ROOT}/.state/openapi.json`).json();
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
  test("fingerprint changes when a body field changes, not when description prose does", async () => {
    const doc = await Bun.file(`${ROOT}/.state/openapi.json`).json();
    const op = flatten(doc).find(o => o.body.length)!;
    const fp = fingerprintOf(op);
    expect(fingerprintOf({ ...op, description: op.description + " reworded" })).toBe(fp);
    expect(fingerprintOf({ ...op, body: [...op.body.slice(1)] })).not.toBe(fp);
  });
  test("added/removed/changed partition", async () => {
    const doc = await Bun.file(`${ROOT}/.state/openapi.json`).json();
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

describe("component lookup (derived layers — no curation yet)", () => {
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

describe("reverse lookup", () => {
  test("endpoint → which feature calls it", async () => {
    const out = await accio("tasks/{taskId}/status", "--endpoints");
    expect(out).toContain("PUT /api/v1/tasks/{taskId}/status/{status}");
    expect(out).toContain("called by:");
  });
});

describe("scoping", () => {
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
  test("every arch doc has frontmatter routing keys and the required headings", async () => {
    const dir = `${ROOT}/alden/alden-portal/features`;
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

  test("audit is clean on freshly generated docs", async () => {
    const out = await $`bun ${ROOT}/scripts/accio.ts audit`.nothrow().quiet();
    expect(out.exitCode).toBe(0);
  });

  test("audit validates journal entries and catches a missed refresh", async () => {
    const { auditJournal } = await import("./commands/audit.ts");
    const index = await Bun.file(`${ROOT}/.state/accio-index.json`).json();
    const dir = `${ROOT}/.state/test-audit-journal`;
    await Bun.write(`${dir}/2026-08-20-good.md`, [
      "---", "date: 2026-08-20", 'source: "meeting"', "ticket: ALD-42",
      "features: [tasks]", "scope: product", "status: decided",
      "summary: something agreed", "---", "Details.",
    ].join("\n"));
    await Bun.write(`${dir}/2026-08-21-bad.md`, [
      "---", "date: 2026-08-21", "ticket: not a ticket",
      "features: [no-such-feature]", "status: shipped", "summary: x", "---",
    ].join("\n"));
    // implemented BEFORE the feature's product doc was last re-verified → missed by refresh
    await Bun.write(`${dir}/2026-08-01-missed.md`, [
      "---", "date: 2026-08-01", "features: [admin-signals]", "scope: product",
      "status: implemented", "summary: y", "---",
    ].join("\n"));
    const problems = await auditJournal(index, dir);
    expect(problems.some(x => x.includes("good"))).toBe(false);
    expect(problems.some(x => x.includes("bad") && x.includes("unknown feature"))).toBe(true);
    expect(problems.some(x => x.includes("bad") && x.includes("status"))).toBe(true);
    expect(problems.some(x => x.includes("bad") && x.includes("ticket"))).toBe(true);
    expect(problems.some(x => x.includes("missed") && x.includes("refresh missed"))).toBe(true);
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("audit catches prose drift: endpoints not in spec, or not called by the feature", async () => {
    const { auditDocs } = await import("./commands/audit.ts");
    const index = await Bun.file(`${ROOT}/.state/accio-index.json`).json();
    const dir = `${ROOT}/.state/test-audit-docs`;
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
