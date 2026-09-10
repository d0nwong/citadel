/**
 * record.ts — the feature record (ARG-164).
 *
 * A valid record, a missing field, an unknown event kind, an event attached by hand that
 * does not say by whom, a record that disagrees with its directory, and a field the old
 * workstream carried. Then the folded records themselves (AC5), the loader over every app
 * (AC7), and the feature walk the ladder reads.
 *
 *   bun test skills/sweep/scripts/marauder/record.test.ts
 */

import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validate,
  parseWork,
  serializeWork,
  loadWork,
  loadFeatures,
  loadMilestones,
  loadUnsorted,
  latestEvent,
  EVENT_KINDS,
  type Work,
} from "./record.ts";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

const valid = (over: Partial<Work> = {}): Work => ({
  feature: "admin/usage",
  keys: { tickets: ["ALD-2"], prs: ["fe#417", "be#768"], threads: ["1788774985.655159"], vocab: ["assetEntityId"] },
  milestone: null,
  open_questions: [],
  events: [
    {
      at: "2026-09-09T15:41:00Z",
      kind: "verified-landing",
      side: "be",
      summary: "Sam landed the backend that keys History rows on asset entity.",
      source: { type: "pr", ref: "be#768" },
      attached: { how: "ref", confidence: "certain" },
      ticket: "ALD-2",
    },
  ],
  updated: "2026-09-09T17:56:00Z",
  ...over,
});

describe("validate", () => {
  test("a record with every required field has nothing wrong with it", () => {
    expect(validate(valid())).toEqual([]);
  });

  test("a missing required field is named", () => {
    const { updated, ...missing } = valid();
    expect(validate(missing)).toContain("updated is missing");
  });

  test("an unknown event kind is rejected", () => {
    const w = valid();
    w.events[0]!.kind = "landed-maybe" as never;
    expect(validate(w).join(" ")).toContain('unknown kind "landed-maybe"');
  });

  test("a hand-attached event must say who attached it", () => {
    const w = valid();
    w.events[0]!.attached = { how: "human", confidence: "certain" };
    expect(validate(w).join(" ")).toContain("does not say by whom");
    w.events[0]!.attached = { how: "human", confidence: "certain", by: "Liam Leung" };
    expect(validate(w)).toEqual([]);
  });

  test("a record with no keys yet is still a record — a feature is found by its aliases", () => {
    expect(validate(valid({ keys: { tickets: [], prs: [], threads: [], vocab: [] } }))).toEqual([]);
  });

  test("what the workstream carried is refused, so the shape stays the contract", () => {
    const problems = validate({ ...valid(), stage: { fe: "landed" }, facts: [], name: "x", done: "y", wants: [] }).join(" ");
    for (const k of ["stage", "facts", "name", "done", "wants"]) expect(problems).toContain(`unknown field "${k}"`);
    expect(validate({ ...valid(), keys: { ...valid().keys, people: ["Sam O"] } }).join(" ")).toContain('unknown list "people"');
  });

  test("a record that disagrees with its directory is rejected", () => {
    expect(validate(valid(), "admin/invoicing").join(" ")).toContain("does not match the directory");
  });
});

describe("parse and serialize", () => {
  test("serializing then parsing is the same record", () => {
    const w = valid();
    expect(parseWork(serializeWork(w), w.feature).work).toEqual(w);
  });

  test("the key order is feature, keys, milestone, open questions, events, updated", () => {
    const shuffled = Object.fromEntries(Object.entries(valid()).reverse()) as Work;
    expect(Object.keys(JSON.parse(serializeWork(shuffled)))).toEqual(["feature", "keys", "milestone", "open_questions", "events", "updated"]);
    expect(serializeWork(shuffled)).toBe(serializeWork(valid()));
  });

  test("a file that is not JSON is reported, not thrown", () => {
    expect(parseWork("{ not json").problems[0]).toContain("not JSON");
  });
});

describe("the folded records", () => {
  test("every work.json is valid, and the five features the workstreams named have one", async () => {
    const { work, problems } = await loadWork(ROOT);
    expect(problems).toEqual([]);
    expect(work.map((w) => w.feature).sort()).toEqual(["admin/clients", "admin/invoicing", "admin/usage", "entities", "tasks"]);
    for (const w of work) expect(latestEvent(w), w.feature).toBeDefined();
  });

  test("every milestone a record points at exists", async () => {
    const { work, milestones } = await loadWork(ROOT);
    for (const w of work) if (w.milestone) expect(Object.keys(milestones), w.feature).toContain(w.milestone);
  });

  test("the landings are present as verified landings, each with its journal entry or sha", async () => {
    const { work } = await loadWork(ROOT);
    const landings = work.flatMap((w) => w.events.filter((e) => e.kind === "verified-landing"));
    for (const ref of ["fe#417", "be#768", "fe#418", "be#763", "be#767", "be#765"])
      expect(landings.some((e) => e.source?.ref === ref), ref).toBe(true);
    for (const e of landings) expect(e.evidence ?? e.source?.sha, e.summary).toBeDefined();
  });

  test("a landing a workstream shared between two features is on both", async () => {
    const { work } = await loadWork(ROOT);
    const on = (feature: string) => work.find((w) => w.feature === feature)!.events.map((e) => e.source?.ref);
    const shared = on("entities").filter((r) => r && /^(fe|be)#/.test(r));
    expect(shared.length).toBeGreaterThan(0);
    for (const r of shared) expect(on("admin/invoicing")).toContain(r);
  });

  test("what the reader was waiting on is an open question owned by the person waited on", async () => {
    const { work } = await loadWork(ROOT);
    const tasks = work.find((w) => w.feature === "tasks")!;
    expect(tasks.open_questions).toContainEqual({ q: "which task fields are still meant to be editable", owner: "Foong Leung", asked_by: "sweep", at: "2026-09-09" });
  });

  test("the launch milestone is the one Foong set in the huddle, and the queue proposes no workstream", async () => {
    expect((await loadMilestones(ROOT))["launch-2026-09-10"]).toEqual({ name: "Launch", date: "2026-09-10", owner: "Foong Leung" });
    for (const u of await loadUnsorted(ROOT)) {
      expect(u.kind === "landing" || u.kind === "slack", u.id).toBe(true);
      expect(u, u.id).not.toHaveProperty("slug");
    }
  });
});

describe("loadWork", () => {
  test("a feature with nothing going on has no file and no problem; an unreadable file is reported, not thrown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "marauder-"));
    const features = join(dir, "acme/app/features");
    await mkdir(join(features, "admin/usage/docs"), { recursive: true });
    await mkdir(join(features, "tasks/docs"), { recursive: true });
    await mkdir(join(features, "quiet/docs"), { recursive: true });
    await mkdir(join(dir, "queue"));
    await writeFile(join(dir, "queue/_milestones.json"), JSON.stringify({ "launch-2026-09-10": { name: "Launch", date: "2026-09-10", owner: "Foong Leung" } }));
    await writeFile(join(features, "admin/usage/work.json"), serializeWork(valid()));
    await writeFile(join(features, "tasks/work.json"), "{");

    const { work, milestones, problems } = await loadWork(dir);
    expect(work.map((w) => w.feature)).toEqual(["admin/usage"]);
    expect(milestones["launch-2026-09-10"]?.date).toBe("2026-09-10");
    expect(problems.map((p) => p.file)).toEqual(["acme/app/features/tasks/work.json"]);
  });
});

describe("loadFeatures", () => {
  test("every feature directory of every app, nested ones too, with the manifest's aliases", async () => {
    const features = await loadFeatures(ROOT);
    const usage = features.find((f) => f.feature === "admin/usage")!;
    expect(usage).toMatchObject({ app: "alden/alden-portal", id: "admin-usage" });
    expect(usage.aliases.length).toBeGreaterThan(10);
    expect(features.find((f) => f.feature === "admin/invoicing")?.id).toBe("admin-invoicings");
    expect(features.some((f) => f.feature === "admin")).toBe(true);
    expect(features.some((f) => f.feature.endsWith("/docs") || f.feature.endsWith("/journal"))).toBe(false);
  });
});

describe("the vocabulary is closed", () => {
  test("the event kinds are exactly the eight agreed kinds", () => {
    expect([...EVENT_KINDS]).toEqual([
      "answers-question", "contract-change", "claimed-landing", "verified-landing",
      "new-ask", "directed-at-person", "deadline", "chat",
    ]);
  });
});
