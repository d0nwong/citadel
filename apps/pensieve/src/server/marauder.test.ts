/**
 * The map of the work, read (LIA-160; over features since ARG-167 AC1, AC2, AC3, AC6).
 *
 * The pages are rendered by argus and read here, so what these cases guard is the two
 * things that happen on the way through — a file path becoming a route inside the app, and
 * a feature's name becoming a link to its page — plus the readers that turn every
 * `work.json` and `queue/` into what the pages beside the markdown show.
 *
 * Everything takes its directory and its app roots, so nothing here needs `WORKSPACE_DIR`:
 * that is fixed at module load and `bun test` shares one module registry across files, so
 * setting it in-process would leak into every other suite.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  listFeatures,
  listWork,
  readBoard,
  readFeature,
  readMilestones,
  readUnsorted,
  routeFor,
} from "./marauder";
import type { AppRoot } from "./workspace";

let root: string;
let roots: AppRoot[];

const APP = "alden/alden-portal";
const features = () => join(root, APP, "features");

/** Write a file under the temp workspace, making its directories as it goes. */
const put = async (rel: string, body: unknown) => {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(
    abs,
    typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`
  );
};

const record = (over: Record<string, unknown> = {}) => ({
  events: [],
  feature: "admin/invoicing",
  keys: {
    prs: ["fe#407", "be#754"],
    threads: ["1788748246.235359"],
    tickets: ["ALD-71", "ALD-78"],
    vocab: ["due on receipt"],
  },
  milestone: "launch-2026-09-10",
  open_questions: [
    { asked_by: "Sam", at: "2026-09-08", owner: "you", q: "who takes the FE" },
  ],
  updated: "2026-09-09T10:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pensieve-marauder-"));
  roots = [{ app: APP, dir: features() }];
  await put(`${APP}/.doc-workspace/feature-manifest.json`, {
    features: [
      { id: "admin-invoicing", name: "Invoicing" },
      { id: "tasks", name: "Tasks" },
    ],
  });
  await put(`${APP}/features/admin/invoicing/work.json`, record());
  await put(`${APP}/features/admin/invoicing/docs/product.md`, "# Invoicing\n");
  // A feature with docs and no record: attachable, but nothing going on.
  await put(`${APP}/features/due-dates/docs/product.md`, "# Due dates\n");
});
afterEach(() => rm(root, { force: true, recursive: true }));

// ── links ──────────────────────────────────────────────────────────────────────

describe("a path the sweep wrote becomes a route inside the app", () => {
  const ROOTS: AppRoot[] = [
    { app: APP, dir: "/w/alden/alden-portal/features" },
    { app: "pensieve", dir: "/w/pensieve/features" },
  ];
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

  test("AC1 — a feature's page opens on /features/<dir>", () => {
    expect(
      from("../alden/alden-portal/features/admin/invoicing/board.md")
    ).toBe("/features/admin/invoicing");
    expect(from("../pensieve/features/journal/board.md")).toBe(
      "/features/journal"
    );
  });

  test("a report and a digest still open on their own page", () => {
    expect(from("../reports/2026-09-09.md")).toBe("/reports/2026-09-09");
    expect(from("../digests/2026-09-09.md")).toBe("/digests/2026-09-09");
  });

  test("a link that is not a file this app serves is left exactly as written", () => {
    // The workstream pages under marauder/ went with the workstreams (ARG-167).
    expect(from("./due-on-receipt.md")).toBeUndefined();
    expect(from("https://linear.app/liamai/issue/ALD-71")).toBeUndefined();
    expect(from("#needs-you")).toBeUndefined();
    expect(from("/already/a/route")).toBeUndefined();
    expect(from("../CLAUDE.md")).toBeUndefined();
    expect(from("../nowhere/features/x/board.md")).toBeUndefined();
  });
});

// ── the board ──────────────────────────────────────────────────────────────────

const BOARD = `# Where the work stands

## Needs you

**Invoicing**

Sam asked you who takes the front end.

[the message](https://alden-studios.slack.com/archives/C07/p178) · [the journal entry](../alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-09-fe419.md)

## [Invoicing](../alden/alden-portal/features/admin/invoicing/board.md)

The invoice email was rewritten.

## Due dates

**Something nobody has a record of**
`;

describe("AC1 — the board, with every feature heading routed to its page", () => {
  test("argus's heading link, a bold name and a bare heading all reach /features", async () => {
    await put("marauder/board.md", BOARD);
    const board = await readBoard(join(root, "marauder"), {
      base: "marauder",
      roots,
    });
    const json = JSON.stringify(board?.doc);
    // The heading argus linked, rewritten to the route.
    expect(json).toContain('"href":"/features/admin/invoicing"');
    expect(json).toContain(
      '"href":"/journal/alden/alden-portal/admin/invoicing/2026-09-09-fe419"'
    );
    // A heading argus left bare, linked by the name the folder gives it.
    expect(json).toContain('"href":"/features/due-dates"');
    // The Slack permalink is not a file in the workspace, so it is untouched.
    expect(json).toContain(
      '"href":"https://alden-studios.slack.com/archives/C07/p178"'
    );
    // A bold line naming no feature stays a bold line rather than becoming a dead link.
    const orphan = board?.doc.children.find((n) =>
      JSON.stringify(n).includes("Something nobody has a record of")
    );
    expect(JSON.stringify(orphan)).not.toContain('"href"');
    expect(board?.path).toBe("marauder/board.md");
  });

  test("no board rendered yet reads as none rather than as an error", async () => {
    expect(
      await readBoard(join(root, "marauder"), { features: [], roots })
    ).toBeNull();
  });
});

// ── one feature ────────────────────────────────────────────────────────────────

const PAGE = `# Invoicing

Foong's launch is tomorrow.

[product doc](docs/product.md) · [architecture doc](docs/arch.md)

## What happened

**9 September** — the invoice email was rewritten.

[the journal entry](../../../../../alden/alden-portal/features/admin/invoicing/journal/2026-09/2026-09-09-fe419.md) · [the ticket](https://linear.app/liamai/issue/ALD-71)
`;

describe("AC2 — a feature's page and the record behind it", () => {
  test("renders board.md with doc, journal and ticket links resolved", async () => {
    await put(`${APP}/features/admin/invoicing/board.md`, PAGE);
    const found = await readFeature("admin/invoicing", { roots });
    expect(found).toMatchObject({
      app: APP,
      feature: "admin/invoicing",
      name: "Invoicing",
    });
    const json = JSON.stringify(found?.page?.doc);
    expect(json).toContain('"href":"/docs/alden/alden-portal/admin/invoicing"');
    expect(json).toContain(
      '"href":"/docs/alden/alden-portal/admin/invoicing?tier=arch"'
    );
    expect(json).toContain(
      '"href":"/journal/alden/alden-portal/admin/invoicing/2026-09-09-fe419"'
    );
    expect(json).toContain('"href":"https://linear.app/liamai/issue/ALD-71"');
    expect(found?.page?.path).toBe(
      "alden/alden-portal/features/admin/invoicing/board.md"
    );
    expect(found?.work).toMatchObject({
      keys: { prs: ["fe#407", "be#754"], tickets: ["ALD-71", "ALD-78"] },
      milestone: "launch-2026-09-10",
      openQuestions: [{ owner: "you", q: "who takes the FE" }],
    });
  });

  test("a feature with no such directory is nothing, and a `..` is refused", async () => {
    expect(await readFeature("no/such", { roots })).toBeNull();
    expect(await readFeature("../../etc/passwd", { roots })).toBeNull();
    expect(await readFeature("admin/../admin/invoicing", { roots })).toBeNull();
    // A feature with neither a page nor a record has nothing to show.
    expect(await readFeature("due-dates", { roots })).toBeNull();
  });

  test("a record with no page still opens", async () => {
    const found = await readFeature("admin/invoicing", { roots });
    expect(found?.page).toBeNull();
    expect(found?.work?.feature).toBe("admin/invoicing");
  });
});

// ── the records and the features ───────────────────────────────────────────────

describe("the readers over features/", () => {
  test("AC3 — every feature directory, by manifest name, nested ones included", async () => {
    await put(`${APP}/features/admin/docs/product.md`, "# Admin\n");
    expect(await listFeatures(roots)).toEqual([
      { app: APP, feature: "admin", name: "Admin" },
      { app: APP, feature: "admin/invoicing", name: "Invoicing" },
      { app: APP, feature: "due-dates", name: "Due dates" },
    ]);
  });

  test("AC1 — every work.json, newest first, with no workstreams/ anywhere", async () => {
    await put(
      `${APP}/features/tasks/work.json`,
      record({ feature: "tasks", updated: "2026-09-09T22:00:00.000Z" })
    );
    const work = await listWork(roots);
    expect(work.map((w) => [w.feature, w.name])).toEqual([
      ["tasks", "Tasks"],
      ["admin/invoicing", "Invoicing"],
    ]);
  });

  test("a file that is not a record, or names another feature, is skipped", async () => {
    await put(`${APP}/features/tasks/work.json`, "{ not json");
    await put(
      `${APP}/features/due-dates/work.json`,
      record({ feature: "admin/invoicing" })
    );
    expect((await listWork(roots)).map((w) => w.feature)).toEqual([
      "admin/invoicing",
    ]);
  });

  test("AC6 — milestones and the queue come from queue/", async () => {
    await put("queue/_milestones.json", {
      "launch-2026-09-10": {
        date: "2026-09-10",
        name: "Launch",
        owner: "Foong Leung",
      },
    });
    expect(await readMilestones(join(root, "queue"))).toMatchObject({
      "launch-2026-09-10": { name: "Launch" },
    });
  });

  test("AC6 — no queue/ directory at all reads as nothing, not as a crash", async () => {
    expect(await readUnsorted(join(root, "nope"))).toEqual([]);
    expect(await readMilestones(join(root, "nope"))).toEqual({});
    expect(await listWork([{ app: "x", dir: join(root, "nope") }])).toEqual([]);
  });
});

describe("AC3 — the queue, newest first", () => {
  test("carries the summary, the source, the feature candidates and the suggestion", async () => {
    await put("queue/_unsorted.json", [
      {
        at: "2026-09-08T09:00:00.000Z",
        candidates: [
          {
            feature: "admin/invoicing",
            how: "vocab",
            why: "names due on receipt",
          },
          { how: "vocab", slug: "a-workstream", why: "an old shape" },
        ],
        id: "1788927279211769.1",
        kind: "slack",
        source: {
          ref: "1788927279211769.1",
          type: "slack",
          url: "https://slack/x",
        },
        suggest: "admin/invoicing",
        summary: "Sam asked who takes the front end.",
      },
      {
        at: "2026-09-09T09:00:00.000Z",
        candidates: [],
        id: "fe#417",
        kind: "landing",
        suggest: null,
        summary: "fe#417 landed.",
      },
    ]);
    const items = await readUnsorted(join(root, "queue"));
    expect(items.map((i) => i.id)).toEqual(["fe#417", "1788927279211769.1"]);
    // A candidate naming a workstream rather than a feature is dropped.
    expect(items[1]).toMatchObject({
      candidates: [{ feature: "admin/invoicing" }],
      kind: "slack",
      suggest: "admin/invoicing",
    });
    expect(items[1].candidates).toHaveLength(1);
  });

  test("an entry with no id is not an entry, and an unknown kind reads as a message", async () => {
    await put("queue/_unsorted.json", [
      { at: "2026-09-09", candidates: [], suggest: null, summary: "no id" },
      {
        at: "2026-09-09",
        candidates: [],
        id: "x",
        kind: "split",
        suggest: null,
        summary: "s",
      },
    ]);
    const items = await readUnsorted(join(root, "queue"));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("slack");
  });
});
