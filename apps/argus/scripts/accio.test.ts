/**
 * Recall guard for `accio`.
 *
 * Every case here is a question that was actually asked, in the words it was actually
 * asked in. Two of them ("status select", "projects select") were real misses before the
 * fixes they now cover — the point of the file is that recall degrades silently, so a
 * wrong answer looks exactly like a right one until someone checks a specific question.
 *
 *   bun test scripts/accio.test.ts
 */

import { test, expect, describe } from "bun:test";
import { $ } from "bun";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const accio = async (...args: string[]) =>
  (await $`bun ${ROOT}/scripts/accio.ts ${args}`.text());

/** The `## <slug>  —  <project>` headings, in rank order. */
const components = (out: string) =>
  [...out.matchAll(/^## (\S+)\s+—\s+(\S+)/gm)].map(m => ({ slug: m[1], project: m[2] }));

const endpoints = (out: string) =>
  [...out.matchAll(/^ {2}((?:GET|POST|PUT|PATCH|DELETE) \S+)/gm)].map(m => m[1]);

describe("component lookup", () => {
  const cases: [query: string[], slug: string, project: string][] = [
    [["status select"], "status-controls", "dashboard"],
    [["status badge"], "status-controls", "dashboard"],
    [["capacity rail"], "capacity", "dashboard"],
    [["saved views"], "views", "dashboard"],
  ];
  for (const [args, slug, project] of cases)
    test(`"${args.join(" ")}" → ${slug}`, async () => {
      const top = components(await accio(...args))[0];
      expect(top).toBeDefined();
      expect(top.slug).toBe(slug);
      expect(top.project).toBe(project);
    });
});

describe("documented data flow", () => {
  test('"projects select" → the documented projects entry', async () => {
    const out = await accio("projects select");
    expect(out).toContain("## projects");
    expect(out).toContain("(documented)");
  });

  test('"priority select" and "priority field" both reach taskPriority', async () => {
    for (const q of ["priority select", "priority field"])
      expect(await accio(q)).toContain("## taskPriority");
  });

  test('"assignee" resolves the UI word to the API word', async () => {
    // the endpoint says "users", the user says "assignee" — aka: closes that gap
    const out = await accio("assignee", "--in", "tasks");
    expect(out).toContain("## assignedUsers");
    expect(out).toContain("(documented)");
  });

  test("carries reads AND writes, not just one", async () => {
    const out = await accio("assignee", "--in", "tasks");
    expect(out).toContain("GET /api/v1/tasks/{taskId}");
    expect(out).toContain("POST /api/v1/tasks/{taskId}/users");
  });

  test("carries the normalisation, which nothing can derive", async () => {
    expect(await accio("priority select")).toContain("toFixed(1)");
  });

  test("documented entries outrank the routing layers", async () => {
    const out = await accio("priority select");
    expect(out.indexOf("(documented)")).toBeLessThan(
      out.includes("## symbols") ? out.indexOf("## symbols") : Infinity);
  });

  test("undocumented subjects still fall through to routing", async () => {
    const out = await accio("status select");
    expect(out).toContain("status-controls");
    expect(out).toContain("PUT /api/v1/tasks/{taskId}/status/{status}");
  });
});

describe("symbol lookup (field grain)", () => {
  const symbol = (out: string) => out.match(/^ {2}(\S+)\s+\((field|file|export)/m)?.[1];

  // routing is for subjects nobody has documented yet — miro has no data-flow entry
  test("an undocumented subject routes to files", async () => {
    const out = await accio("miro");
    expect(symbol(out)).toContain("miro");
    expect(out).toContain("read these:");
  });

  test("routing carries the guards it found", async () => {
    expect(await accio("miro")).toContain("disabled={!miroBoardUrl}");
  });

  // regression: widget words must not veto — the code says field, the user says select
  test("widget words do not veto a match", async () => {
    expect(await accio("priority select")).not.toContain("Nothing matched");
    expect(await accio("priority field")).not.toContain("Nothing matched");
  });

  test("reachable endpoints are labelled as candidates, never as the answer", async () => {
    const out = await accio("task credits");
    if (out.includes("reachable endpoints")) expect(out).toContain("candidates only");
  });
});

describe("endpoint ranking", () => {
  test("a documented field names both its option source and its value source", async () => {
    const out = await accio("project", "--in", "tasks");
    expect(out).toContain("## projects");
    expect(out).toContain("GET /api/v1/projects/entity/{entityId}");
    expect(out).toContain("GET /api/v1/tasks/{taskId}");
  });

  test("status select resolves to the write endpoint", async () => {
    expect(endpoints(await accio("status select"))[0])
      .toBe("PUT /api/v1/tasks/{taskId}/status/{status}");
  });
});

describe("reverse lookup", () => {
  test("endpoint → owning component", async () => {
    const out = await accio("tasks/{taskId}/status", "--endpoints");
    expect(out).toContain("PUT /api/v1/tasks/{taskId}/status/{status}");
    expect(out).toContain("dashboard");
  });
});

describe("honesty", () => {
  test("a miss says so rather than inventing a match", async () => {
    const out = await accio("wingardium leviosa");
    expect(out).toContain("Nothing matched");
  });

  test("every answer discloses which features are unmapped", async () => {
    // A confident-looking hit must not hide that most of the corpus has no attribution.
    expect(await accio("status select")).toContain("not yet mapped");
  });

  test("pure lib modules report calling nothing", async () => {
    const out = await accio("submit-gate");
    expect(out).toContain("Calls nothing");
  });
});
