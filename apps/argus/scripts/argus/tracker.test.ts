import { describe, expect, test } from "bun:test";
import type { CreateTicketInput, Ticket, TicketProvider, UpdateTicketInput } from "@citadel/tickets";
import { trackerCreate, trackerEdit, trackerList, trackerShow } from "./tracker.ts";

const fakeProvider = (
  name: string,
  tickets: Record<string, Ticket>,
  open: Ticket[] = [],
): TicketProvider & { created: CreateTicketInput[]; updated: Array<[string, UpdateTicketInput]> } => {
  const created: CreateTicketInput[] = [];
  const updated: Array<[string, UpdateTicketInput]> = [];
  return {
    name,
    created,
    updated,
    get: async (key) => tickets[key] ?? null,
    states: async () => () => ({ state: "unknown" }),
    listOpen: async (opts) => (opts?.unassigned ? open.filter((t) => t.state.state !== "unknown" && !t.state.assignee) : open),
    async create(input) {
      created.push(input);
      return { key: `${name}-new`, title: input.title, url: "u", description: input.description, state: { state: "open", name: "Todo", url: "u", provider: name } };
    },
    async update(key, input) {
      updated.push([key, input]);
      return { key, title: input.title ?? "t", url: "u", description: input.description ?? "d", state: { state: "open", name: "Todo", url: "u", provider: name } };
    },
    claim: async () => {},
    link: async () => {},
  };
};

describe("trackerShow", () => {
  test("the ticket from the provider its key names", async () => {
    const t: Ticket = { key: "CTD-1", title: "t", url: "u", description: "d", state: { state: "open", name: "Todo", url: "u", provider: "linear" } };
    const linear = fakeProvider("linear", { "CTD-1": t });
    expect(await trackerShow("CTD-1", { providers: { linear } })).toEqual(t);
  });
  test("no such ticket, or a key no provider owns, is refused by name rather than answered null", async () => {
    const linear = fakeProvider("linear", {});
    await expect(trackerShow("CTD-9", { providers: { linear } })).rejects.toThrow("CTD-9: not found");
    await expect(trackerShow("fe#437", { providers: { linear } })).rejects.toThrow("fe#437: not found");
  });
});

describe("trackerList", () => {
  test("passes options through to the router and merges every provider's open list", async () => {
    const open1: Ticket = { key: "CTD-1", title: "a", url: "u", description: "", state: { state: "open", name: "Todo", url: "u", provider: "linear" } };
    const open2: Ticket = { key: "AP-1", title: "b", url: "u", description: "", state: { state: "open", name: "Pipeline", url: "u", provider: "trello" } };
    const linear = fakeProvider("linear", {}, [open1]);
    const trello = fakeProvider("trello", {}, [open2]);
    const out = await trackerList({ providers: { linear, trello } });
    expect(out.map((t) => t.key).sort()).toEqual(["AP-1", "CTD-1"]);
  });
});

describe("trackerCreate", () => {
  test("AC1: shapes the flags into a CreateTicketInput and routes on --team", async () => {
    const linear = fakeProvider("linear", {});
    await trackerCreate({ title: "t", body: "the body", team: "ctd", project: "Argus", assignee: "me" }, { providers: { linear } });
    expect(linear.created).toEqual([{ title: "t", description: "the body", team: "CTD", project: "Argus", assigneeId: "me" }]);
  });
  test("assignee 'none' clears the assignee; an omitted --body is an empty description", async () => {
    const linear = fakeProvider("linear", {});
    await trackerCreate({ title: "t", team: "CTD", assignee: "none" }, { providers: { linear } });
    expect(linear.created).toEqual([{ title: "t", description: "", team: "CTD", assigneeId: null }]);
  });
  test("AC3: a parent and blockers pass through, checked as ticket keys first", async () => {
    const linear = fakeProvider("linear", {});
    await trackerCreate({ title: "t", team: "CTD", parent: "CTD-1", blockedBy: ["CTD-2", "CTD-3"] }, { providers: { linear } });
    expect(linear.created[0]).toMatchObject({ parent: "CTD-1", blockedBy: ["CTD-2", "CTD-3"] });
    await expect(trackerCreate({ title: "t", team: "CTD", parent: "not-a-key" }, { providers: { linear } })).rejects.toThrow('--parent "not-a-key" is not a ticket key');
    await expect(trackerCreate({ title: "t", team: "CTD", blockedBy: ["nope"] }, { providers: { linear } })).rejects.toThrow('--blocked-by "nope" is not a ticket key');
  });
});

describe("trackerEdit", () => {
  test("AC2: carries only the fields given, on the key's own provider", async () => {
    const linear = fakeProvider("linear", {});
    await trackerEdit("CTD-5", { title: "new title", state: "In Progress" }, { providers: { linear } });
    expect(linear.updated).toEqual([["CTD-5", { title: "new title", state: "In Progress" }]]);
  });
  test("nothing given is refused rather than an empty write", async () => {
    const linear = fakeProvider("linear", {});
    await expect(trackerEdit("CTD-5", {}, { providers: { linear } })).rejects.toThrow("CTD-5: nothing to change");
  });
  test("a parent or blocker that is not shaped like a ticket key is refused before anything is written", async () => {
    const linear = fakeProvider("linear", {});
    await expect(trackerEdit("CTD-5", { parent: "nope" }, { providers: { linear } })).rejects.toThrow('--parent "nope" is not a ticket key');
    expect(linear.updated).toEqual([]);
  });
});
