import { describe, expect, spyOn, test } from "bun:test";
import { TRELLO_BOARD_ID, trelloGet, trelloTicketStates } from "./trello.ts";

const now = new Date("2026-09-14T10:00:00Z");

const card = (id: string, idShort: number | null, idList: string, extra: Record<string, unknown> = {}) => ({
  id,
  idShort,
  idList,
  idMembers: [],
  name: `card ${idShort ?? id}`,
  desc: "",
  shortUrl: `https://trello.com/c/${id}`,
  url: `https://trello.com/c/${id}/${idShort ?? 0}-card`,
  ...extra,
});

const TEN_LISTS = [
  { id: "L-new", name: "New Reports" },
  { id: "L-hold", name: "Holding Pattern" },
  { id: "L-pipe", name: "Pipeline" },
  { id: "L-hpipe", name: "High Priority Pipeline" },
  { id: "L-prog", name: "In Progress" },
  { id: "L-test", name: "Testing" },
  { id: "L-stage", name: "Staging" },
  { id: "L-deploy", name: "Deployed" },
  { id: "L-notbug", name: "Feature not a bug" },
  { id: "L-agent", name: "Ready for Agent" },
];

const TEN_CARDS = [
  card("c101", 101, "L-new"),
  card("c102", 102, "L-hold"),
  card("c103", 103, "L-pipe"),
  card("c104", 104, "L-hpipe"),
  card("c105", 105, "L-prog"),
  card("c106", 106, "L-test"),
  card("c107", 107, "L-stage"),
  card("c108", 108, "L-deploy"),
  card("c109", 109, "L-notbug"),
  card("c110", 110, "L-agent"),
];

/** a fetch stub over one board; records every URL asked for */
function fakeFetch(board: { cards: unknown[]; lists: unknown[]; checklists?: unknown[] }, calls: string[] = []) {
  return (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/checklists?")) return new Response(JSON.stringify(board.checklists ?? []));
    if (u.includes("/cards?")) return new Response(JSON.stringify(board.cards));
    if (u.includes("/lists?")) return new Response(JSON.stringify(board.lists));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("trelloTicketStates", () => {
  test("each of the board's ten lists maps to its state, by name; a card number the board does not have is unknown", async () => {
    const calls: string[] = [];
    const s = await trelloTicketStates(
      ["AP-101", "AP-102", "AP-103", "AP-104", "AP-105", "AP-106", "AP-107", "AP-108", "AP-109", "AP-110", "AP-999"],
      { fetch: fakeFetch({ cards: TEN_CARDS, lists: TEN_LISTS }, calls), trelloKey: "k", trelloToken: "t", now },
    );
    expect(s("AP-101")).toMatchObject({ state: "open", name: "New Reports", stage: "triage" });
    expect(s("AP-102")).toMatchObject({ state: "open", name: "Holding Pattern", stage: "triage" });
    expect(s("AP-103")).toMatchObject({ state: "open", name: "Pipeline", stage: "unstarted" });
    expect(s("AP-104")).toMatchObject({ state: "open", name: "High Priority Pipeline", stage: "unstarted" });
    expect(s("AP-105")).toMatchObject({ state: "open", name: "In Progress", stage: "started" });
    expect(s("AP-106")).toMatchObject({ state: "open", name: "Testing", stage: "started" });
    expect(s("AP-107")).toMatchObject({ state: "open", name: "Staging", stage: "started" });
    expect(s("AP-108")).toEqual({ state: "done", at: now.toISOString(), name: "Deployed", url: "https://trello.com/c/c108", provider: "trello" });
    expect(s("AP-109")).toEqual({ state: "canceled", at: now.toISOString(), name: "Feature not a bug", url: "https://trello.com/c/c109", provider: "trello" });
    expect(s("AP-110")).toMatchObject({ state: "open", name: "Ready for Agent", stage: "started" });
    expect(s("AP-999")).toEqual({ state: "unknown" });
    // one call for the cards, one for the lists, whatever the number of keys asked for
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.includes(TRELLO_BOARD_ID))).toBe(true);
    expect(calls.some((c) => c.includes("fields=idShort%2CidList%2CidMembers%2Cname%2Cdesc%2CshortUrl%2Curl"))).toBe(true);
  });

  test("a card whose idShort is null resolves by the number its own url shows", async () => {
    const nullShort = card("c555", null, "L-pipe", { url: "https://trello.com/c/c555/555-idshort-null-card" });
    const s = await trelloTicketStates(["AP-555"], { fetch: fakeFetch({ cards: [nullShort], lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now });
    expect(s("AP-555").state).toBe("open");
  });

  test("an assignee rides along when the card has one; none is left off", async () => {
    const assigned = card("c101", 101, "L-new", { idMembers: ["u1"] });
    const s = await trelloTicketStates(["AP-101"], { fetch: fakeFetch({ cards: [assigned], lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now });
    expect(s("AP-101")).toMatchObject({ assignee: { id: "u1" } });
  });

  test("a card on a list the map does not know is left open with the list's name, reported once", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const lists = [...TEN_LISTS, { id: "L-mystery", name: "Backlog Graveyard" }];
      const cards = [card("c300", 300, "L-mystery"), card("c301", 301, "L-mystery")];
      const s = await trelloTicketStates(["AP-300", "AP-301"], { fetch: fakeFetch({ cards, lists }), trelloKey: "k", trelloToken: "t", now });
      expect(s("AP-300")).toEqual({ state: "open", name: "Backlog Graveyard", url: "https://trello.com/c/c300", provider: "trello" });
      expect(s("AP-301")).toEqual({ state: "open", name: "Backlog Graveyard", url: "https://trello.com/c/c301", provider: "trello" });
      const lines = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("Backlog Graveyard"));
      expect(lines).toHaveLength(1);
    } finally {
      errSpy.mockRestore();
    }
  });

  test("no credential asks nothing, leaves every AP key unknown, and names the missing variable once", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const calls: string[] = [];
      const board = { cards: TEN_CARDS, lists: TEN_LISTS };
      const noKey = await trelloTicketStates(["AP-101", "AP-102"], { fetch: fakeFetch(board, calls), trelloKey: null, trelloToken: "t" });
      expect(calls).toEqual([]);
      expect(noKey("AP-101")).toEqual({ state: "unknown" });
      expect(noKey("AP-102")).toEqual({ state: "unknown" });
      const noToken = await trelloTicketStates(["AP-101"], { fetch: fakeFetch(board, calls), trelloKey: "k", trelloToken: null });
      expect(noToken("AP-101")).toEqual({ state: "unknown" });
      const neither = await trelloTicketStates(["AP-101"], { fetch: fakeFetch(board, calls), trelloKey: null, trelloToken: null });
      expect(neither("AP-101")).toEqual({ state: "unknown" });
      expect(calls).toEqual([]);
      const lines = errSpy.mock.calls.map((c) => String(c[0]));
      expect(lines).toEqual([
        expect.stringContaining("TRELLO_API_KEY"),
        expect.stringContaining("TRELLO_TOKEN"),
        expect.stringContaining("TRELLO_API_KEY and TRELLO_TOKEN"),
      ]);
    } finally {
      errSpy.mockRestore();
    }
  });

  test("keys that are not AP ask nothing; a failed request leaves every key unknown rather than throwing", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const none = await trelloTicketStates(["ALD-1", "fe#437"], { fetch: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch, trelloKey: "k", trelloToken: "t" });
      expect(none("ALD-1")).toEqual({ state: "unknown" });
      const failing = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
      const s = await trelloTicketStates(["AP-101"], { fetch: failing, trelloKey: "k", trelloToken: "t" });
      expect(s("AP-101")).toEqual({ state: "unknown" });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("trelloGet", () => {
  test("AC1: the named card, by its idShort, with its title, url, description and state", async () => {
    const named = card("cAP207", 207, "L-new", {
      name: "In Client view, can we also have tab projects…",
      desc: "the body",
      shortUrl: "https://trello.com/c/abc207",
      url: "https://trello.com/c/abc207/207-in-client-view",
      idMembers: ["u1"],
    });
    const t = await trelloGet("AP-207", { fetch: fakeFetch({ cards: [named], lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now });
    expect(t).toEqual({
      key: "AP-207",
      title: "In Client view, can we also have tab projects…",
      url: "https://trello.com/c/abc207",
      description: "the body",
      state: { state: "open", name: "New Reports", url: "https://trello.com/c/abc207", provider: "trello", assignee: { id: "u1" }, stage: "triage" },
    });
  });

  test("a card whose idShort is null resolves by the number its own url shows", async () => {
    const nullShort = card("c555", null, "L-pipe", { url: "https://trello.com/c/c555/555-idshort-null-card" });
    const t = await trelloGet("AP-555", { fetch: fakeFetch({ cards: [nullShort], lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now });
    expect(t?.key).toBe("AP-555");
  });

  test("a number the board does not have answers null", async () => {
    const t = await trelloGet("AP-999", { fetch: fakeFetch({ cards: TEN_CARDS, lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now });
    expect(t).toBeNull();
  });

  test("a key no provider owns answers null without asking Trello", async () => {
    const t = await trelloGet("ALD-1", { fetch: (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch, trelloKey: "k", trelloToken: "t" });
    expect(t).toBeNull();
  });

  test("no credential throws, naming the variable", async () => {
    await expect(trelloGet("AP-1", { trelloKey: null, trelloToken: "t" })).rejects.toThrow("TRELLO_API_KEY");
    await expect(trelloGet("AP-1", { trelloKey: "k", trelloToken: null })).rejects.toThrow("TRELLO_TOKEN");
  });

  test("the parent is the one card whose checklist item names or links this card; none, or two, is no parent", async () => {
    const child = card("cChild", 207, "L-pipe");
    const parent = card("cParent", 200, "L-pipe");
    const otherParent = card("cOther", 201, "L-pipe");
    const board = (checklists: unknown[]) => ({ cards: [child, parent, otherParent], lists: TEN_LISTS, checklists });

    const named = await trelloGet("AP-207", { fetch: fakeFetch(board([{ idCard: "cParent", checkItems: [{ name: "AP-207 tab projects" }] }])), trelloKey: "k", trelloToken: "t", now });
    expect(named?.parentKey).toBe("AP-200");

    const linked = await trelloGet("AP-207", { fetch: fakeFetch(board([{ idCard: "cParent", checkItems: [{ name: `linked: ${child.shortUrl}` }] }])), trelloKey: "k", trelloToken: "t", now });
    expect(linked?.parentKey).toBe("AP-200");

    const none = await trelloGet("AP-207", { fetch: fakeFetch(board([{ idCard: "cParent", checkItems: [{ name: "unrelated item" }] }])), trelloKey: "k", trelloToken: "t", now });
    expect(none?.parentKey).toBeUndefined();

    const selfOnly = await trelloGet("AP-207", { fetch: fakeFetch(board([{ idCard: "cChild", checkItems: [{ name: "AP-207 self-reference" }] }])), trelloKey: "k", trelloToken: "t", now });
    expect(selfOnly?.parentKey).toBeUndefined();

    const two = await trelloGet(
      "AP-207",
      { fetch: fakeFetch(board([{ idCard: "cParent", checkItems: [{ name: "AP-207" }] }, { idCard: "cOther", checkItems: [{ name: "AP-207" }] }])), trelloKey: "k", trelloToken: "t", now },
    );
    expect(two?.parentKey).toBeUndefined();
  });
});
