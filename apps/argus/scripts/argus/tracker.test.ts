import { describe, expect, test } from "bun:test";
import type { Ticket, TicketProvider } from "@citadel/tickets";
import { trackerList, trackerShow } from "./tracker.ts";

const fakeProvider = (name: string, tickets: Record<string, Ticket>, open: Ticket[] = []): TicketProvider => ({
  name,
  get: async (key) => tickets[key] ?? null,
  states: async () => () => ({ state: "unknown" }),
  listOpen: async (opts) => (opts?.unassigned ? open.filter((t) => t.state.state !== "unknown" && !t.state.assignee) : open),
  create: async () => {
    throw new Error("not used in these tests");
  },
  update: async () => {
    throw new Error("not used in these tests");
  },
  claim: async () => {},
  link: async () => {},
});

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
