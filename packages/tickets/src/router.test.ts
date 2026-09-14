import { describe, expect, test } from "bun:test";
import type { Ticket, TicketProvider, TicketState, TicketStates } from "./provider.ts";
import { getTicket, ticketStates } from "./router.ts";

/** a fake provider that answers from a map and records every batch it was asked for */
function fakeProvider(name: string, states: Record<string, TicketState>, tickets: Record<string, Ticket> = {}): TicketProvider & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    name,
    asked,
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
    async create() {
      throw new Error("not used in these tests");
    },
    async update() {
      throw new Error("not used in these tests");
    },
    async claim() {
      throw new Error("not used in these tests");
    },
    async link() {
      throw new Error("not used in these tests");
    },
  };
}

/** `ALD-*` and `CTD-*` route to "linear", `AP-*` to "trello" — a test-only stand-in for
 * the day the real table grows a second provider (ticket 2), so the merge logic is proved
 * without waiting on it. */
const twoProviders = (key: string): string | null => (key.startsWith("ALD-") || key.startsWith("CTD-") ? "linear" : key.startsWith("AP-") ? "trello" : null);

describe("ticketStates", () => {
  test("today's table batches every key it owns — ALD and CTD alike — into one call to Linear", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u" }, "CTD-2": { state: "done", at: "2026-09-14", name: "Done", url: "u" } });
    const s = await ticketStates(["ALD-1", "CTD-2"], { providers: { linear } });
    expect(linear.asked).toEqual([["ALD-1", "CTD-2"]]);
    expect(s("ALD-1").state).toBe("open");
    expect(s("CTD-2").state).toBe("done");
  });
  test("each provider is asked once, with only the keys its prefix owns", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u" } });
    const trello = fakeProvider("trello", { "AP-1": { state: "done", at: "2026-09-14", name: "Deployed", url: "u" } });
    const s = await ticketStates(["ALD-1", "AP-1"], { providers: { linear, trello }, routeKey: twoProviders });
    expect(linear.asked).toEqual([["ALD-1"]]);
    expect(trello.asked).toEqual([["AP-1"]]);
    expect(s("ALD-1").state).toBe("open");
    expect(s("AP-1").state).toBe("done");
  });
  test("a key no provider owns, and a provider this run has none registered for, answer unknown", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u" } });
    const s = await ticketStates(["ALD-1", "AP-1", "fe#437"], { providers: { linear } });
    expect(s("ALD-1").state).toBe("open");
    expect(s("AP-1")).toEqual({ state: "unknown" });
    expect(s("fe#437")).toEqual({ state: "unknown" });
  });
  test("a provider that throws leaves its own keys unknown; the other provider still settles", async () => {
    const linear = fakeProvider("linear", { "ALD-1": { state: "open", name: "Todo", url: "u" } });
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
    const s = await ticketStates(["ALD-1", "AP-1"], { providers: { linear, trello: failing }, routeKey: twoProviders });
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

describe("getTicket", () => {
  test("routes to the key's provider", async () => {
    const ticket: Ticket = { key: "ALD-1", title: "t", url: "u", description: "d", state: { state: "open", name: "Todo", url: "u" } };
    const linear = fakeProvider("linear", {}, { "ALD-1": ticket });
    expect(await getTicket("ALD-1", { providers: { linear } })).toEqual(ticket);
  });
  test("a key no provider owns, or a provider this run has none registered for, answers null", async () => {
    const linear = fakeProvider("linear", {});
    expect(await getTicket("AP-1", { providers: { linear } })).toBeNull();
    expect(await getTicket("fe#437", { providers: { linear } })).toBeNull();
  });
});
