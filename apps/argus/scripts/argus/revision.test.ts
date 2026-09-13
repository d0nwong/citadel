/**
 * The revision record against a temp workspace (CTD-192): a draft is made, filed and
 * dropped by the verbs and by nothing else, every refusal writes nothing, a dropped
 * revision reaches the archive whole, and the validator names each rule the spec states.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listApps, splitFeatureKey } from "./paths.ts";
import { dropRevision, fileRevision, listRevisions, newRevision, readRevision, validateRevisionDir } from "./revision.ts";

const T0 = new Date("2026-09-13T10:00:00Z");
let ws: string;

const SPEC = (feature: string, next = 3, extra = "") => `---
feature: ${feature}
revised_by: CTD-900
next_id: ${next}
---
# Spec: x

## Criteria
- S-1 — one thing is observed.
- S-2 — another thing is observed.
${extra}
## Retired
- none
`;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "argus-revision-"));
  process.env.ARGUS_ROOT = ws;
  for (const d of ["foundry/features/jobs/docs", "argus/features/revisions/docs", "alden/alden-portal/features/admin/usage/docs"])
    mkdirSync(join(ws, d), { recursive: true });
});
afterEach(() => {
  delete process.env.ARGUS_ROOT;
  rmSync(ws, { recursive: true, force: true });
});

describe("apps and feature keys", () => {
  test("every directory holding features/ is an app, one or two levels down", async () => {
    expect(await listApps()).toEqual(["alden/alden-portal", "argus", "foundry"]);
  });
  test("a feature key splits into its app and its feature, or not at all", async () => {
    expect(await splitFeatureKey("foundry/jobs")).toEqual(["foundry", "jobs"]);
    expect(await splitFeatureKey("alden/alden-portal/admin/usage")).toEqual(["alden/alden-portal", "admin/usage"]);
    expect(await splitFeatureKey("foundry/nope")).toBeNull();
    expect(await splitFeatureKey("jobs")).toBeNull();
  });
});

describe("new", () => {
  test("creates a draft with its features and the day, and refuses the slug a second time", async () => {
    const r = await newRevision("reignite", { title: "Re-ignite a settled job", features: ["foundry/jobs", "foundry/jobs"] }, { now: T0 });
    expect(r.wrote).toBe(true);
    expect(r.diff).toEqual(["+ reignite draft: Re-ignite a settled job"]);
    const found = await readRevision("reignite");
    expect(found?.archived).toBe(false);
    expect(found?.rev).toEqual({
      slug: "reignite",
      title: "Re-ignite a settled job",
      status: "draft",
      features: ["foundry/jobs"],
      tickets: [],
      at: { drafted: "2026-09-13", filed: null, settled: null },
      evidence: [],
    });
    await expect(newRevision("reignite", { title: "again", features: ["foundry/jobs"] })).rejects.toThrow("already a revision (draft)");
  });
  test("refuses a bad slug, an empty title and a feature with no directory, and writes nothing", async () => {
    await expect(newRevision("Re Ignite", { title: "x", features: ["foundry/jobs"] })).rejects.toThrow("not a slug");
    await expect(newRevision("a", { title: "  ", features: ["foundry/jobs"] })).rejects.toThrow("has a title");
    await expect(newRevision("a", { title: "x", features: ["foundry/nope"] })).rejects.toThrow("not a feature directory");
    await expect(newRevision("a", { title: "x", features: [] })).rejects.toThrow("names no feature");
    expect(existsSync(join(ws, "revisions"))).toBe(false);
  });
  test("dry run answers the record and writes nothing", async () => {
    const r = await newRevision("dry", { title: "x", features: ["argus/revisions"] }, { dryRun: true });
    expect(r.wrote).toBe(false);
    expect(await readRevision("dry")).toBeNull();
  });
});

describe("file", () => {
  test("a draft becomes filed under its key, tickets in order, the ticket as evidence", async () => {
    await newRevision("reignite", { title: "x", features: ["foundry/jobs"] }, { now: T0 });
    writeFileSync(join(ws, "revisions/reignite/intent.md"), "# Intent\n");
    const r = await fileRevision("reignite", "CTD-201", ["CTD-202", " CTD-203", "CTD-202"], { now: T0, url: "https://linear.app/x/CTD-201" });
    expect(r.diff).toEqual(["reignite draft → filed as CTD-201 (2 tickets)"]);
    expect(existsSync(join(ws, "revisions/reignite"))).toBe(false);
    expect(existsSync(join(ws, "revisions/CTD-201/intent.md"))).toBe(true);
    const found = await readRevision("CTD-201");
    expect(found?.rev).toMatchObject({ key: "CTD-201", status: "filed", tickets: ["CTD-202", "CTD-203"], at: { filed: "2026-09-13" } });
    expect(found?.rev.evidence).toEqual([{ kind: "ticket", key: "CTD-201", url: "https://linear.app/x/CTD-201" }]);
    expect(await readRevision("reignite")).toBeNull();
  });
  test("refuses a missing revision, a non-draft, a non-key and no tickets", async () => {
    await expect(fileRevision("nope", "CTD-1", ["CTD-2"])).rejects.toThrow("no revision");
    await newRevision("r", { title: "x", features: ["foundry/jobs"] });
    await expect(fileRevision("r", "ctd-1", ["CTD-2"])).rejects.toThrow("not a ticket key");
    await expect(fileRevision("r", "CTD-1", [" ", ""])).rejects.toThrow("names its tickets");
    await expect(fileRevision("r", "CTD-1", ["two"])).rejects.toThrow('"two" is not a ticket key');
    await fileRevision("r", "CTD-1", ["CTD-2"]);
    await expect(fileRevision("CTD-1", "CTD-3", ["CTD-2"])).rejects.toThrow("is filed, not a draft");
    expect(readdirSync(join(ws, "revisions"))).toEqual(["CTD-1"]);
  });
  test("refuses a key whose directory already exists", async () => {
    await newRevision("a", { title: "x", features: ["foundry/jobs"] });
    await newRevision("b", { title: "x", features: ["foundry/jobs"] });
    await fileRevision("a", "CTD-1", ["CTD-2"]);
    await expect(fileRevision("b", "CTD-1", ["CTD-2"])).rejects.toThrow("already sits there");
    expect((await readRevision("b"))?.rev.status).toBe("draft");
  });
});

describe("drop", () => {
  test("a draft or a filed revision moves to the archive whole, with the reason, and never deletes", async () => {
    await newRevision("a", { title: "x", features: ["foundry/jobs"] }, { now: T0 });
    mkdirSync(join(ws, "revisions/a/specs/foundry"), { recursive: true });
    writeFileSync(join(ws, "revisions/a/specs/foundry/jobs.md"), SPEC("foundry/jobs"));
    writeFileSync(join(ws, "revisions/a/plan.md"), "# Plan\n");
    const r = await dropRevision("a", "the ask went away", { now: T0 });
    expect(r.diff).toEqual(["a draft → dropped: the ask went away"]);
    expect(existsSync(join(ws, "revisions/a"))).toBe(false);
    expect(existsSync(join(ws, "revisions/archive/a/specs/foundry/jobs.md"))).toBe(true);
    expect(existsSync(join(ws, "revisions/archive/a/plan.md"))).toBe(true);
    const found = await readRevision("a");
    expect(found?.archived).toBe(true);
    expect(found?.rev).toMatchObject({ status: "dropped", at: { settled: "2026-09-13" } });
    expect(found?.rev.evidence.at(-1)).toEqual({ kind: "user", reason: "the ask went away", at: T0.toISOString() });

    await newRevision("b", { title: "x", features: ["foundry/jobs"] });
    await fileRevision("b", "CTD-1", ["CTD-2"]);
    await dropRevision("CTD-1", "cancelled upstream");
    expect((await readRevision("CTD-1"))?.rev).toMatchObject({ status: "dropped", key: "CTD-1", tickets: ["CTD-2"] });
    expect(readdirSync(join(ws, "revisions")).sort()).toEqual(["archive"]);
  });
  test("refuses one already archived, a missing one, and no reason", async () => {
    await newRevision("a", { title: "x", features: ["foundry/jobs"] });
    await dropRevision("a", "x");
    await expect(dropRevision("a", "again")).rejects.toThrow("already dropped and archived");
    await expect(dropRevision("zzz", "x")).rejects.toThrow("no revision");
    await newRevision("b", { title: "x", features: ["foundry/jobs"] });
    await expect(dropRevision("b", "  ")).rejects.toThrow("say why");
    expect((await readRevision("b"))?.rev.status).toBe("draft");
  });
});

describe("list and validate", () => {
  test("lists the live ones first, then the archive", async () => {
    await newRevision("b", { title: "x", features: ["foundry/jobs"] });
    await newRevision("a", { title: "x", features: ["foundry/jobs"] });
    await dropRevision("b", "x");
    expect((await listRevisions()).map((r) => [r.rev.slug, r.archived])).toEqual([["a", false], ["b", true]]);
  });
  test("a good revision with a good spec is clean; each rule is named", async () => {
    await newRevision("a", { title: "x", features: ["foundry/jobs"] });
    const dir = join(ws, "revisions/a");
    mkdirSync(join(dir, "specs/foundry"), { recursive: true });
    writeFileSync(join(dir, "specs/foundry/jobs.md"), SPEC("foundry/jobs"));
    expect(await validateRevisionDir(dir)).toEqual([]);

    writeFileSync(join(dir, "specs/foundry/jobs.md"), SPEC("foundry/jobs", 2, "- S-2 — a repeat.\n- S-9 — past the counter.\n"));
    const rules = (await validateRevisionDir(dir)).map((p) => p.rule);
    expect(rules).toContain("S-2 appears twice");
    expect(rules).toContain("S-2 is at or past next_id 2");
    expect(rules).toContain("S-9 is at or past next_id 2");

    writeFileSync(join(dir, "specs/foundry/jobs.md"), SPEC("foundry/blueprints"));
    expect((await validateRevisionDir(dir)).map((p) => p.rule)).toEqual(["front matter names foundry/blueprints, expected foundry/jobs"]);

    mkdirSync(join(dir, "specs/argus"), { recursive: true });
    writeFileSync(join(dir, "specs/foundry/jobs.md"), SPEC("foundry/jobs"));
    writeFileSync(join(dir, "specs/argus/revisions.md"), SPEC("argus/revisions"));
    expect((await validateRevisionDir(dir)).map((p) => p.rule)).toEqual(["a spec for argus/revisions, which the record does not name"]);
  });
  test("the record's own rules: status, features, key and tickets, and the directory's name", async () => {
    const dir = join(ws, "revisions/CTD-5");
    mkdirSync(dir, { recursive: true });
    const write = (r: Record<string, unknown>) => writeFileSync(join(dir, "revision.json"), JSON.stringify(r));
    const base = { slug: "s", title: "t", features: ["foundry/jobs"], tickets: [], at: { drafted: "2026-09-13", filed: null, settled: null }, evidence: [] };
    write({ ...base, status: "pending" });
    expect((await validateRevisionDir(dir))[0]?.rule).toContain("expected one of draft, filed, done, dropped");
    write({ ...base, status: "filed" });
    expect((await validateRevisionDir(dir)).map((p) => p.rule)).toEqual(["a filed revision has a key", "a filed revision names its tickets", "directory is named CTD-5, the record says s"]);
    write({ ...base, status: "filed", key: "CTD-5", tickets: ["CTD-6"], features: ["foundry/gone"] });
    expect((await validateRevisionDir(dir)).map((p) => p.rule)).toEqual(["foundry/gone is not a feature directory under an app"]);
    write({ ...base, status: "done", key: "CTD-5", tickets: ["CTD-6"] });
    expect(await validateRevisionDir(dir)).toEqual([]);
    writeFileSync(join(dir, "revision.json"), "{");
    expect((await validateRevisionDir(dir))[0]?.rule).toContain("not JSON");
  });
});
