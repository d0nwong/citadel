/**
 * The map of the work, read (LIA-160 AC1, AC2, AC3, AC6).
 *
 * The pages are rendered by argus and read here, so what these cases guard is the two
 * things that happen on the way through — a file path becoming a route inside the app, and
 * a workstream's bold name becoming a link to its page — plus the readers that turn
 * `workstreams/` into what the pages beside the markdown show.
 *
 * Everything takes its directory and its app roots, so nothing here needs `WORKSPACE_DIR`:
 * that is fixed at module load and `bun test` shares one module registry across files, so
 * setting it in-process would leak into every other suite.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listWorkstreams,
  readBoard,
  readMilestones,
  readUnsorted,
  readWorkstream,
  routeFor,
} from "./marauder";
import type { AppRoot } from "./workspace";

let root: string;
let marauder: string;
let workstreams: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pensieve-marauder-"));
  marauder = join(root, "marauder");
  workstreams = join(root, "workstreams");
  await mkdir(marauder, { recursive: true });
  await mkdir(workstreams, { recursive: true });
});
afterEach(() => rm(root, { force: true, recursive: true }));

const ROOTS: AppRoot[] = [
  { app: "alden/alden-portal", dir: "/w/alden/alden-portal/features" },
  { app: "pensieve", dir: "/w/pensieve/features" },
];

const record = (over: Record<string, unknown> = {}) => ({
  done: "An owner opens Usage and sees an entity's credits.",
  driver: "Liam Leung",
  events: [],
  facts: [],
  features: ["admin/usage"],
  keys: {
    people: ["Sam"],
    prs: ["fe#407", "be#754"],
    threads: ["1788748246.235359"],
    tickets: ["LIA-71", "LIA-78"],
    vocab: ["billableQuantity"],
  },
  milestone: "launch-2026-09-10",
  name: "The admin Usage page",
  open_questions: [],
  opened: "2026-09-04",
  overlay: null,
  parked: false,
  slug: "usage-page",
  stage: { be: "landed", fe: "verified" },
  updated: "2026-09-09T10:00:00.000Z",
  wants: ["Foong Leung"],
  ...over,
});

const write = (dir: string, file: string, value: unknown) =>
  writeFile(join(dir, file), `${JSON.stringify(value, null, 2)}\n`);

// ── links ──────────────────────────────────────────────────────────────────────

describe("AC1 — a path the sweep wrote becomes a route inside the app", () => {
  const from = (href: string) => routeFor(href, "marauder", ROOTS);

  test("a journal entry opens on the journal page", () => {
    expect(
      from(
        "../alden/alden-portal/features/admin/usage/journal/2026-09/2026-09-09/2026-09-09-fe419-history.md"
      )
    ).toBe("/journal/alden/alden-portal/admin/usage/2026-09-09-fe419-history");
  });

  test("a feature doc opens on the docs page, on the tier it names", () => {
    expect(
      from("../alden/alden-portal/features/admin/usage/docs/product.md")
    ).toBe("/docs/alden/alden-portal/admin/usage");
    expect(
      from("../alden/alden-portal/features/admin/usage/docs/arch.md")
    ).toBe("/docs/alden/alden-portal/admin/usage?tier=arch");
  });

  test("a report, a digest and another workstream each open on their own page", () => {
    expect(from("../reports/2026-09-09.md")).toBe("/reports/2026-09-09");
    expect(from("../digests/2026-09-09.md")).toBe("/digests/2026-09-09");
    expect(from("./due-on-receipt.md")).toBe("/work/due-on-receipt");
  });

  test("a link that is not a file this app serves is left exactly as written", () => {
    // The arcs pages went with the arcs (LIA-162); a link to one is left as written.
    expect(from("../arcs/admin-usage.md")).toBeUndefined();
    expect(from("https://linear.app/liamai/issue/LIA-71")).toBeUndefined();
    expect(from("#needs-you")).toBeUndefined();
    expect(from("/already/a/route")).toBeUndefined();
    expect(from("../CLAUDE.md")).toBeUndefined();
    // An app the workspace does not hold is not a features path at all.
    expect(from("../nowhere/features/x/journal/2026-09/a.md")).toBeUndefined();
  });

  test("the same record renders from another directory", () => {
    expect(routeFor("./2026-09-09.md", "reports", ROOTS)).toBe(
      "/reports/2026-09-09"
    );
    expect(routeFor("../marauder/due-on-receipt.md", "reports", ROOTS)).toBe(
      "/work/due-on-receipt"
    );
  });
});

// ── the board ──────────────────────────────────────────────────────────────────

const BOARD = `# Where the work stands

Foong's launch is tomorrow, 10 September.

## Needs you

**The admin Usage page**

Sam asked you who takes the front end.

[the message](https://alden-studios.slack.com/archives/C07/p178) · [the journal entry](../alden/alden-portal/features/admin/usage/journal/2026-09/2026-09-09/2026-09-09-fe419-history.md)

**Something nobody has a record of**

This one names no workstream.
`;

describe("AC1 — the board is that file, with its names linked", () => {
  test("every workstream name links to its page and every path to its route", async () => {
    await writeFile(join(marauder, "board.md"), BOARD);
    await write(workstreams, "usage-page.json", record());
    const board = await readBoard(marauder, {
      base: "marauder",
      roots: ROOTS,
      workstreams: await listWorkstreams(workstreams),
    });
    const json = JSON.stringify(board?.doc);
    expect(json).toContain('"href":"/work/usage-page"');
    expect(json).toContain(
      '"href":"/journal/alden/alden-portal/admin/usage/2026-09-09-fe419-history"'
    );
    // The Slack permalink is not a file in the workspace, so it is untouched.
    expect(json).toContain(
      '"href":"https://alden-studios.slack.com/archives/C07/p178"'
    );
    // A bold line naming no record stays a bold line rather than becoming a dead link.
    const orphan = board?.doc.children.find((n) =>
      JSON.stringify(n).includes("Something nobody has a record of")
    );
    expect(JSON.stringify(orphan)).not.toContain('"href"');
    // The page names itself in the header, so its own `# ` title is not shown twice.
    expect(board?.doc.children[0]).not.toMatchObject({
      depth: 1,
      type: "heading",
    });
    expect(board?.path).toContain("board.md");
  });

  test("no board rendered yet reads as none rather than as an error", async () => {
    expect(
      await readBoard(marauder, { roots: ROOTS, workstreams: [] })
    ).toBeNull();
  });
});

// ── one workstream ─────────────────────────────────────────────────────────────

describe("AC2 — a workstream's page and the record behind it", () => {
  test("carries the stage per side, the milestone key, the tickets and the PRs", async () => {
    await writeFile(
      join(marauder, "usage-page.md"),
      "# The admin Usage page\n\nThe frontend is on staging.\n"
    );
    await write(workstreams, "usage-page.json", record());
    const found = await readWorkstream("usage-page", marauder, {
      base: "marauder",
      roots: ROOTS,
      workstreams: await listWorkstreams(workstreams),
    });
    expect(found?.workstream).toMatchObject({
      driver: "Liam Leung",
      keys: { prs: ["fe#407", "be#754"], tickets: ["LIA-71", "LIA-78"] },
      milestone: "launch-2026-09-10",
      name: "The admin Usage page",
      stage: { be: "landed", fe: "verified" },
    });
    expect(found?.page).not.toBeNull();
  });

  test("a slug that is not one, and a name nothing holds, are both nothing", async () => {
    expect(
      await readWorkstream("../../etc/passwd", marauder, { workstreams: [] })
    ).toBeNull();
    expect(
      await readWorkstream("no-such-thing", marauder, { workstreams: [] })
    ).toBeNull();
  });

  test("a record with no page still opens, and a page with no record still reads", async () => {
    await write(workstreams, "usage-page.json", record());
    const ws = await listWorkstreams(workstreams);
    expect(
      (await readWorkstream("usage-page", marauder, { workstreams: ws }))?.page
    ).toBeNull();
    await writeFile(join(marauder, "orphan.md"), "# Orphan\n\nA page.\n");
    expect(
      (
        await readWorkstream("orphan", marauder, {
          roots: ROOTS,
          workstreams: ws,
        })
      )?.workstream
    ).toBeNull();
  });
});

// ── the records ────────────────────────────────────────────────────────────────

describe("the readers over workstreams/", () => {
  test("files starting with _ are never a workstream", async () => {
    await write(workstreams, "usage-page.json", record());
    await write(workstreams, "_milestones.json", {
      "launch-2026-09-10": {
        date: "2026-09-10",
        name: "Launch",
        owner: "Foong Leung",
      },
    });
    await write(workstreams, "_unsorted.json", []);
    expect((await listWorkstreams(workstreams)).map((w) => w.slug)).toEqual([
      "usage-page",
    ]);
    expect(await readMilestones(workstreams)).toMatchObject({
      "launch-2026-09-10": { name: "Launch" },
    });
  });

  test("newest update first, and a file that is not a record is skipped", async () => {
    await write(workstreams, "usage-page.json", record());
    await write(
      workstreams,
      "due-on-receipt.json",
      record({
        name: "Due on Receipt",
        slug: "due-on-receipt",
        updated: "2026-09-09T22:00:00.000Z",
      })
    );
    await writeFile(join(workstreams, "broken.json"), "{ not json");
    expect((await listWorkstreams(workstreams)).map((w) => w.slug)).toEqual([
      "due-on-receipt",
      "usage-page",
    ]);
  });

  test("no workstreams directory at all reads as nothing, not as a crash", async () => {
    expect(await listWorkstreams(join(root, "nope"))).toEqual([]);
    expect(await readUnsorted(join(root, "nope"))).toEqual([]);
    expect(await readMilestones(join(root, "nope"))).toEqual({});
  });
});

describe("AC3 — the queue, newest first", () => {
  test("carries the summary, the source, the candidates and the suggestion", async () => {
    await write(workstreams, "_unsorted.json", [
      {
        at: "2026-09-08T09:00:00.000Z",
        candidates: [
          { how: "vocab", slug: "usage-page", why: "names billableQuantity" },
        ],
        id: "1788927279211769.1",
        kind: "slack",
        source: {
          ref: "1788927279211769.1",
          type: "slack",
          url: "https://slack/x",
        },
        suggest: "usage-page",
        summary: "Sam asked who takes the front end.",
      },
      {
        at: "2026-09-09T09:00:00.000Z",
        candidates: [],
        groups: [
          { events: ["fe#407"], name: "History" },
          { events: ["fe#403"], name: "Capacity" },
        ],
        id: "split/usage-page",
        kind: "split",
        slug: "usage-page",
        suggest: null,
        summary: "The admin Usage page reads as 2 separate things.",
      },
    ]);
    const items = await readUnsorted(workstreams);
    expect(items.map((i) => i.id)).toEqual([
      "split/usage-page",
      "1788927279211769.1",
    ]);
    expect(items[1]).toMatchObject({
      candidates: [{ slug: "usage-page" }],
      kind: "slack",
      suggest: "usage-page",
    });
    expect(items[0].groups?.map((g) => g.name)).toEqual([
      "History",
      "Capacity",
    ]);
  });

  test("an entry with no id is not an entry, and an unknown kind reads as a message", async () => {
    await write(workstreams, "_unsorted.json", [
      {
        at: "2026-09-09",
        candidates: [],
        kind: "slack",
        suggest: null,
        summary: "no id",
      },
      {
        at: "2026-09-09",
        candidates: [],
        id: "x",
        kind: "invented",
        suggest: null,
        summary: "s",
      },
    ]);
    const items = await readUnsorted(workstreams);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("slack");
  });
});
