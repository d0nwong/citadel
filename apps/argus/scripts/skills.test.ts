/**
 * The skill caps from SPEC.md: the sweep under 120 lines, every other skill under 100, and
 * no dated provenance or ticket key in a skill body. A skill that grows past its cap is a
 * rule that should have been code.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SKILLS = join(ROOT, "skills");
const CAP: Record<string, number> = { sweep: 120 };
const DEFAULT_CAP = 100;
/** older skills not yet rewritten; each is a task, not a permission */
const NOT_YET = new Set(["office-hours", "prototyping", "api-lookup"]);

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
