/**
 * What the reader is shown about deploys: a new backend landing's pipeline in words that
 * say whether to wait, and an earlier landing whose pipeline finished since the last read.
 */

import { describe, expect, test } from "bun:test";
import type { Slice } from "./batch.ts";
import type { Check } from "./deploy.ts";
import type { Landing } from "./pr-facts.ts";
import { deploysFor, renderSlice } from "./reader.ts";

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
