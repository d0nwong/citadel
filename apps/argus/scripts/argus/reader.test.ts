/**
 * What the reader is shown about deploys: a new backend landing's pipeline in words that
 * say whether to wait, and an earlier landing whose pipeline finished since the last read.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Slice } from "./batch.ts";
import type { Check } from "./deploy.ts";
import { manifestPath } from "./paths.ts";
import type { Landing } from "./pr-facts.ts";
import { attributePrompt, deploysFor, featureSummaries, renderSlice } from "./reader.ts";
import type { Unplaced } from "./state.ts";

const landing = (n: number, sha: string): Landing => ({
  repo: "be", ref: `be#${n}`, number: n, sha, short: sha.slice(0, 9), at: "2026-09-16T07:26:57Z", date: "2026-09-16",
  by: "Sam O", url: null, branch: null, title: `pr ${n}`, ticketKeys: [], files: ["f"], features: ["x"], routes: [],
});

describe("deploysFor", () => {
  test("tells a running pipeline from a missing one, and both from a finished one", async () => {
    const answers: Record<string, Check> = {
      a: { state: "running" },
      b: { state: "not-found" },
      c: { state: "done", deploy: { result: "SUCCESSFUL", at: "2026-09-16T10:02:11Z", build: 2142, url: "u" } },
      d: { state: "done", deploy: { result: "FAILED", at: "2026-09-16T10:02:11Z", build: 2143, url: "u" } },
      e: { state: "unknown", why: "no Bitbucket credentials" },
    };
    const slice: Slice = { feature: "x", messages: [], landings: ["a", "b", "c", "d", "e"].map((s, i) => landing(i + 1, s)) };
    expect(await deploysFor(slice, async (_r, sha) => answers[sha]!)).toEqual({
      "be#1": "not yet, the pipeline is running; argus reports when it finishes",
      "be#2": "not yet, no pipeline has started; argus reports when one finishes",
      "be#3": "yes, 2026-09-16 (on dev)",
      "be#4": "no, the pipeline failed",
      "be#5": "unknown (no Bitbucket credentials)",
    });
  });
});

describe("featureSummaries (CTD-271, ledger S-27)", () => {
  let ws: string;
  const emptyLedger = (feature: string, summary: string) => ({
    feature,
    as_of: "2026-09-11T10:00:00Z",
    summary,
    story: {
      health: { text: "ok", evidence: [] },
      gaps: { text: "ok", evidence: [] },
      requirements: { text: "ok", evidence: [] },
      architecture: { text: "ok", evidence: [] },
    },
    requirements: [],
    asks: [],
    tickets: [],
    landings: [],
    proposals: [],
  });

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "argus-reader-"));
    process.env.ARGUS_ROOT = ws;
  });
  afterEach(() => {
    delete process.env.ARGUS_ROOT;
    rmSync(ws, { recursive: true, force: true });
  });

  test("draws each feature's name and summary from its own project's manifest and ledger", async () => {
    mkdirSync(join(ws, "alden/alden-portal/.doc-workspace"), { recursive: true });
    writeFileSync(manifestPath(), JSON.stringify({ app: "alden-portal", fe_repo: "~/x", features: [{ id: "tasks", name: "Tasks", type: "feature", entry_routes: ["/tasks"], core_files: [], aliases: [] }] }));
    mkdirSync(join(ws, "alden/alden-portal/features/tasks"), { recursive: true });
    writeFileSync(join(ws, "alden/alden-portal/features/tasks/ledger.json"), JSON.stringify(emptyLedger("tasks", "alden's own summary")));

    mkdirSync(join(ws, "argus/.doc-workspace"), { recursive: true });
    writeFileSync(manifestPath("argus"), JSON.stringify({ app: "citadel", fe_repo: "~/citadel", features: [{ id: "sweep", name: "Sweep", type: "feature", entry_routes: [], core_files: [], aliases: [] }] }));
    mkdirSync(join(ws, "argus/features/sweep"), { recursive: true });
    writeFileSync(join(ws, "argus/features/sweep/ledger.json"), JSON.stringify(emptyLedger("sweep", "citadel's own summary")));

    const out = await featureSummaries([{ app: "alden/alden-portal", feature: "tasks" }, { app: "argus", feature: "sweep" }]);
    expect(out).toContain("- tasks - Tasks; routes /tasks\n    alden's own summary");
    expect(out).toContain("- sweep - Sweep\n    citadel's own summary");
  });

  test("a feature whose app has no manifest still shows its ledger summary, bare", async () => {
    mkdirSync(join(ws, "argus/features/sweep"), { recursive: true });
    writeFileSync(join(ws, "argus/features/sweep/ledger.json"), JSON.stringify(emptyLedger("sweep", "no manifest here")));
    const out = await featureSummaries([{ app: "argus", feature: "sweep" }]);
    expect(out).toBe("- sweep\n    no manifest here");
  });
});

describe("renderSlice", () => {
  test("an earlier landing whose deploy finished gets its own section", () => {
    const slice: Slice = {
      feature: "x",
      messages: [],
      landings: [],
      deploys: [{ ref: "be#797", title: "changing dev routes to test", landed: "2026-09-16T07:26:57Z", deploy: { result: "SUCCESSFUL", at: "2026-09-16T10:02:11Z", build: 2142, url: "u" } }],
    };
    expect(renderSlice(slice)).toContain(
      "## Earlier landings whose deploy finished (1)\n\n[be#797] landed 2026-09-16: changing dev routes to test\ndeployed to dev 2026-09-16, build 2142 u",
    );
    expect(renderSlice({ ...slice, deploys: undefined })).not.toContain("Earlier landings");
  });
});

describe("attributePrompt, bounded by channel (CTD-275, ingest S-9)", () => {
  const u: Unplaced = { id: "1789000000.000001", kind: "message", channel: "C_ACME", by: "Sam O", at: "2026-09-11", text: "about acme", url: "u", candidates: ["home"], batch: "b" };

  test("with several record projects, each thread names the projects its channel carries", async () => {
    const prompt = await attributePrompt([u], [], null, () => ["acme"]);
    expect(prompt).toContain("### thread 1789000000.000001 (only features of acme)");
  });

  test("with one record project, the thread header reads as before", async () => {
    const prompt = await attributePrompt([u], [], null);
    expect(prompt).toContain("### thread 1789000000.000001\n");
  });
});
