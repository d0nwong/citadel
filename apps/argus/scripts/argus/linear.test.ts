import { describe, expect, test } from "bun:test";
import { LINEAR_API_URL, splitKey, stateOf, ticketStates } from "./linear.ts";

const now = new Date("2026-09-13T10:00:00Z");
const node = (identifier: string, type: string, extra: Record<string, unknown> = {}) => ({
  identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  state: { name: type === "completed" ? "Done" : type === "canceled" ? "Canceled" : "In Progress", type },
  ...extra,
});

describe("splitKey and stateOf", () => {
  test("a key splits into team and number; anything else is null", () => {
    expect(splitKey("ALD-45")).toEqual(["ALD", 45]);
    expect(splitKey("CTD-179")).toEqual(["CTD", 179]);
    expect(splitKey("fe#437")).toBeNull();
    expect(splitKey("ald-45")).toBeNull();
  });
  test("the state's type decides; completedAt and canceledAt date it, else now", () => {
    expect(stateOf(node("ALD-1", "completed", { completedAt: "2026-09-12T01:00:00Z" }), now)).toEqual({ state: "done", at: "2026-09-12T01:00:00Z", name: "Done", url: "https://linear.app/x/issue/ALD-1" });
    expect(stateOf(node("ALD-2", "canceled", { canceledAt: null }), now)).toEqual({ state: "canceled", at: now.toISOString(), name: "Canceled", url: "https://linear.app/x/issue/ALD-2" });
    expect(stateOf(node("ALD-3", "started"), now)).toEqual({ state: "open", name: "In Progress", url: "https://linear.app/x/issue/ALD-3" });
  });
});

describe("ticketStates", () => {
  test("one query per team by number; listed keys answer, the rest are unknown", async () => {
    const calls: { url: string; body: { variables: { team: string; numbers: number[] } }; auth: string | null }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), body, auth: (init?.headers as Record<string, string>).Authorization ?? null });
      const nodes = body.variables.team === "ALD" ? [node("ALD-45", "completed", { completedAt: "2026-09-12T01:00:00Z" }), node("ALD-47", "started")] : [node("CTD-9", "canceled", { canceledAt: "2026-09-11T01:00:00Z" })];
      return new Response(JSON.stringify({ data: { issues: { nodes } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await ticketStates(["ALD-45", "ALD-47", "ALD-99", "CTD-9", "fe#437"], { fetch: f, apiKey: "k", now });
    expect(calls.map((c) => [c.url, c.auth, c.body.variables])).toEqual([
      [LINEAR_API_URL, "k", { team: "ALD", numbers: [45, 47, 99] }],
      [LINEAR_API_URL, "k", { team: "CTD", numbers: [9] }],
    ]);
    expect(s("ALD-45")).toEqual({ state: "done", at: "2026-09-12T01:00:00Z", name: "Done", url: "https://linear.app/x/issue/ALD-45" });
    expect(s("ALD-47").state).toBe("open");
    expect(s("CTD-9").state).toBe("canceled");
    expect(s("ALD-99")).toEqual({ state: "unknown" });
    expect(s("fe#437")).toEqual({ state: "unknown" });
  });
  test("no credential asks nothing; a failing team answers unknown and the others still answer", async () => {
    let asked = 0;
    const none = await ticketStates(["ALD-45"], { fetch: (async () => { asked++; return new Response("{}"); }) as unknown as typeof fetch, apiKey: null });
    expect(asked).toBe(0);
    expect(none("ALD-45")).toEqual({ state: "unknown" });
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { team } = JSON.parse(String(init?.body)).variables;
      if (team === "ALD") return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ data: { issues: { nodes: [node("CTD-9", "completed", { completedAt: "2026-09-11T01:00:00Z" })] } } }));
    }) as unknown as typeof fetch;
    const s = await ticketStates(["ALD-45", "CTD-9"], { fetch: f, apiKey: "k", now });
    expect(s("ALD-45")).toEqual({ state: "unknown" });
    expect(s("CTD-9").state).toBe("done");
  });
});
