import { describe, expect, test } from "bun:test";
import type { CreateTicketInput, Ticket, TicketProvider, TicketState, TicketStates, UpdateTicketInput } from "./provider.ts";
import { claimTicket, createTicket, getTicket, listOpenTickets, ticketStates, updateTicket } from "./router.ts";

/** a fake provider that answers from a map and records every batch it was asked for, every claim, and every create/update */
function fakeProvider(
  name: string,
  states: Record<string, TicketState>,
  tickets: Record<string, Ticket> = {},
): TicketProvider & { asked: string[][]; claimed: Array<[string, string | undefined]>; created: CreateTicketInput[]; updated: Array<[string, UpdateTicketInput]> } {
  const asked: string[][] = [];
  const claimed: Array<[string, string | undefined]> = [];
  const created: CreateTicketInput[] = [];
  const updated: Array<[string, UpdateTicketInput]> = [];
  return {
    name,
    asked,
    claimed,
    created,
    updated,
    async states(keys) {
      asked.push(keys);
      const lookup: TicketStates = (k) => states[k] ?? { state: "unknown" };
      return lookup;
    },
    async get(key) {
      return tickets[key] ?? null;
    },
    async listOpen() {
      throw new Error("not used in these tests");
    },
    async create(input) {
      created.push(input);
      return { key: `${name}-new`, title: input.title, url: "u", description: input.description, state: { state: "open", name: "Todo", url: "u", provider: name } };
    },
    async update(key, input) {
      updated.push([key, input]);
      return { key, title: input.title ?? "t", url: "u", description: input.description ?? "d", state: { state: "open", name: "Todo", url: "u", provider: name } };
    },
    async claim(key, assigneeId) {
      claimed.push([key, assigneeId]);
    },
    async link() {
      throw new Error("not used in these tests");
    },
  };
}

describe("ticketStates", () => {
  test("today's table batches every key it owns — ALD and CTD alike — into one call to Linear", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u", provider: "linear" }, "CTD-2": { state: "done", at: "2026-09-14", name: "Done", url: "u", provider: "linear" } });
    const s = await ticketStates(["ALD-1", "CTD-2"], { providers: { linear } });
    expect(linear.asked).toEqual([["ALD-1", "CTD-2"]]);
    expect(s("ALD-1").state).toBe("open");
    expect(s("CTD-2").state).toBe("done");
  });
  test("each provider is asked once, with only the keys its prefix owns — through the real table, AP included", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u", provider: "linear" } });
    const trello = fakeProvider("trello", { "AP-1": { state: "done", at: "2026-09-14", name: "Deployed", url: "u", provider: "trello" } });
    const s = await ticketStates(["ALD-1", "AP-1"], { providers: { linear, trello } });
    expect(linear.asked).toEqual([["ALD-1"]]);
    expect(trello.asked).toEqual([["AP-1"]]);
    expect(s("ALD-1").state).toBe("open");
    expect(s("AP-1").state).toBe("done");
  });
  test("a key no provider owns, and a provider this run has none registered for, answer unknown", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u", provider: "linear" } });
    const s = await ticketStates(["ALD-1", "AP-1", "fe#437"], { providers: { linear } });
    expect(s("ALD-1").state).toBe("open");
    expect(s("AP-1")).toEqual({ state: "unknown" });
    expect(s("fe#437")).toEqual({ state: "unknown" });
  });
  test("a provider that throws leaves its own keys unknown; the other provider still settles", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u", provider: "linear" } });
    const failing: TicketProvider = {
      name: "trello",
      async states() {
        throw new Error("board unreachable");
      },
      get: async () => null,
      listOpen: async () => [],
      create: async () => {
        throw new Error("not used");
      },
      update: async () => {
        throw new Error("not used");
      },
      claim: async () => {},
      link: async () => {},
    };
    const s = await ticketStates(["ALD-1", "AP-1"], { providers: { linear, trello: failing } });
    expect(s("ALD-1").state).toBe("open");
    expect(s("AP-1")).toEqual({ state: "unknown" });
  });
  test("no keys asks no provider", async () => {
    const linear = fakeProvider("linear", {});
    const s = await ticketStates([], { providers: { linear } });
    expect(linear.asked).toEqual([]);
    expect(s("ALD-1")).toEqual({ state: "unknown" });
  });
});

describe("listOpenTickets", () => {
  const openProvider = (name: string, tickets: Ticket[], fail?: string): TicketProvider & { asked: unknown[] } => {
    const asked: unknown[] = [];
    return {
      ...fakeProvider(name, {}),
      asked,
      async listOpen(opts) {
        asked.push(opts ?? {});
        if (fail) throw new Error(fail);
        return tickets;
      },
    };
  };
  const ticket = (key: string, provider: string): Ticket => ({ key, title: key, url: "u", description: "", state: { state: "open", name: "Todo", url: "u", provider } });

  test("--team routes to the one provider that team names, and passes the options through", async () => {
    const linear = openProvider("linear", [ticket("CTD-1", "linear")]);
    const trello = openProvider("trello", [ticket("AP-1", "trello")]);
    const out = await listOpenTickets({ team: "CTD", mine: true, providers: { linear, trello } });
    expect(out).toEqual([ticket("CTD-1", "linear")]);
    expect(linear.asked).toEqual([{ team: "CTD", mine: true, providers: { linear, trello } }]);
    expect(trello.asked).toEqual([]);
  });

  test("--team propagates that one provider's throw rather than falling back", async () => {
    const linear = openProvider("linear", [], "LINEAR_API_KEY is not set");
    await expect(listOpenTickets({ team: "ALD", providers: { linear } })).rejects.toThrow("LINEAR_API_KEY");
  });

  test("an unknown team, or one this run has no provider for, throws by name", async () => {
    await expect(listOpenTickets({ team: "LIA", providers: {} })).rejects.toThrow("LIA: not a known team");
    await expect(listOpenTickets({ team: "AP", providers: {} })).rejects.toThrow("AP: no trello provider registered");
  });

  test("no team asks every registered provider and merges the answers", async () => {
    const linear = openProvider("linear", [ticket("CTD-1", "linear")]);
    const trello = openProvider("trello", [ticket("AP-1", "trello")]);
    const out = await listOpenTickets({ providers: { linear, trello } });
    expect(out.map((t) => t.key).sort()).toEqual(["AP-1", "CTD-1"]);
  });

  test("no team: a provider that throws is skipped, the other's list still comes back", async () => {
    const linear = openProvider("linear", [ticket("CTD-1", "linear")]);
    const trello = openProvider("trello", [], "TRELLO_API_KEY is not set");
    const out = await listOpenTickets({ providers: { linear, trello } });
    expect(out).toEqual([ticket("CTD-1", "linear")]);
  });
});

describe("getTicket", () => {
  test("routes to the key's provider", async () => {
    const ticket: Ticket = { key: "ALD-1", title: "t", url: "u", description: "d", state: { state: "open", name: "Todo", url: "u", provider: "linear" } };
    const linear = fakeProvider("linear", {}, { "ALD-1": ticket });
    expect(await getTicket("ALD-1", { providers: { linear } })).toEqual(ticket);
  });
  test("a key no provider owns, or a provider this run has none registered for, answers null", async () => {
    const linear = fakeProvider("linear", {});
    expect(await getTicket("AP-1", { providers: { linear } })).toBeNull();
    expect(await getTicket("fe#437", { providers: { linear } })).toBeNull();
  });
});

describe("claimTicket", () => {
  test("routes to the key's provider, with the assigneeId passed through", async () => {
    const linear = fakeProvider("linear", {});
    await claimTicket("ALD-1", "u1", { providers: { linear } });
    expect(linear.claimed).toEqual([["ALD-1", "u1"]]);
  });
  test("an omitted assigneeId reaches the provider as undefined", async () => {
    const linear = fakeProvider("linear", {});
    await claimTicket("ALD-1", undefined, { providers: { linear } });
    expect(linear.claimed).toEqual([["ALD-1", undefined]]);
  });
  test("a key no provider owns, or a provider this run has none registered for, throws naming the key", async () => {
    const linear = fakeProvider("linear", {});
    await expect(claimTicket("AP-1", "u1", { providers: { linear } })).rejects.toThrow("AP-1");
    await expect(claimTicket("fe#437", "u1", { providers: { linear } })).rejects.toThrow("fe#437");
  });
});

describe("createTicket", () => {
  test("routes to the provider its team names", async () => {
    const linear = fakeProvider("linear", {});
    const trello = fakeProvider("trello", {});
    const input: CreateTicketInput = { title: "t", description: "d", team: "CTD" };
    await createTicket(input, { providers: { linear, trello } });
    expect(linear.created).toEqual([input]);
    expect(trello.created).toEqual([]);
  });
  test("a team no provider owns, or a provider this run has none registered for, throws naming the team", async () => {
    const linear = fakeProvider("linear", {});
    await expect(createTicket({ title: "t", description: "d", team: "LIA" }, { providers: { linear } })).rejects.toThrow("LIA");
    await expect(createTicket({ title: "t", description: "d", team: "AP" }, { providers: { linear } })).rejects.toThrow("AP");
  });
});

describe("updateTicket", () => {
  test("routes to the key's provider", async () => {
    const linear = fakeProvider("linear", {});
    const trello = fakeProvider("trello", {});
    await updateTicket("ALD-1", { title: "new" }, { providers: { linear, trello } });
    expect(linear.updated).toEqual([["ALD-1", { title: "new" }]]);
    expect(trello.updated).toEqual([]);
  });
  test("a key no provider owns, or a provider this run has none registered for, throws naming the key", async () => {
    const linear = fakeProvider("linear", {});
    await expect(updateTicket("AP-1", { title: "new" }, { providers: { linear } })).rejects.toThrow("AP-1");
    await expect(updateTicket("fe#437", { title: "new" }, { providers: { linear } })).rejects.toThrow("fe#437");
  });
});
