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
import { existsSync } from "node:fs";
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

  test("audit validates per-feature journal entries and catches a missed refresh", async () => {
    const { auditJournal } = await import("./commands/audit.ts");
    const index = await Bun.file(`${ROOT}/.state/accio-index.json`).json();
    const dir = `${ROOT}/.state/test-audit-journal`;
    // decided entries age (open >14 days nags), so their fixture dates are relative to now
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    await Bun.write(`${dir}/tasks/journal/2026-08-20-good.md`, [
      "---", `date: ${daysAgo(5)}`, 'source: "meeting"', "ticket: ALD-42",
      "features: [tasks]", "scope: product", "status: decided",
      "summary: something agreed", "---", "Details.",
    ].join("\n"));
    // a landed entry: PR key + merge sha + a ticket LIST (one landing can advance several)
    await Bun.write(`${dir}/tasks/journal/2026-08-22-fe363-landed.md`, [
      "---", "date: 2026-08-22", "pr: fe#363", "merge: 597bfbdf3",
      "ticket: [ALD-43, ALD-44]", "features: [tasks]", "scope: product",
      "status: documented", "summary: it landed", "---",
    ].join("\n"));
    // decided, and its ticket has since landed in another entry — the loop closed unlinked
    await Bun.write(`${dir}/tasks/journal/2026-08-19-dangling.md`, [
      "---", `date: ${daysAgo(5)}`, "ticket: ALD-43", "features: [tasks]",
      "scope: product", "status: decided", "summary: landed elsewhere", "---",
    ].join("\n"));
    // a decision properly closed by its landing entry — terminal, exempt from the pr rule
    // (filed under YYYY-MM/YYYY-MM-DD dirs — the audit must read every journal depth)
    await Bun.write(`${dir}/tasks/journal/2026-08/2026-08-18/2026-08-18-superseded-ok.md`, [
      "---", `date: ${daysAgo(30)}`, "pr: null", "ticket: ALD-44", "features: [tasks]",
      "scope: product", "status: superseded", "summary: closed by fe363-landed", "---",
    ].join("\n"));
    // decided, no landing anywhere, open past the age limit, and not parked
    await Bun.write(`${dir}/tasks/journal/2026-08-10-stale-decided.md`, [
      "---", `date: ${daysAgo(20)}`, "ticket: ALD-90", "features: [tasks]",
      "scope: product", "status: decided", "summary: never landed", "---",
    ].join("\n"));
    // …but a parked decision waits quietly, however old
    await Bun.write(`${dir}/tasks/journal/2026-08-09-parked-decided.md`, [
      "---", `date: ${daysAgo(40)}`, "ticket: ALD-91", "features: [tasks]",
      "scope: product", "status: decided", 'hold: "waiting on BE capacity"',
      "summary: parked on purpose", "---",
    ].join("\n"));
    // pushed straight to staging — `direct` is a valid key, and still needs its sha
    await Bun.write(`${dir}/tasks/journal/2026-08-23-direct-ok.md`, [
      "---", "date: 2026-08-23", "pr: direct", "merge: 9bf7402c5",
      "ticket: null", "features: [tasks]", "scope: product",
      "status: documented", "summary: pushed straight to staging", "---",
    ].join("\n"));
    await Bun.write(`${dir}/tasks/journal/2026-08-24-unretrievable.md`, [
      "---", "date: 2026-08-24", "pr: pr-363", "features: [tasks]",
      "scope: product", "status: implemented", "summary: bad pr key, no merge sha", "---",
    ].join("\n"));
    // `decided` means not in code — naming a landing contradicts it
    await Bun.write(`${dir}/tasks/journal/2026-08-25-contradiction.md`, [
      "---", `date: ${daysAgo(3)}`, "pr: fe#370", "merge: 550bc135e", "features: [tasks]",
      "scope: product", "status: decided", "summary: says decided, but it shipped", "---",
    ].join("\n"));
    await Bun.write(`${dir}/tasks/journal/2026-08-21-bad.md`, [
      "---", "date: 2026-08-21", "ticket: not a ticket",
      "features: [no-such-feature]", "status: shipped", "summary: x", "---",
    ].join("\n"));
    // implemented BEFORE the feature's product doc was last re-verified → missed by refresh
    await Bun.write(`${dir}/admin/signals/journal/2026-08-01-missed.md`, [
      "---", "date: 2026-08-01", "features: [admin-signals]", "scope: product",
      "status: implemented", "summary: y", "---",
    ].join("\n"));
    // …unless it says why it is parked open, which stops the nag but must state a reason
    await Bun.write(`${dir}/admin/signals/journal/2026-08-02-held.md`, [
      "---", "date: 2026-08-02", "pr: be#735", "merge: c9c52464", "ticket: null",
      "features: [admin-signals]", "scope: product", "status: implemented",
      'hold: "the FE half is not built"', "summary: z", "---",
    ].join("\n"));
    await Bun.write(`${dir}/admin/signals/journal/2026-08-03-held-blank.md`, [
      "---", "date: 2026-08-03", "pr: null", "ticket: null",
      "features: [admin-signals]", "scope: product", "status: implemented",
      "hold:", "summary: z", "---",
    ].join("\n"));
    const problems = await auditJournal(index, dir);
    expect(problems.some(x => x.includes("good"))).toBe(false);
    expect(problems.some(x => x.includes("bad") && x.includes("unknown feature"))).toBe(true);
    expect(problems.some(x => x.includes("bad") && x.includes("status"))).toBe(true);
    expect(problems.some(x => x.includes("bad") && x.includes("ticket"))).toBe(true);
    expect(problems.some(x => x.includes("missed") && x.includes("refresh missed"))).toBe(true);
    // filed in a feature folder its own `features:` list never names
    expect(problems.some(x => x.includes("bad") && x.includes("filed under `tasks`"))).toBe(true);
    // a landing named properly is clean, ticket list and `direct` included
    // (match the subject prefix — the dangling-decided message cites this entry by name)
    expect(problems.some(x => x.includes("fe363-landed.md:"))).toBe(false);
    expect(problems.some(x => x.includes("direct-ok"))).toBe(false);
    // …and an entry nobody can retrieve is not
    expect(problems.some(x => x.includes("unretrievable") && x.includes("pr `pr-363`"))).toBe(true);
    expect(problems.some(x => x.includes("unretrievable") && x.includes("no `merge:` sha"))).toBe(true);
    expect(problems.some(x => x.includes("contradiction") && x.includes("decided"))).toBe(true);
    // implemented entries must say which landing carried them, even to say `null`
    expect(problems.some(x => x.includes("missed") && x.includes("names no `pr:`"))).toBe(true);
    // a stated hold parks the entry; a blank one is just a silenced nag
    expect(problems.some(x => x.includes("2026-08-02-held"))).toBe(false);
    expect(problems.some(x => x.includes("held-blank") && x.includes("no reason"))).toBe(true);
    // a decided entry whose ticket landed in another entry is a loop closed unlinked…
    expect(problems.some(x => x.includes("dangling") && x.includes("ALD-43 landed as fe#363"))).toBe(true);
    // …one properly flipped to superseded is terminal and clean, with no pr required
    expect(problems.some(x => x.includes("superseded-ok"))).toBe(false);
    // an unlanded decision open past the age limit nags; a parked one waits quietly
    expect(problems.some(x => x.includes("stale-decided") && x.includes("still open"))).toBe(true);
    expect(problems.some(x => x.includes("parked-decided"))).toBe(false);
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("journal day view consolidates per-landing entries from frontmatter alone", async () => {
    const { journalView } = await import("./commands/journal.ts");
    const dir = `${ROOT}/.state/test-journal-view`;
    await Bun.write(`${dir}/tasks/journal/2026-08/2026-08-28/2026-08-28-fe370-a.md`, [
      "---", "date: 2026-08-28", "pr: fe#370", "merge: 550bc135e", "ticket: LIA-51",
      "features: [tasks]", "scope: product", "status: implemented", "summary: first landing", "---",
    ].join("\n"));
    await Bun.write(`${dir}/tasks/journal/2026-08/2026-08-28/2026-08-28-direct-b.md`, [
      "---", "date: 2026-08-28", "pr: direct", "merge: 9bf7402c5", "ticket: null",
      "features: [tasks]", "scope: product", "status: implemented", "summary: second landing", "---",
    ].join("\n"));
    await Bun.write(`${dir}/tasks/journal/2026-08/2026-08-27/2026-08-27-fe360-c.md`, [
      "---", "date: 2026-08-27", "pr: fe#360", "merge: df162b2be", "ticket: null",
      "features: [tasks]", "scope: product", "status: documented", "summary: day before", "---",
    ].join("\n"));
    const day = await journalView("2026-08-28", undefined, dir);
    expect(day).toContain("2026-08-28 — 2 entries");
    expect(day).toContain("first landing");
    expect(day).not.toContain("day before");
    // ticket: null is elided from the line, not printed
    expect(day).not.toContain("null");
    const range = await journalView(undefined, "2026-08-27", dir);
    expect(range).toContain("2026-08-28 — 2 entries");
    expect(range).toContain("2026-08-27 — 1 entry");
    expect(range.indexOf("2026-08-28")).toBeLessThan(range.indexOf("2026-08-27 —")); // newest first
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  // several landings share a day, so "docs re-verified the same date" says nothing about
  // whether the refresh actually saw this one — it is decided by sha against last_verified
  test.skipIf(!existsSync(`${process.env.HOME}/git/alden-portal-fe`))(
    "audit dates staleness by sha, not by same-day dates", async () => {
    const { auditJournal } = await import("./commands/audit.ts");
    const index = await Bun.file(`${ROOT}/.state/accio-index.json`).json();
    const dir = `${ROOT}/.state/test-audit-sha`;
    const entry = (merge: string) => [
      "---", "date: 2026-08-28", "pr: fe#370", `merge: ${merge}`, "ticket: LIA-51",
      "features: [tasks]", "scope: architecture", "status: implemented",
      "summary: s", "---",
    ].join("\n");
    // tasks/docs/product.md records last_verified: staging@597bfbdf3, dated 2026-08-28
    await Bun.write(`${dir}/tasks/journal/2026-08-28-landed-before.md`, entry("9bf7402c5"));
    await Bun.write(`${dir}/tasks/journal/2026-08-28-landed-after.md`, entry("550bc135e"));
    const problems = await auditJournal(index, dir);
    expect(problems.some(x => x.includes("landed-before") && x.includes("refresh missed"))).toBe(true);
    expect(problems.some(x => x.includes("landed-after"))).toBe(false);
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
