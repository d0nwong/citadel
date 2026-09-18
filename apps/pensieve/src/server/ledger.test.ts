/**
 * The ledger reader against a temp workspace: nested features resolve, a broken file is
 * a problem beside the good ones, and the home lists are derived the way the record
 * intends: on-you is every open ask aimed at "you", ready is every ticket with no
 * blocker left, unplaced is argus's file or nothing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TicketStates } from "@citadel/tickets";
import type { Ledger } from "#/lib/ledger";
import type { PipelineCard } from "./ledger";
import { home, listLedgers, readLedger, readUnplaced } from "./ledger";
import { ALDEN_CHECKOUTS, type AppRoot } from "./workspace";

const FIXTURE = new URL("../test/fixtures/ledger.json", import.meta.url)
  .pathname;
const APP = "alden/alden-portal";
let root: string;
let roots: AppRoot[];

const put = async (rel: string, body: unknown) => {
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(
    abs,
    typeof body === "string" ? body : `${JSON.stringify(body, null, 2)}\n`
  );
};

const fixture = async (over: Partial<Ledger> = {}): Promise<Ledger> => ({
  ...(JSON.parse(await Bun.file(FIXTURE).text()) as Ledger),
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pensieve-ledger-"));
  roots = [{ app: APP, dir: join(root, APP, "features") }];
  await put(`${APP}/features/admin/invoicing/ledger.json`, await fixture());
  await put(
    `${APP}/features/tasks/ledger.json`,
    await fixture({ asks: [], feature: "tasks", proposals: [], tickets: [] })
  );
  await put(`${APP}/features/broken/ledger.json`, "{ not json");
  await put(`${APP}/features/nothing/docs/arch.md`, "# no ledger here\n");
});
afterEach(() => rm(root, { force: true, recursive: true }));

describe("listLedgers", () => {
  test("finds nested and flat ledgers, reports the broken one, skips a feature without one", async () => {
    const { ledgers, problems } = await listLedgers(roots);
    expect(ledgers.map((l) => l.feature)).toEqual([
      `${APP}/admin/invoicing`,
      `${APP}/tasks`,
    ]);
    expect(problems).toEqual([
      { app: APP, dir: "broken", problem: expect.stringContaining("JSON") },
    ]);
  });
  test("readLedger takes the route param or a unique bare dir", async () => {
    expect((await readLedger(`${APP}/admin/invoicing`, roots))?.dir).toBe(
      "admin/invoicing"
    );
    expect((await readLedger("tasks", roots))?.feature).toBe(`${APP}/tasks`);
    expect(await readLedger("nope", roots)).toBeNull();
  });
});

describe("home", () => {
  test("on-you, ready and the feature summaries", async () => {
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.onYou.map((a) => [a.id, a.dir])).toEqual([
      ["A-2", "admin/invoicing"],
    ]);
    expect(h.ready).toEqual([]);
    expect(h.readyAsks).toEqual([]);
    expect(h.unplaced).toEqual([]);
    expect(
      h.features.map((f) => [f.dir, f.open, f.onYou, f.proposals])
    ).toEqual([
      ["admin/invoicing", 1, 1, 1],
      ["tasks", 0, 0, 0],
    ]);
    expect(h.problems).toHaveLength(1);
  });
  test("a ticket with every blocker cleared is ready; unplaced comes from argus's file", async () => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    // the fixture's ALD-41 serves A-1, already closed; point it at the open ask so it is still wanted
    l.tickets[0].asks = ["A-2"];
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    await put("state/unplaced.json", [
      {
        at: "2026-09-11",
        batch: "b",
        by: "Sam O",
        candidates: ["tasks"],
        id: "1",
        kind: "message",
        text: "x",
        url: "u",
      },
    ]);
    l.asks[1].blockers = [
      {
        branch: "origin/dev",
        cleared: {
          at: "2026-09-11",
          evidence: [{ kind: "pr", number: 771, repo: "be", url: "u" }],
        },
        deployed: true,
        kind: "landing",
        ref: "be#771",
        repo: "be",
      },
    ];
    l.asks[1].ready = true;
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.map((t) => t.key)).toEqual(["ALD-41"]);
    expect(h.readyAsks.map((a) => a.id)).toEqual(["A-2"]);
    expect(h.unplaced).toHaveLength(1);
    expect(await readUnplaced(join(root, "missing.json"))).toEqual([]);
  });
  test("tickets filed from Ask with no ledger are listed, unless a ledger already has the key", async () => {
    const row = (identifier: string) => ({
      at: "2026-09-14T00:00:00.000Z",
      id: `id_${identifier}`,
      identifier,
      threadId: "t1",
      title: `[FE] ${identifier}`,
      url: `https://linear.app/liamai/issue/${identifier}`,
    });
    const h = await home(roots, join(root, "state/unplaced.json"), [
      row("CTD-9"),
      row("ALD-41"),
    ]);
    // ALD-41 is the fixture ledger's own ticket, so it shows there and not twice
    expect(h.filed.map((t) => t.identifier)).toEqual(["CTD-9"]);
    expect(
      (await home(roots, join(root, "state/unplaced.json"))).filed
    ).toEqual([]);
  });
  test("a ticket leaves Ready once every ask it serves is settled, or once it was sent", async () => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    // ALD-41 serves A-1, which the fixture already has closed
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    let h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready).toEqual([]);
    expect(h.features[0].ready).toBe(0);
    // reopen A-1: the ticket is wanted again
    l.asks[0].status = "asked";
    l.asks[0].history = [];
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.map((t) => t.key)).toEqual(["ALD-41"]);
    // sent: off the list whatever the asks say
    l.tickets[0].sent = [
      { at: "2026-09-11T10:00:00Z", job: "j", repo: "alden-portal-fe" },
    ];
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready).toEqual([]);
  });
  test("a ready ticket carries the repo its feature's last send went to", async () => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    l.asks[0].status = "asked";
    l.asks[0].history = [];
    // A second ticket on the feature, sent twice: the later send is the one offered.
    l.tickets.push({
      asks: [],
      blockers: [],
      key: "ALD-99",
      ready: true,
      sent: [
        { at: "2026-09-10T09:00:00Z", job: "j1", repo: "alden-portal-fe" },
        {
          at: "2026-09-12T09:00:00Z",
          job: "j2",
          repo: "alden-connect-portal-be",
        },
      ],
      title: "[BE] already sent",
    });
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    const h = await home(roots, join(root, "state/unplaced.json"));
    const ready = h.ready.find((t) => t.key === "ALD-41");
    expect(ready?.repo).toBe("alden-connect-portal-be");
    // With that send gone the feature falls back to what ALD-41's own [FE] tag names — the
    // ledger's record wins over the tag while there is one.
    l.tickets = l.tickets.filter((t) => t.key !== "ALD-99");
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    const fresh = await home(roots, join(root, "state/unplaced.json"));
    expect(fresh.ready.find((t) => t.key === "ALD-41")?.repo).toBe(
      ALDEN_CHECKOUTS.FE
    );
  });
  test("a ready ticket with no send yet falls back to the repo its [FE]/[BE] tag names", async () => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    l.tickets[0].title = "[BE] Due header follows the payment term";
    l.asks[0].status = "asked";
    l.asks[0].history = [];
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.find((t) => t.key === "ALD-41")?.repo).toBe(
      ALDEN_CHECKOUTS.BE
    );

    // A tag on a feature that is not alden's names none of the product checkouts: the two
    // env vars are the product's, and a wrong repo is worse than an unfilled field.
    const elsewhere: AppRoot[] = [
      { app: "citadel", dir: join(root, APP, "features") },
    ];
    const other = await home(elsewhere, join(root, "state/unplaced.json"));
    expect(other.ready.find((t) => t.key === "ALD-41")?.repo).toBeUndefined();

    // And a title with no tag asks rather than guesses.
    l.tickets[0].title = "Due header follows the payment term";
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    const untagged = await home(roots, join(root, "state/unplaced.json"));
    expect(
      untagged.ready.find((t) => t.key === "ALD-41")?.repo
    ).toBeUndefined();
  });
  test("a ticket with no asks leaves Ready once reconcile marked it done", async () => {
    const l = await fixture();
    l.tickets = [
      {
        asks: [],
        blockers: [],
        key: "ALD-45",
        ready: true,
        title: "[FE] rollover",
      },
    ];
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    let h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.map((t) => t.key)).toEqual(["ALD-45"]);
    l.tickets[0].settled = {
      at: "2026-09-12",
      evidence: [{ kind: "pr", number: 437, repo: "fe", url: "u" }],
      outcome: "done",
    };
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready).toEqual([]);
    // canceled in Linear: dropped, and just as gone from Ready
    l.tickets[0].settled = {
      at: "2026-09-12",
      evidence: [{ key: "ALD-45", kind: "ticket" }],
      outcome: "dropped",
    };
    await put(`${APP}/features/admin/invoicing/ledger.json`, l);
    h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready).toEqual([]);
  });

  /** ALD-41, ready, with every blocker cleared (mirrors the fixture's own ready-ticket test) */
  const readyFixture = async (): Promise<Ledger> => {
    const l = await fixture();
    for (const b of l.tickets[0].blockers) {
      b.cleared = { at: "2026-09-11", evidence: [{ kind: "slack", url: "u" }] };
    }
    l.tickets[0].ready = true;
    l.tickets[0].asks = ["A-2"];
    return l;
  };

  test("AC2: a ticket assigned to someone else is dropped from Ready to work on", async () => {
    await put(
      `${APP}/features/admin/invoicing/ledger.json`,
      await readyFixture()
    );
    const states: TicketStates = (key) =>
      key === "ALD-41"
        ? {
            assignee: { id: "someone-else" },
            name: "In Progress",
            provider: "linear",
            state: "open",
            url: "u",
          }
        : { state: "unknown" };
    const h = await home(roots, join(root, "state/unplaced.json"), [], states, {
      linear: "liam-linear-id",
    });
    expect(h.ready).toEqual([]);
  });

  test("AC2: Liam's own ticket and one assigned to nobody both stay", async () => {
    await put(
      `${APP}/features/admin/invoicing/ledger.json`,
      await readyFixture()
    );
    const mine: TicketStates = () => ({
      assignee: { id: "liam-linear-id" },
      name: "Backlog",
      provider: "linear",
      state: "open",
      url: "u",
    });
    const h1 = await home(roots, join(root, "state/unplaced.json"), [], mine, {
      linear: "liam-linear-id",
    });
    expect(h1.ready.map((t) => t.key)).toEqual(["ALD-41"]);
    expect(h1.ready[0]?.assignee).toBeUndefined();

    const nobody: TicketStates = () => ({
      name: "Backlog",
      provider: "linear",
      state: "open",
      url: "u",
    });
    const h2 = await home(
      roots,
      join(root, "state/unplaced.json"),
      [],
      nobody,
      {
        linear: "liam-linear-id",
      }
    );
    expect(h2.ready.map((t) => t.key)).toEqual(["ALD-41"]);
  });

  test("AC4: a state its provider could not answer for is kept, its assignee shown as unknown", async () => {
    await put(
      `${APP}/features/admin/invoicing/ledger.json`,
      await readyFixture()
    );
    const h = await home(roots, join(root, "state/unplaced.json"));
    expect(h.ready.map((t) => [t.key, t.assignee])).toEqual([
      ["ALD-41", "unknown"],
    ]);
  });

  test("AC3: a ready ticket's url comes from its provider's state; an unread state leaves it unset", async () => {
    await put(
      `${APP}/features/admin/invoicing/ledger.json`,
      await readyFixture()
    );
    const states: TicketStates = () => ({
      name: "Backlog",
      provider: "linear",
      state: "open",
      url: "https://linear.app/liamai/issue/ALD-41",
    });
    const h = await home(roots, join(root, "state/unplaced.json"), [], states);
    expect(h.ready[0]?.url).toBe("https://linear.app/liamai/issue/ALD-41");

    const unread = await home(roots, join(root, "state/unplaced.json"));
    expect(unread.ready[0]?.url).toBeUndefined();
  });

  test("AC4: an assignee present but Liam's own id unconfirmed is shown as unknown, not dropped", async () => {
    await put(
      `${APP}/features/admin/invoicing/ledger.json`,
      await readyFixture()
    );
    const states: TicketStates = () => ({
      assignee: { id: "whoever" },
      name: "Backlog",
      provider: "linear",
      state: "open",
      url: "u",
    });
    const h = await home(roots, join(root, "state/unplaced.json"), [], states);
    expect(h.ready.map((t) => [t.key, t.assignee])).toEqual([
      ["ALD-41", "unknown"],
    ]);
  });

  describe("Pipeline cards", () => {
    const card = (over: Partial<PipelineCard> = {}): PipelineCard => ({
      highPriority: false,
      key: "AP-10",
      state: { name: "Pipeline", provider: "trello", state: "open", url: "u" },
      title: "a Pipeline card",
      ...over,
    });

    test("AC3: adds Pipeline and High Priority Pipeline cards, High Priority first", async () => {
      const cards = [
        card({ key: "AP-10", title: "regular" }),
        card({
          highPriority: true,
          key: "AP-11",
          state: {
            name: "High Priority Pipeline",
            provider: "trello",
            state: "open",
            url: "u",
          },
          title: "urgent",
        }),
      ];
      const h = await home(
        roots,
        join(root, "state/unplaced.json"),
        [],
        undefined,
        {},
        cards
      );
      expect(h.ready.map((t) => t.key)).toEqual(["AP-11", "AP-10"]);
    });

    test("AC3: a card already tracked by a ledger is not added twice", async () => {
      await put(
        `${APP}/features/admin/invoicing/ledger.json`,
        await readyFixture()
      );
      const h = await home(
        roots,
        join(root, "state/unplaced.json"),
        [],
        undefined,
        {},
        [card({ key: "ALD-41", title: "duplicate" })]
      );
      expect(h.ready.map((t) => t.key)).toEqual(["ALD-41"]);
      expect(h.ready[0]?.title).not.toBe("duplicate");
    });

    test("AC3: a Pipeline card's url comes from its state, for the TicketLink to its Trello card", async () => {
      const h = await home(
        roots,
        join(root, "state/unplaced.json"),
        [],
        undefined,
        {},
        [
          card({
            state: {
              name: "Pipeline",
              provider: "trello",
              state: "open",
              url: "https://trello.com/c/LRENc1a3",
            },
          }),
        ]
      );
      expect(h.ready[0]?.url).toBe("https://trello.com/c/LRENc1a3");
    });

    test("a Pipeline card assigned to someone else is dropped, like any other ticket", async () => {
      const h = await home(
        roots,
        join(root, "state/unplaced.json"),
        [],
        undefined,
        { trello: "liam-trello-id" },
        [
          card({
            state: {
              assignee: { id: "someone-else" },
              name: "Pipeline",
              provider: "trello",
              state: "open",
              url: "u",
            },
          }),
        ]
      );
      expect(h.ready).toEqual([]);
    });
  });
});
