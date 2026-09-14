import { describe, expect, test } from "bun:test";
import { MissingCredentialError } from "./errors.ts";
import { LINEAR_API_URL, linearClaim, linearGet, linearTicketStates, stateOf } from "./linear.ts";

const now = new Date("2026-09-13T10:00:00Z");
const node = (identifier: string, type: string, extra: Record<string, unknown> = {}) => ({
  identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  state: { name: type === "completed" ? "Done" : type === "canceled" ? "Canceled" : "In Progress", type },
  ...extra,
});

describe("stateOf", () => {
  test("the state's type decides; completedAt and canceledAt date it, else now", () => {
    expect(stateOf(node("ALD-1", "completed", { completedAt: "2026-09-12T01:00:00Z" }), now)).toEqual({ state: "done", at: "2026-09-12T01:00:00Z", name: "Done", url: "https://linear.app/x/issue/ALD-1", provider: "linear" });
    expect(stateOf(node("ALD-2", "canceled", { canceledAt: null }), now)).toEqual({ state: "canceled", at: now.toISOString(), name: "Canceled", url: "https://linear.app/x/issue/ALD-2", provider: "linear" });
    expect(stateOf(node("ALD-3", "started"), now)).toEqual({ state: "open", name: "In Progress", url: "https://linear.app/x/issue/ALD-3", provider: "linear" });
  });
  test("an assignee on the node rides along; none is left off rather than guessed at", () => {
    expect(stateOf(node("ALD-4", "started", { assignee: { id: "u1" } }), now)).toEqual({ state: "open", name: "In Progress", url: "https://linear.app/x/issue/ALD-4", provider: "linear", assignee: { id: "u1" } });
    expect(stateOf(node("ALD-5", "started", { assignee: null }), now)).toEqual({ state: "open", name: "In Progress", url: "https://linear.app/x/issue/ALD-5", provider: "linear" });
  });
});

describe("linearTicketStates", () => {
  test("one query per team by number; listed keys answer, the rest are unknown", async () => {
    const calls: { url: string; body: { variables: { team: string; numbers: number[] } }; auth: string | null }[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), body, auth: (init?.headers as Record<string, string>).Authorization ?? null });
      const nodes = body.variables.team === "ALD" ? [node("ALD-45", "completed", { completedAt: "2026-09-12T01:00:00Z", assignee: { id: "u1" } }), node("ALD-47", "started")] : [node("CTD-9", "canceled", { canceledAt: "2026-09-11T01:00:00Z" })];
      return new Response(JSON.stringify({ data: { issues: { nodes } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const s = await linearTicketStates(["ALD-45", "ALD-47", "ALD-99", "CTD-9", "fe#437"], { fetch: f, apiKey: "k", now });
    expect(calls.map((c) => [c.url, c.auth, c.body.variables])).toEqual([
      [LINEAR_API_URL, "k", { team: "ALD", numbers: [45, 47, 99] }],
      [LINEAR_API_URL, "k", { team: "CTD", numbers: [9] }],
    ]);
    expect(s("ALD-45")).toEqual({ state: "done", at: "2026-09-12T01:00:00Z", name: "Done", url: "https://linear.app/x/issue/ALD-45", provider: "linear", assignee: { id: "u1" } });
    expect(s("ALD-47").state).toBe("open");
    expect(s("CTD-9").state).toBe("canceled");
    expect(s("ALD-99")).toEqual({ state: "unknown" });
    expect(s("fe#437")).toEqual({ state: "unknown" });
  });
  test("no credential asks nothing; a failing team answers unknown and the others still answer", async () => {
    let asked = 0;
    const none = await linearTicketStates(["ALD-45"], { fetch: (async () => { asked++; return new Response("{}"); }) as unknown as typeof fetch, apiKey: null });
    expect(asked).toBe(0);
    expect(none("ALD-45")).toEqual({ state: "unknown" });
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { team } = JSON.parse(String(init?.body)).variables;
      if (team === "ALD") return new Response("nope", { status: 500 });
      return new Response(JSON.stringify({ data: { issues: { nodes: [node("CTD-9", "completed", { completedAt: "2026-09-11T01:00:00Z" })] } } }));
    }) as unknown as typeof fetch;
    const s = await linearTicketStates(["ALD-45", "CTD-9"], { fetch: f, apiKey: "k", now });
    expect(s("ALD-45")).toEqual({ state: "unknown" });
    expect(s("CTD-9").state).toBe("done");
  });
});

describe("linearGet", () => {
  test("one ticket, with its parent's key when it has one", async () => {
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { id } = JSON.parse(String(init?.body)).variables;
      expect(id).toBe("CTD-202");
      return new Response(JSON.stringify({
        data: { issue: { identifier: "CTD-202", url: "https://linear.app/x/issue/CTD-202", title: "sub-issue", description: "the body", state: { name: "In Progress", type: "started" }, assignee: { id: "u1" }, parent: { identifier: "CTD-201" } } },
      }));
    }) as unknown as typeof fetch;
    const t = await linearGet("CTD-202", { fetch: f, apiKey: "k", now });
    expect(t).toEqual({
      key: "CTD-202",
      title: "sub-issue",
      url: "https://linear.app/x/issue/CTD-202",
      description: "the body",
      state: { state: "open", name: "In Progress", url: "https://linear.app/x/issue/CTD-202", provider: "linear", assignee: { id: "u1" } },
      parentKey: "CTD-201",
    });
  });
  test("no such issue answers null; no description answers empty; no parent leaves the field off", async () => {
    const f = (async () => new Response(JSON.stringify({ data: { issue: null } }))) as unknown as typeof fetch;
    expect(await linearGet("CTD-999", { fetch: f, apiKey: "k" })).toBeNull();
    const f2 = (async () => new Response(JSON.stringify({
      data: { issue: { identifier: "CTD-10", url: "u", title: "t", description: null, state: { name: "Done", type: "completed" }, completedAt: "2026-09-12T01:00:00Z" } },
    }))) as unknown as typeof fetch;
    const t = await linearGet("CTD-10", { fetch: f2, apiKey: "k" });
    expect(t?.description).toBe("");
    expect(t?.parentKey).toBeUndefined();
  });
  test("no credential throws MissingCredentialError, naming the variable; a real GraphQL error throws too", async () => {
    await expect(linearGet("CTD-1", { apiKey: null })).rejects.toThrow(MissingCredentialError);
    await expect(linearGet("CTD-1", { apiKey: null })).rejects.toThrow("LINEAR_API_KEY");
    const f = (async () => new Response(JSON.stringify({ errors: [{ message: "rate limited" }] }))) as unknown as typeof fetch;
    await expect(linearGet("CTD-1", { fetch: f, apiKey: "k" })).rejects.toThrow("rate limited");
  });
  test('a "not found" GraphQL error answers null, the same as a null result', async () => {
    const f = (async () => new Response(JSON.stringify({ errors: [{ message: "Entity not found" }] }))) as unknown as typeof fetch;
    expect(await linearGet("CTD-1", { fetch: f, apiKey: "k" })).toBeNull();
  });
});

describe("linearClaim", () => {
  const claimContext = (states: Array<{ id: string; name: string; type: string }>) => ({
    data: { viewer: { id: "viewer-1" }, issue: { id: "uuid-1", team: { states: { nodes: states } } } },
  });

  test("assigns the given user and moves to the state named \"In Progress\" among several started states", async () => {
    const calls: Array<{ query: string; variables: Record<string, string> }> = [];
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      if (body.query.includes("ClaimContext")) {
        return new Response(JSON.stringify(claimContext([
          { id: "s-todo", name: "Todo", type: "unstarted" },
          { id: "s-started", name: "Started", type: "started" },
          { id: "s-progress", name: "In Progress", type: "started" },
        ])));
      }
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }) as unknown as typeof fetch;
    await linearClaim("CTD-1", "assignee-1", { fetch: f, apiKey: "k" });
    expect(calls[0]?.variables).toEqual({ id: "CTD-1" });
    expect(calls[1]?.variables).toEqual({ id: "uuid-1", assigneeId: "assignee-1", stateId: "s-progress" });
  });

  test("falls back to any started state when none is named \"In Progress\"", async () => {
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("ClaimContext")) {
        return new Response(JSON.stringify(claimContext([{ id: "s-started", name: "Doing", type: "started" }])));
      }
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }) as unknown as typeof fetch;
    await expect(linearClaim("CTD-1", "assignee-1", { fetch: f, apiKey: "k" })).resolves.toBeUndefined();
  });

  test("omitting assigneeId assigns the credential's own viewer", async () => {
    const calls: Array<Record<string, string>> = [];
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("ClaimContext")) {
        return new Response(JSON.stringify(claimContext([{ id: "s-started", name: "In Progress", type: "started" }])));
      }
      calls.push(body.variables);
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }) as unknown as typeof fetch;
    await linearClaim("CTD-1", undefined, { fetch: f, apiKey: "k" });
    expect(calls[0]?.assigneeId).toBe("viewer-1");
  });

  test("no credential throws MissingCredentialError; no started state, an unknown issue, and a declined update all throw", async () => {
    await expect(linearClaim("CTD-1", "a1", { apiKey: null })).rejects.toThrow(MissingCredentialError);

    const noStarted = (async () => new Response(JSON.stringify(claimContext([{ id: "s-todo", name: "Todo", type: "unstarted" }])))) as unknown as typeof fetch;
    await expect(linearClaim("CTD-1", "a1", { fetch: noStarted, apiKey: "k" })).rejects.toThrow("no started-type state");

    const noIssue = (async () => new Response(JSON.stringify({ data: { viewer: { id: "v1" }, issue: null } }))) as unknown as typeof fetch;
    await expect(linearClaim("CTD-1", "a1", { fetch: noIssue, apiKey: "k" })).rejects.toThrow("no such issue");

    const declined = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("ClaimContext")) {
        return new Response(JSON.stringify(claimContext([{ id: "s-started", name: "In Progress", type: "started" }])));
      }
      return new Response(JSON.stringify({ data: { issueUpdate: { success: false } } }));
    }) as unknown as typeof fetch;
    await expect(linearClaim("CTD-1", "a1", { fetch: declined, apiKey: "k" })).rejects.toThrow("declined");
  });
});
