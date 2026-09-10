/**
 * record.ts — the workstream record (ARG-154).
 *
 * The cases are the ticket's AC2: a valid record, a missing required field, an unknown
 * stage value, an unknown event kind, and an event attached by hand that does not say by
 * whom. Then the seeded directory itself, which every later ticket renders and ingests
 * against.
 *
 *   bun test skills/sweep/scripts/marauder/record.test.ts
 */

import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validate,
  parseWorkstream,
  serializeWorkstream,
  loadWorkstreams,
  loadMilestones,
  latestEvent,
  sidesOf,
  STAGES,
  EVENT_KINDS,
  type Workstream,
} from "./record.ts";

const ROOT = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

const valid = (over: Partial<Workstream> = {}): Workstream => ({
  slug: "history-asset-editing",
  name: "History tab: editing asset quantities per billing cycle",
  features: ["admin/usage"],
  driver: "Sam O",
  wants: ["Foong Leung"],
  done: "A bookkeeper can change a task's asset quantities on a past cycle and the invoice re-prices.",
  stage: { fe: "landed", be: "landed" },
  overlay: null,
  parked: false,
  milestone: null,
  keys: { tickets: ["ALD-2"], prs: ["fe#417", "be#768"], threads: ["1788774985.655159"], vocab: ["assetEntityId"], people: ["Sam O"] },
  open_questions: [],
  facts: [],
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
  opened: "2026-09-07",
  updated: "2026-09-09T17:56:00Z",
  ...over,
});

describe("validate", () => {
  test("a record with every required field has nothing wrong with it", () => {
    expect(validate(valid())).toEqual([]);
  });

  test("a missing required field is named", () => {
    const { done, ...missing } = valid();
    expect(validate(missing)).toContain("done is missing");
  });

  test("a stage value outside the model is rejected", () => {
    const problems = validate(valid({ stage: { fe: "in-review" as never } }));
    expect(problems.join(" ")).toContain('stage.fe is "in-review"');
  });

  test("a workstream may record only one side", () => {
    expect(validate(valid({ stage: { be: "building" } }))).toEqual([]);
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

  test("a workstream nothing can attach to is rejected", () => {
    const problems = validate(valid({ keys: { tickets: [], prs: [], threads: [], vocab: ["x"], people: [] } }));
    expect(problems.join(" ")).toContain("nothing can attach to it");
  });

  test("an unknown field is rejected, so the shape stays the contract", () => {
    expect(validate({ ...valid(), arc: "admin-usage" }).join(" ")).toContain('unknown field "arc"');
  });

  test("a slug that disagrees with its file name is rejected", () => {
    expect(validate(valid(), "rollover-credits").join(" ")).toContain("does not match the file name");
  });
});

describe("parse and serialize", () => {
  test("serializing then parsing is the same record", () => {
    const w = valid();
    expect(parseWorkstream(serializeWorkstream(w), w.slug).workstream).toEqual(w);
  });

  test("serializing is byte-identical whatever order the keys arrive in", () => {
    const w = valid();
    const shuffled = JSON.parse(JSON.stringify({ updated: w.updated, events: w.events, ...w })) as Workstream;
    expect(serializeWorkstream(shuffled)).toBe(serializeWorkstream(w));
  });

  test("a file that is not JSON is reported, not thrown", () => {
    expect(parseWorkstream("{ not json").problems[0]).toContain("not JSON");
  });
});

describe("the seeded directory", () => {
  test("every workstream file is valid", async () => {
    const { workstreams, problems } = await loadWorkstreams(ROOT);
    expect(problems).toEqual([]);
    expect(workstreams.length).toBeGreaterThanOrEqual(10);
  });

  test("each one says what done means, names a side, and can be attached to", async () => {
    const { workstreams } = await loadWorkstreams(ROOT);
    for (const w of workstreams) {
      expect(w.done.length, w.slug).toBeGreaterThan(20);
      expect(sidesOf(w).length, w.slug).toBeGreaterThan(0);
      expect(w.keys.tickets.length + w.keys.prs.length + w.keys.threads.length, w.slug).toBeGreaterThan(0);
      expect(latestEvent(w), w.slug).toBeDefined();
    }
  });

  test("every milestone a workstream points at exists", async () => {
    const { workstreams, milestones } = await loadWorkstreams(ROOT);
    for (const w of workstreams) if (w.milestone) expect(Object.keys(milestones), w.slug).toContain(w.milestone);
  });

  test("the two arcs' landings are present as verified landings against their journal entries", async () => {
    const { workstreams } = await loadWorkstreams(ROOT);
    const landings = workstreams.flatMap((w) => w.events.filter((e) => e.kind === "verified-landing"));
    for (const ref of ["fe#417", "be#768", "fe#418", "be#763", "be#767", "be#765"])
      expect(landings.some((e) => e.source?.ref === ref), ref).toBe(true);
    for (const e of landings) expect(e.evidence ?? e.source?.sha, e.summary).toBeDefined();
  });

  test("the launch milestone is the one Foong set in the huddle", async () => {
    const milestones = await loadMilestones(ROOT);
    expect(milestones["launch-2026-09-10"]).toEqual({ name: "Launch", date: "2026-09-10", owner: "Foong Leung" });
  });
});

describe("loadWorkstreams", () => {
  test("underscore files are not workstreams, and an unreadable file is reported not thrown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "marauder-"));
    await mkdir(join(dir, "workstreams"));
    await writeFile(join(dir, "workstreams", "_milestones.json"), JSON.stringify({ "launch-2026-09-10": { name: "Launch", date: "2026-09-10", owner: "Foong Leung" } }));
    await writeFile(join(dir, "workstreams", "history-asset-editing.json"), serializeWorkstream(valid()));
    await writeFile(join(dir, "workstreams", "broken.json"), "{");

    const { workstreams, milestones, problems } = await loadWorkstreams(dir);
    expect(workstreams.map((w) => w.slug)).toEqual(["history-asset-editing"]);
    expect(milestones["launch-2026-09-10"]?.date).toBe("2026-09-10");
    expect(problems.map((p) => p.file)).toEqual(["broken.json"]);
  });
});

describe("the vocabulary is closed", () => {
  test("the stage model is exactly the six agreed stages, in order", () => {
    expect([...STAGES]).toEqual(["asked", "decided", "building", "landed", "verified", "shipped"]);
  });

  test("the event kinds are exactly the eight agreed kinds", () => {
    expect([...EVENT_KINDS]).toEqual([
      "answers-question", "contract-change", "claimed-landing", "verified-landing",
      "new-ask", "directed-at-person", "deadline", "chat",
    ]);
  });
});
