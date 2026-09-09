/**
 * The `arcs/<slug>.md` reader (LIA-149 AC7). The file is argus's — `skills/sweep/scripts/
 * arcs.ts` `renderArc` is its only writer — so these cases are that renderer's output, byte
 * for byte: the frontmatter with its nested `seeds`, the three sections, and the two row
 * shapes the Open list carries. What this reader gets wrong, the Arcs page gets wrong.
 *
 * Both readers take their directory as an argument, so the temp blackboard needs no
 * `WORKSPACE_DIR` override — `bun test` shares one module registry across files and the
 * constant is read at load, so an env override here would leak into every other suite.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listArcs, readArcFile } from "./workspace";

const FILE = `---
slug: invoice-emails
title: Invoice emails
status: open
opened: 2026-09-08T09:12:00.000Z
updated: 2026-09-09
seeds:
  tickets: [LIA-132, LIA-133]
  rules: [BR-22h]
  prs: []
  features: [alden-portal/invoicing]
---

## Where we are

The reminder path is live and the due-on-receipt route shipped; what is left is the
\`clientName\` column on the sent-invoice table.

## Landed

| When | What | Evidence |
|---|---|---|
| 2026-09-08 | fe#412 — reminder emails re-send | \`alden/alden-portal/features/invoicing/journal/2026-09-08-reminders.md\` |
| 2026-09-09 | LIA-132 is ready — sent | \`decisions/decide/lia-132-is-ready.json\` |

## Open

- **LIA-134** → reopen it, or file the AC3 remainder? · \`decide/lia-134\`
- LIA-140 — client name on the sent-invoice table → open in Linear
`;

async function workspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "pensieve-arcs-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body);
  }
  return dir;
}

describe("readArcFile — the frontmatter", () => {
  test("every field the sweep writes, seeds included", async () => {
    const dir = await workspace({ "invoice-emails.md": FILE });
    try {
      const arc = await readArcFile("invoice-emails", dir);
      expect(arc?.meta).toMatchObject({
        opened: "2026-09-08T09:12:00.000Z",
        slug: "invoice-emails",
        status: "open",
        title: "Invoice emails",
        updated: "2026-09-09",
      });
      expect(arc?.meta.seeds).toEqual({
        features: ["alden-portal/invoicing"],
        prs: [],
        rules: ["BR-22h"],
        tickets: ["LIA-132", "LIA-133"],
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("a file whose frontmatter did not parse is an arc that exists and is open", async () => {
    const dir = await workspace({
      "half-written.md":
        "---\ntitle: [unclosed\n---\n\n## Where we are\n\nhm.\n",
    });
    try {
      const arc = await readArcFile("half-written", dir);
      expect(arc?.meta).toMatchObject({
        slug: "half-written",
        status: "open",
        title: "half-written",
      });
      expect(await listArcs(dir)).toHaveLength(1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("a missing file, and a slug that is not one, are null — not an error (AC6)", async () => {
    const dir = await workspace({});
    try {
      expect(await readArcFile("nothing-here", dir)).toBeNull();
      expect(await readArcFile("../../etc/passwd", dir)).toBeNull();
      expect(await listArcs(join(dir, "not-a-dir"))).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("readArcFile — the three sections", () => {
  test("Where we are is the paragraph, and only it", async () => {
    const dir = await workspace({ "invoice-emails.md": FILE });
    try {
      const arc = await readArcFile("invoice-emails", dir);
      const text = JSON.stringify(arc?.doc);
      expect(text).toContain("The reminder path is live");
      expect(text).not.toContain("Nothing landed");
      expect(text).not.toContain("open in Linear");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("Landed is rows, with the Evidence cell's backticks off", async () => {
    const dir = await workspace({ "invoice-emails.md": FILE });
    try {
      const arc = await readArcFile("invoice-emails", dir);
      expect(arc?.landed).toEqual([
        {
          evidence:
            "alden/alden-portal/features/invoicing/journal/2026-09-08-reminders.md",
          what: "fe#412 — reminder emails re-send",
          when: "2026-09-08",
        },
        {
          evidence: "decisions/decide/lia-132-is-ready.json",
          what: "LIA-132 is ready — sent",
          when: "2026-09-09",
        },
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("Open carries the point id where the row names one", async () => {
    const dir = await workspace({ "invoice-emails.md": FILE });
    try {
      const arc = await readArcFile("invoice-emails", dir);
      expect(arc?.open).toEqual([
        {
          point: "decide/lia-134",
          text: "**LIA-134** → reopen it, or file the AC3 remainder? · `decide/lia-134`",
        },
        {
          text: "LIA-140 — client name on the sent-invoice table → open in Linear",
        },
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("an arc with nothing in it reads as empty sections, not as an error", async () => {
    const dir = await workspace({
      "fresh.md": `---
slug: fresh
title: Fresh
status: open
opened: 2026-09-09T00:00:00.000Z
updated: 2026-09-09
seeds:
  tickets: [LIA-9]
  rules: []
  prs: []
  features: []
---

## Where we are

_(the sweep writes this paragraph on the tick that opens the arc.)_

## Landed

_Nothing landed against this arc yet._

## Open

_Nothing open._
`,
    });
    try {
      const arc = await readArcFile("fresh", dir);
      expect(arc?.landed).toEqual([]);
      expect(arc?.open).toEqual([]);
      expect(arc?.meta.seeds.tickets).toEqual(["LIA-9"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("listArcs — every arc, by slug", () => {
  test("open and closed alike, with the day of the last rewrite", async () => {
    const dir = await workspace({
      "invoice-emails.md": FILE,
      "old-thing.md":
        "---\nslug: old-thing\ntitle: Old thing\nstatus: closed\nopened: 2026-08-01T00:00:00.000Z\nupdated: 2026-09-02\n---\n",
    });
    try {
      expect(await listArcs(dir)).toMatchObject([
        { slug: "invoice-emails", status: "open", updated: "2026-09-09" },
        { slug: "old-thing", status: "closed", updated: "2026-09-02" },
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
