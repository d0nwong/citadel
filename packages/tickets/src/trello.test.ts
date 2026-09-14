import { describe, expect, spyOn, test } from "bun:test";
import { MissingCredentialError } from "./errors.ts";
import { TRELLO_BOARD_ID, TRELLO_CHECKLIST_NAME, TRELLO_PIPELINE_LIST, trelloCreate, trelloGet, trelloListOpen, trelloTicketStates, trelloUpdate } from "./trello.ts";

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
function fakeFetch(board: { cards: unknown[]; lists: unknown[]; checklists?: unknown[]; me?: { id: string } }, calls: string[] = []) {
  return (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/members/me")) return new Response(JSON.stringify(board.me ?? { id: "u1" }));
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

describe("trelloListOpen", () => {
  test("Deployed and Feature not a bug are excluded; every other card comes back open, no parent computed", async () => {
    const calls: string[] = [];
    const tickets = await trelloListOpen({ fetch: fakeFetch({ cards: TEN_CARDS, lists: TEN_LISTS }, calls), trelloKey: "k", trelloToken: "t", now });
    expect(tickets.map((t) => t.key).sort()).toEqual(["AP-101", "AP-102", "AP-103", "AP-104", "AP-105", "AP-106", "AP-107", "AP-110"]);
    expect(tickets.every((t) => t.parentKey === undefined)).toBe(true);
    expect(calls.some((c) => c.includes("/checklists?"))).toBe(false);
    expect(calls.some((c) => c.includes("/members/me"))).toBe(false);
  });

  test("--unassigned keeps only cards with no member; --mine keeps only the viewer's", async () => {
    const cards = [card("c101", 101, "L-pipe", { idMembers: [] }), card("c102", 102, "L-pipe", { idMembers: ["u1"] }), card("c103", 103, "L-pipe", { idMembers: ["u2"] })];
    const unassigned = await trelloListOpen({ fetch: fakeFetch({ cards, lists: TEN_LISTS }), trelloKey: "k", trelloToken: "t", now, unassigned: true });
    expect(unassigned.map((t) => t.key)).toEqual(["AP-101"]);
    const calls: string[] = [];
    const mine = await trelloListOpen({ fetch: fakeFetch({ cards, lists: TEN_LISTS, me: { id: "u1" } }, calls), trelloKey: "k", trelloToken: "t", now, mine: true });
    expect(mine.map((t) => t.key)).toEqual(["AP-102"]);
    expect(calls.some((c) => c.includes("/members/me"))).toBe(true);
  });

  test("no credential throws, naming the missing variable", async () => {
    await expect(trelloListOpen({ trelloKey: null, trelloToken: "t" })).rejects.toThrow("TRELLO_API_KEY");
    await expect(trelloListOpen({ trelloKey: "k", trelloToken: null })).rejects.toThrow("TRELLO_TOKEN");
  });
});

type Call = { method: string; path: string; params: Record<string, string> };

/** a fetch stub with both the board's reads and its writes, dispatched by method + path; records every call */
function fakeWrite(
  board: { cards?: unknown[]; lists?: unknown[]; labels?: unknown[]; me?: { id: string }; checklistsByCard?: Record<string, unknown[]>; boardChecklists?: unknown[] },
  responses: { createCard?: unknown; createLabel?: unknown; createChecklist?: unknown; updateCard?: unknown } = {},
  calls: Call[] = [],
) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method as string) ?? "GET";
    const path = u.pathname.replace(/^\/1/, "");
    const params = Object.fromEntries(u.searchParams);
    calls.push({ method, path, params });
    const json = (body: unknown) => new Response(JSON.stringify(body ?? {}));
    if (method === "GET" && path === `/boards/${TRELLO_BOARD_ID}/cards`) return json(board.cards ?? []);
    if (method === "GET" && path === `/boards/${TRELLO_BOARD_ID}/lists`) return json(board.lists ?? []);
    if (method === "GET" && path === `/boards/${TRELLO_BOARD_ID}/labels`) return json(board.labels ?? []);
    if (method === "GET" && path === "/members/me") return json(board.me ?? { id: "u1" });
    if (method === "GET" && path === `/boards/${TRELLO_BOARD_ID}/checklists`) return json(board.boardChecklists ?? []);
    const cardChecklists = /^\/cards\/([^/]+)\/checklists$/.exec(path);
    if (method === "GET" && cardChecklists) return json(board.checklistsByCard?.[cardChecklists[1]!] ?? []);
    if (method === "POST" && path === "/cards") return json(responses.createCard);
    if (method === "POST" && path === "/labels") return json(responses.createLabel ?? { id: "label-new", name: params.name });
    if (method === "POST" && path === "/checklists") return json(responses.createChecklist ?? { id: "checklist-new", idCard: params.idCard, checkItems: [] });
    if (method === "POST" && /^\/checklists\/[^/]+\/checkItems$/.test(path)) return json({ id: "item-new", name: params.name });
    if (method === "POST" && /^\/cards\/[^/]+\/idLabels$/.test(path)) return json([params.value]);
    if (method === "PUT" && /^\/cards\/[^/]+$/.test(path)) return json(responses.updateCard);
    if (method === "DELETE" && /^\/checklists\/[^/]+\/checkItems\/[^/]+$/.test(path)) return json({});
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("trelloCreate", () => {
  test("AC1: posts into Pipeline with the label and member resolved, and answers the new card's key and url", async () => {
    const calls: Call[] = [];
    const created = card("cNew", 555, "L-pipe", { name: "t", desc: "d", idMembers: ["u9"] });
    const f = fakeWrite({ lists: TEN_LISTS, labels: [{ id: "lbl-1", name: "Admin - Invoicing" }], me: { id: "u9" } }, { createCard: created }, calls);
    const t = await trelloCreate({ title: "t", description: "d", team: "AP", project: "Admin - Invoicing", assigneeId: "me" }, { fetch: f, trelloKey: "k", trelloToken: "tok", now });
    expect(t).toEqual({
      key: "AP-555",
      title: "t",
      url: created.shortUrl,
      description: "d",
      state: { state: "open", name: TRELLO_PIPELINE_LIST, url: created.shortUrl, provider: "trello", assignee: { id: "u9" }, stage: "unstarted" },
    });
    const post = calls.find((c) => c.method === "POST" && c.path === "/cards");
    expect(post?.params).toMatchObject({ idList: "L-pipe", name: "t", desc: "d", idLabels: "lbl-1", idMembers: "u9" });
  });

  test("a label the board does not have yet is created with no colour", async () => {
    const calls: Call[] = [];
    const f = fakeWrite({ lists: TEN_LISTS, labels: [] }, { createCard: card("cNew", 556, "L-pipe") }, calls);
    await trelloCreate({ title: "t", description: "d", team: "AP", project: "New Feature" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    const labelCall = calls.find((c) => c.method === "POST" && c.path === "/labels");
    expect(labelCall?.params).toMatchObject({ name: "New Feature", color: "null", idBoard: TRELLO_BOARD_ID });
  });

  test("blockers become the description's Blocked by: line, at the top", async () => {
    const calls: Call[] = [];
    const f = fakeWrite({ lists: TEN_LISTS }, { createCard: card("cNew", 557, "L-pipe") }, calls);
    await trelloCreate({ title: "t", description: "the body", team: "AP", blockedBy: ["AP-1", "AP-2"] }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    const post = calls.find((c) => c.method === "POST" && c.path === "/cards");
    expect(post?.params.desc).toBe("Blocked by: AP-1, AP-2\nthe body");
  });

  test("AC3: a parent gains one checklist item — the new card's key, title and link — on its first checklist, appended at the bottom", async () => {
    const calls: Call[] = [];
    const created = card("cNew", 558, "L-pipe", { name: "t" });
    const parentCard = card("cParent", 200, "L-pipe");
    const f = fakeWrite(
      { cards: [parentCard], lists: TEN_LISTS, checklistsByCard: { cParent: [{ id: "cl-1", idCard: "cParent", checkItems: [{ id: "i1", name: "existing" }] }] } },
      { createCard: created },
      calls,
    );
    const t = await trelloCreate({ title: "t", description: "d", team: "AP", parent: "AP-200" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    expect(t.parentKey).toBe("AP-200");
    const item = calls.find((c) => c.method === "POST" && c.path === "/checklists/cl-1/checkItems");
    expect(item?.params).toMatchObject({ name: `AP-558 — t — ${created.shortUrl}`, pos: "bottom" });
    expect(calls.some((c) => c.method === "POST" && c.path === "/checklists")).toBe(false);
  });

  test("no existing checklist on the parent creates one named Tickets", async () => {
    const calls: Call[] = [];
    const parentCard = card("cParent", 201, "L-pipe");
    const f = fakeWrite(
      { cards: [parentCard], lists: TEN_LISTS, checklistsByCard: { cParent: [] } },
      { createCard: card("cNew", 559, "L-pipe", { name: "t" }), createChecklist: { id: "cl-new", idCard: "cParent", checkItems: [] } },
      calls,
    );
    await trelloCreate({ title: "t", description: "d", team: "AP", parent: "AP-201" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    expect(calls.find((c) => c.method === "POST" && c.path === "/checklists")?.params).toMatchObject({ idCard: "cParent", name: TRELLO_CHECKLIST_NAME });
    expect(calls.some((c) => c.method === "POST" && c.path === "/checklists/cl-new/checkItems")).toBe(true);
  });

  test("no credential throws MissingCredentialError naming the first unset variable", async () => {
    await expect(trelloCreate({ title: "t", description: "d", team: "AP" }, { trelloKey: null, trelloToken: "tok" })).rejects.toThrow(MissingCredentialError);
    await expect(trelloCreate({ title: "t", description: "d", team: "AP" }, { trelloKey: "k", trelloToken: null })).rejects.toThrow("TRELLO_TOKEN");
  });

  test("a team that is not the Alden board is refused by name", async () => {
    await expect(trelloCreate({ title: "t", description: "d", team: "CTD" }, { trelloKey: "k", trelloToken: "tok" })).rejects.toThrow("CTD is not the Alden board");
  });

  test("a card created with no readable number is refused", async () => {
    const f = fakeWrite({ lists: TEN_LISTS }, { createCard: card("cNew", null, "L-pipe", { url: "https://trello.com/c/cNew" }) });
    await expect(trelloCreate({ title: "t", description: "d", team: "AP" }, { fetch: f, trelloKey: "k", trelloToken: "tok" })).rejects.toThrow("no readable number");
  });
});

describe("trelloUpdate", () => {
  test("AC2: moves the card to another list by name; an unknown list name is refused, naming what the board has", async () => {
    const original = card("c108", 108, "L-pipe", { name: "t", desc: "d" });
    const moved = card("c108", 108, "L-deploy", { name: "t", desc: "d" });
    const calls: Call[] = [];
    const f = fakeWrite({ cards: [original], lists: TEN_LISTS }, { updateCard: moved }, calls);
    const t = await trelloUpdate("AP-108", { state: "Deployed" }, { fetch: f, trelloKey: "k", trelloToken: "tok", now });
    expect(t.state).toEqual({ state: "done", at: now.toISOString(), name: "Deployed", url: moved.shortUrl, provider: "trello" });
    const put = calls.find((c) => c.method === "PUT" && c.path === "/cards/c108");
    expect(put?.params).toMatchObject({ idList: "L-deploy" });
    const badList = fakeWrite({ cards: [original], lists: TEN_LISTS });
    await expect(trelloUpdate("AP-108", { state: "Bogus" }, { fetch: badList, trelloKey: "k", trelloToken: "tok" })).rejects.toThrow('no list named "Bogus"');
  });

  test("title alone is carried in one PUT; unrelated fields are left off", async () => {
    const original = card("c108", 108, "L-pipe", { name: "old", desc: "d" });
    const calls: Call[] = [];
    const f = fakeWrite({ cards: [original], lists: TEN_LISTS }, { updateCard: card("c108", 108, "L-pipe", { name: "new title", desc: "d" }) }, calls);
    await trelloUpdate("AP-108", { title: "new title" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    const put = calls.find((c) => c.method === "PUT" && c.path === "/cards/c108");
    expect(put?.params).toMatchObject({ name: "new title" });
    expect(put?.params.desc).toBeUndefined();
    expect(put?.params.idList).toBeUndefined();
    expect(put?.params.idMembers).toBeUndefined();
  });

  test("assigneeId: 'me' resolves to the viewer, null clears the member, an id passes through", async () => {
    const original = card("c108", 108, "L-pipe");
    const calls: Call[] = [];
    const f = fakeWrite({ cards: [original], lists: TEN_LISTS, me: { id: "u9" } }, { updateCard: original }, calls);
    await trelloUpdate("AP-108", { assigneeId: "me" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    await trelloUpdate("AP-108", { assigneeId: null }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    await trelloUpdate("AP-108", { assigneeId: "user-7" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    const members = calls.filter((c) => c.method === "PUT" && c.path === "/cards/c108").map((c) => c.params.idMembers);
    expect(members).toEqual(["u9", "", "user-7"]);
  });

  test("a description change preserves an existing Blocked by line; a blockedBy change rewrites it, leaving the rest alone", async () => {
    const original = card("c108", 108, "L-pipe", { desc: "Blocked by: AP-1\nold body" });
    const calls: Call[] = [];
    const f = fakeWrite({ cards: [original], lists: TEN_LISTS }, { updateCard: original }, calls);
    await trelloUpdate("AP-108", { description: "new body" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    await trelloUpdate("AP-108", { blockedBy: ["AP-2", "AP-3"] }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    const descs = calls.filter((c) => c.method === "PUT" && c.path === "/cards/c108").map((c) => c.params.desc);
    expect(descs).toEqual(["Blocked by: AP-1\nnew body", "Blocked by: AP-2, AP-3\nold body"]);
  });

  test("a label is added without touching one already on the card, and without an otherwise-empty PUT", async () => {
    const original = card("c108", 108, "L-pipe");
    const calls: Call[] = [];
    const f = fakeWrite({ cards: [original], lists: TEN_LISTS, labels: [{ id: "lbl-9", name: "Admin - Invoicing" }] }, { updateCard: original }, calls);
    await trelloUpdate("AP-108", { project: "Admin - Invoicing" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    expect(calls.find((c) => c.method === "POST" && c.path === "/cards/c108/idLabels")?.params).toMatchObject({ value: "lbl-9" });
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  test("AC3-adjacent (S-42): a parent re-attaches the card's checklist item, first dropping it off whichever checklist already named it", async () => {
    const child = card("cChild", 108, "L-pipe");
    const newParent = card("cNewParent", 201, "L-pipe");
    const calls: Call[] = [];
    const f = fakeWrite(
      {
        cards: [child, newParent],
        lists: TEN_LISTS,
        boardChecklists: [{ id: "cl-old", idCard: "cOldParent", checkItems: [{ id: "i1", name: "AP-108 — old title — https://trello.com/cChild" }] }],
        checklistsByCard: { cNewParent: [{ id: "cl-new", idCard: "cNewParent", checkItems: [] }] },
      },
      { updateCard: child },
      calls,
    );
    await trelloUpdate("AP-108", { parent: "AP-201" }, { fetch: f, trelloKey: "k", trelloToken: "tok" });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/checklists/cl-old/checkItems/i1")).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path === "/checklists/cl-new/checkItems")).toBe(true);
  });

  test("no credential throws MissingCredentialError naming the first unset variable", async () => {
    await expect(trelloUpdate("AP-108", {}, { trelloKey: null, trelloToken: "tok" })).rejects.toThrow(MissingCredentialError);
    await expect(trelloUpdate("AP-108", {}, { trelloKey: "k", trelloToken: null })).rejects.toThrow("TRELLO_TOKEN");
  });

  test("a key that is not AP, or a card the board does not have, is refused by name", async () => {
    await expect(trelloUpdate("CTD-1", {}, { trelloKey: "k", trelloToken: "tok" })).rejects.toThrow("CTD-1 is not an AP card");
    const f = fakeWrite({ cards: [], lists: TEN_LISTS });
    await expect(trelloUpdate("AP-999", {}, { fetch: f, trelloKey: "k", trelloToken: "tok" })).rejects.toThrow("no such card AP-999");
  });
});
