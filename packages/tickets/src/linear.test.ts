import { describe, expect, test } from "bun:test";
import { MissingCredentialError } from "./errors.ts";
import { LINEAR_API_URL, linearClaim, linearCreate, linearGet, linearLink, linearListOpen, linearTicketStates, linearUpdate, stateOf } from "./linear.ts";

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
      [LINEAR_API_URL, "k", { id: "ALD-99" }],
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
  test("a key its team does not list is asked for by the old key, so a ticket that moved team still answers", async () => {
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { variables } = JSON.parse(String(init?.body));
      if (variables.team) return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }));
      expect(variables.id).toBe("LIA-153");
      return new Response(JSON.stringify({ data: { issue: node("ALD-1", "completed", { completedAt: "2026-09-09T12:58:27Z" }) } }));
    }) as unknown as typeof fetch;
    const s = await linearTicketStates(["LIA-153"], { fetch: f, apiKey: "k", now });
    expect(s("LIA-153")).toEqual({ state: "done", at: "2026-09-09T12:58:27Z", name: "Done", url: "https://linear.app/x/issue/ALD-1", provider: "linear" });
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

describe("linearListOpen", () => {
  const openBody = (nodes: unknown[], viewerId = "u1") => JSON.stringify({ data: { viewer: { id: viewerId }, issues: { nodes } } });

  test("a team filter is sent when given, and left off the query otherwise", async () => {
    const calls: { variables: { filter: Record<string, unknown> } }[] = [];
    const f = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(openBody([node("CTD-9", "started")]));
    }) as unknown as typeof fetch;
    await linearListOpen({ fetch: f, apiKey: "k", now, team: "CTD" });
    expect(calls[0]!.variables.filter).toEqual({ state: { type: { nin: ["completed", "canceled"] } }, team: { key: { eq: "CTD" } } });
    await linearListOpen({ fetch: f, apiKey: "k", now });
    expect(calls[1]!.variables.filter).toEqual({ state: { type: { nin: ["completed", "canceled"] } } });
  });

  test("the nodes come back as tickets, parent included, in the state the query already scoped to open", async () => {
    const f = (async () =>
      new Response(openBody([node("CTD-9", "started", { title: "t", description: "d", parent: { identifier: "CTD-1" } })]))) as unknown as typeof fetch;
    const tickets = await linearListOpen({ fetch: f, apiKey: "k", now });
    expect(tickets).toEqual([
      { key: "CTD-9", title: "t", url: "https://linear.app/x/issue/CTD-9", description: "d", state: { state: "open", name: "In Progress", url: "https://linear.app/x/issue/CTD-9", provider: "linear" }, parentKey: "CTD-1" },
    ]);
  });

  test("--mine keeps the viewer's own issues, --unassigned keeps the assignee-less ones", async () => {
    const nodes = [node("CTD-1", "started", { title: "mine", assignee: { id: "u1" } }), node("CTD-2", "started", { title: "theirs", assignee: { id: "u2" } }), node("CTD-3", "started", { title: "nobody's" })];
    const f = (async () => new Response(openBody(nodes, "u1"))) as unknown as typeof fetch;
    const mine = await linearListOpen({ fetch: f, apiKey: "k", now, mine: true });
    expect(mine.map((t) => t.key)).toEqual(["CTD-1"]);
    const unassigned = await linearListOpen({ fetch: f, apiKey: "k", now, unassigned: true });
    expect(unassigned.map((t) => t.key)).toEqual(["CTD-3"]);
  });

  test("no credential throws, naming the variable", async () => {
    await expect(linearListOpen({ apiKey: null })).rejects.toThrow("LINEAR_API_KEY");
  });
});

/** dispatches a mocked GraphQL POST by the query's own operation name, and records every call */
function fakeLinear(handlers: Record<string, (vars: Record<string, unknown>) => unknown>, calls: { op: string; variables: Record<string, unknown> }[] = []) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const op = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? "unknown";
    calls.push({ op, variables: body.variables });
    const handler = handlers[op];
    if (!handler) throw new Error(`unhandled op ${op}`);
    return new Response(JSON.stringify({ data: handler(body.variables) }));
  }) as unknown as typeof fetch;
}

const teamContextData = (overrides: { states?: unknown[]; projects?: unknown[] } = {}) => ({
  viewer: { id: "viewer-1" },
  teams: { nodes: [{ id: "team-1", states: { nodes: overrides.states ?? [] }, projects: { nodes: overrides.projects ?? [] } }] },
});

const createdIssue = (identifier: string, extra: Record<string, unknown> = {}) => ({
  id: `uuid-${identifier}`,
  identifier,
  url: `https://linear.app/x/issue/${identifier}`,
  title: "t",
  description: "d",
  state: { name: "Backlog", type: "unstarted" },
  assignee: null,
  parent: null,
  ...extra,
});

describe("linearCreate", () => {
  test("creates one issue on the team, reusing an existing project by name case-insensitively, and assigning 'me' to the viewer", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData({ projects: [{ id: "proj-9", name: "admin - invoicing" }] }),
        TicketCreate: () => ({ issueCreate: { success: true, issue: createdIssue("CTD-99") } }),
      },
      calls,
    );
    const t = await linearCreate({ title: "t", description: "d", team: "CTD", project: "Admin - Invoicing", assigneeId: "me" }, { fetch: f, apiKey: "k", now });
    expect(t).toEqual({ key: "CTD-99", title: "t", url: "https://linear.app/x/issue/CTD-99", description: "d", state: { state: "open", name: "Backlog", url: "https://linear.app/x/issue/CTD-99", provider: "linear" } });
    const create = calls.find((c) => c.op === "TicketCreate");
    expect(create?.variables.input).toEqual({ title: "t", description: "d", teamId: "team-1", projectId: "proj-9", assigneeId: "viewer-1" });
    expect(calls.some((c) => c.op === "TicketProjectCreate")).toBe(false);
  });

  test("creates the project on the team when nothing by that name exists yet", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData(),
        TicketProjectCreate: (v) => ({ projectCreate: { success: true, project: { id: "proj-new", name: (v.input as { name: string }).name } } }),
        TicketCreate: () => ({ issueCreate: { success: true, issue: createdIssue("CTD-1") } }),
      },
      calls,
    );
    await linearCreate({ title: "t", description: "d", team: "CTD", project: "Argus" }, { fetch: f, apiKey: "k", now });
    expect(calls.find((c) => c.op === "TicketProjectCreate")?.variables.input).toEqual({ name: "Argus", teamIds: ["team-1"] });
    expect(calls.find((c) => c.op === "TicketCreate")?.variables.input).toMatchObject({ projectId: "proj-new" });
  });

  test("AC3: a parent and blockers — the issue is created under the parent, then each blocker blocks it in order", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData(),
        TicketIds: (v) => {
          const numbers = (v.numbers as number[]).sort();
          return { issues: { nodes: numbers.map((n) => ({ id: `uuid-CTD-${n}`, identifier: `CTD-${n}` })) } };
        },
        TicketCreate: () => ({ issueCreate: { success: true, issue: createdIssue("CTD-9") } }),
        TicketBlockedBy: () => ({ issueRelationCreate: { success: true } }),
      },
      calls,
    );
    const t = await linearCreate({ title: "t", description: "d", team: "CTD", parent: "CTD-1", blockedBy: ["CTD-2", "CTD-3"] }, { fetch: f, apiKey: "k", now });
    expect(t.parentKey).toBeUndefined(); // the created issue's own parent field, from the mocked response, which names none
    expect(calls.find((c) => c.op === "TicketCreate")?.variables.input).toMatchObject({ parentId: "uuid-CTD-1" });
    const relations = calls.filter((c) => c.op === "TicketBlockedBy");
    expect(relations.map((c) => c.variables)).toEqual([
      { issueId: "uuid-CTD-2", relatedIssueId: "uuid-CTD-9" },
      { issueId: "uuid-CTD-3", relatedIssueId: "uuid-CTD-9" },
    ]);
  });

  test("an unknown parent or blocker key is refused by name rather than silently dropped", async () => {
    const f = fakeLinear({
      TicketTeamContext: () => teamContextData(),
      TicketIds: () => ({ issues: { nodes: [] } }),
    });
    await expect(linearCreate({ title: "t", description: "d", team: "CTD", parent: "CTD-9" }, { fetch: f, apiKey: "k", now })).rejects.toThrow("no such issue CTD-9");
  });

  test("an unknown team is refused by name", async () => {
    const f = fakeLinear({ TicketTeamContext: () => ({ viewer: { id: "v1" }, teams: { nodes: [] } }) });
    await expect(linearCreate({ title: "t", description: "d", team: "XYZ" }, { fetch: f, apiKey: "k" })).rejects.toThrow("no such team XYZ");
  });

  test("no credential throws MissingCredentialError", async () => {
    await expect(linearCreate({ title: "t", description: "d", team: "CTD" }, { apiKey: null })).rejects.toThrow(MissingCredentialError);
  });
});

describe("linearUpdate", () => {
  test("carries only the fields given, in one issueUpdate", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData(),
        TicketIds: () => ({ issues: { nodes: [{ id: "uuid-5", identifier: "CTD-5" }] } }),
        TicketUpdate: () => ({ issueUpdate: { success: true, issue: createdIssue("CTD-5", { title: "new title" }) } }),
      },
      calls,
    );
    const t = await linearUpdate("CTD-5", { title: "new title" }, { fetch: f, apiKey: "k", now });
    expect(t.title).toBe("new title");
    expect(calls.find((c) => c.op === "TicketUpdate")).toMatchObject({ variables: { id: "uuid-5", input: { title: "new title" } } });
  });

  test("AC2: a state name resolves against the team's own workflow states; an unknown name is refused, listing what the team has", async () => {
    const states = [{ id: "s1", name: "Todo", type: "unstarted" }, { id: "s2", name: "In Progress", type: "started" }];
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData({ states }),
        TicketIds: () => ({ issues: { nodes: [{ id: "uuid-5", identifier: "CTD-5" }] } }),
        TicketUpdate: () => ({ issueUpdate: { success: true, issue: createdIssue("CTD-5") } }),
      },
      calls,
    );
    await linearUpdate("CTD-5", { state: "in progress" }, { fetch: f, apiKey: "k", now });
    expect(calls.find((c) => c.op === "TicketUpdate")?.variables.input).toMatchObject({ stateId: "s2" });
    const badState = fakeLinear({ TicketTeamContext: () => teamContextData({ states }), TicketIds: () => ({ issues: { nodes: [{ id: "uuid-5", identifier: "CTD-5" }] } }) });
    await expect(linearUpdate("CTD-5", { state: "Bogus" }, { fetch: badState, apiKey: "k" })).rejects.toThrow('no state named "Bogus" — the team has Todo, In Progress');
  });

  test("assigneeId: 'me' assigns the viewer, null clears it, an id passes through", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData(),
        TicketIds: () => ({ issues: { nodes: [{ id: "uuid-5", identifier: "CTD-5" }] } }),
        TicketUpdate: () => ({ issueUpdate: { success: true, issue: createdIssue("CTD-5") } }),
      },
      calls,
    );
    await linearUpdate("CTD-5", { assigneeId: "me" }, { fetch: f, apiKey: "k", now });
    await linearUpdate("CTD-5", { assigneeId: null }, { fetch: f, apiKey: "k", now });
    await linearUpdate("CTD-5", { assigneeId: "user-7" }, { fetch: f, apiKey: "k", now });
    const inputs = calls.filter((c) => c.op === "TicketUpdate").map((c) => (c.variables.input as { assigneeId?: string | null }).assigneeId);
    expect(inputs).toEqual(["viewer-1", null, "user-7"]);
  });

  test("a blocker is added, never removed — one issueRelationCreate per key", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear(
      {
        TicketTeamContext: () => teamContextData(),
        TicketIds: (v) => {
          const numbers = (v.numbers as number[]).sort();
          return { issues: { nodes: numbers.map((n) => ({ id: `uuid-CTD-${n}`, identifier: `CTD-${n}` })) } };
        },
        TicketUpdate: () => ({ issueUpdate: { success: true, issue: createdIssue("CTD-5") } }),
        TicketBlockedBy: () => ({ issueRelationCreate: { success: true } }),
      },
      calls,
    );
    await linearUpdate("CTD-5", { blockedBy: ["CTD-6"] }, { fetch: f, apiKey: "k", now });
    expect(calls.find((c) => c.op === "TicketBlockedBy")?.variables).toEqual({ issueId: "uuid-CTD-6", relatedIssueId: "uuid-CTD-5" });
  });

  test("no credential throws MissingCredentialError; a key that is not a ticket key is refused", async () => {
    await expect(linearUpdate("CTD-5", {}, { apiKey: null })).rejects.toThrow(MissingCredentialError);
    await expect(linearUpdate("fe#437", {}, { apiKey: "k" })).rejects.toThrow("is not a ticket key");
  });
});

describe("linearLink", () => {
  test("AC2: resolves the issue's uuid, then attaches the url with the given title", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear({ TicketUuid: () => ({ issue: { id: "uuid-9" } }), TicketLink: () => ({ attachmentLinkURL: { success: true } }) }, calls);
    await linearLink("CTD-9", { kind: "pr", url: "https://bitbucket.org/x/y/pull-requests/1", title: "the PR" }, { fetch: f, apiKey: "k" });
    expect(calls[0]).toEqual({ op: "TicketUuid", variables: { id: "CTD-9" } });
    expect(calls[1]).toEqual({ op: "TicketLink", variables: { issueId: "uuid-9", url: "https://bitbucket.org/x/y/pull-requests/1", title: "the PR" } });
  });

  test("no title falls back to the key", async () => {
    const calls: { op: string; variables: Record<string, unknown> }[] = [];
    const f = fakeLinear({ TicketUuid: () => ({ issue: { id: "uuid-9" } }), TicketLink: () => ({ attachmentLinkURL: { success: true } }) }, calls);
    await linearLink("CTD-9", { kind: "pr", url: "u" }, { fetch: f, apiKey: "k" });
    expect(calls.find((c) => c.op === "TicketLink")?.variables.title).toBe("CTD-9");
  });

  test("no credential throws MissingCredentialError", async () => {
    await expect(linearLink("CTD-9", { kind: "pr", url: "u" }, { apiKey: null })).rejects.toThrow(MissingCredentialError);
  });

  test("an unknown issue — a null result or a \"not found\" GraphQL error — throws by name", async () => {
    const nullResult = fakeLinear({ TicketUuid: () => ({ issue: null }) });
    await expect(linearLink("CTD-9", { kind: "pr", url: "u" }, { fetch: nullResult, apiKey: "k" })).rejects.toThrow("no such issue CTD-9");

    const notFound = (async () => new Response(JSON.stringify({ errors: [{ message: "Entity not found" }] }))) as unknown as typeof fetch;
    await expect(linearLink("CTD-9", { kind: "pr", url: "u" }, { fetch: notFound, apiKey: "k" })).rejects.toThrow("no such issue CTD-9");
  });

  test("a declined attachment throws", async () => {
    const f = fakeLinear({ TicketUuid: () => ({ issue: { id: "uuid-9" } }), TicketLink: () => ({ attachmentLinkURL: { success: false } }) });
    await expect(linearLink("CTD-9", { kind: "pr", url: "u" }, { fetch: f, apiKey: "k" })).rejects.toThrow("declined");
  });
});
