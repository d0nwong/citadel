/**
 * The skill caps from SPEC.md: the sweep under 120 lines, every other skill under 100, and
 * no dated provenance or ticket key in a skill body. A skill that grows past its cap is a
 * rule that should have been code. Also the check that CTD-252 moved: every skill under
 * this directory is record work — asking the ledgers, scoping, drafting and filing tickets,
 * revising specs and docs — and a skill that writes product code (`prototyping`) or triages
 * PRs (`office-hours`) is not argus's and does not live here (S-54).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SKILLS = join(ROOT, "skills");
const CAP: Record<string, number> = { sweep: 120 };
const DEFAULT_CAP = 100;
/** older skills not yet rewritten; each is a task, not a permission */
const NOT_YET = new Set(["api-lookup"]);
/** record work: asking, scoping, drafting and filing tickets, revising specs and docs (S-54) */
const RECORD_WORK = new Set(["api-lookup", "ask", "feature-docs", "linear-ticket", "scope", "sweep"]);

test("AC1 (S-54) — every skill under skills/ is record work", () => {
  expect(new Set(readdirSync(SKILLS))).toEqual(RECORD_WORK);
});

describe("skill caps", () => {
  for (const name of readdirSync(SKILLS)) {
    const file = join(SKILLS, name, "SKILL.md");
    test(`${name}/SKILL.md is under its cap and carries no provenance`, async () => {
      const f = Bun.file(file);
      if (!(await f.exists()) || NOT_YET.has(name)) return;
      const text = await f.text();
      const lines = text.split("\n").length;
      expect(lines).toBeLessThanOrEqual(CAP[name] ?? DEFAULT_CAP);
      const body = text.replace(/^---[\s\S]*?---/, "");
      expect(body).not.toMatch(/\b(ARG|LIA|ALD)-\d+\b/);
      expect(body).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    });
  }
});
