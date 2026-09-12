import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The project cache lives under PENSIEVE_HOME and the key is read fresh per call; both are
// pinned to scratch before the module loads, so this machine's own credentials play no part.
const HOME = await mkdtemp(join(tmpdir(), "pensieve-linear-"));
process.env.PENSIEVE_HOME = HOME;
process.env.LINEAR_API_KEY = "lin_api_test";

const {
  createIssue,
  createProject,
  forgetProjects,
  knownProjects,
  linearConfig,
  linearKey,
  LinearError,
  projectsCacheFile,
  TEAM_NAME,
} = await import("./linear");
type LinearErr = InstanceType<typeof LinearError>;

// `linearSources` is the one production caller that turns a draft's team into a project
// list. It reads through the cache under PENSIEVE_HOME, which this file already pins to
// scratch, so the wiring is provable here without a credential or a stubbed global fetch.
const { linearSources } = await import("./ticket");

afterAll(() => rm(HOME, { force: true, recursive: true }));

interface Seen {
  body: unknown;
  headers: Record<string, string>;
  url: string;
}

/** Answers each call with the next body in the list, recording what it was asked. */
const fake = (replies: { status?: number; body: unknown }[], seen: Seen[]) => {
  let i = 0;
  return ((url: string | URL | Request, init?: RequestInit) => {
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    seen.push({
      body: JSON.parse(String(init?.body ?? "null")),
      headers: (init?.headers ?? {}) as Record<string, string>,
      url: String(url),
    });
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        headers: { "content-type": "application/json" },
        status: r.status ?? 200,
      })
    );
  }) as typeof fetch;
};

const TEAM_ALD = {
  data: {
    teams: {
      nodes: [
        {
          id: "team_ald",
          name: "Alden",
          projects: {
            nodes: [
              { id: "p_alden", name: "Alden Portal" },
              { id: "p_usage", name: "Admin - Usage" },
            ],
          },
        },
      ],
    },
    viewer: { id: "user_liam" },
  },
};

const TEAM_CTD = {
  data: {
    teams: {
      nodes: [
        {
          id: "team_ctd",
          name: "Citadel",
          projects: {
            nodes: [
              { id: "p_pensieve", name: "Pensieve" },
              { id: "p_argus", name: "Argus" },
            ],
          },
        },
      ],
    },
    viewer: { id: "user_liam" },
  },
};

beforeEach(async () => {
  forgetProjects();
  process.env.LINEAR_API_KEY = "lin_api_test";
  await rm(projectsCacheFile(), { force: true });
  await rm(projectsCacheFile("CTD"), { force: true });
});

describe("AC2 — the credential is LINEAR_API_KEY in the environment, and nothing else", () => {
  test("the variable is the whole answer; whitespace around it is not a key", () => {
    expect(linearKey()).toBe("lin_api_test");

    process.env.LINEAR_API_KEY = "  ";
    expect(linearKey()).toBeUndefined();
  });
  test("without it, linearConfig says so and names .env, not a shared file", () => {
    process.env.LINEAR_API_KEY = "";
    expect(linearKey()).toBeUndefined();
    const config = linearConfig();
    expect(config.configured).toBe(false);
    expect(config.team).toBe(TEAM_NAME);
    expect(config.reason).toContain("LINEAR_API_KEY is not set");
    expect(config.reason).toContain(".env");
  });
  test("with it, it is configured and has no reason to give", () => {
    expect(linearConfig()).toEqual({ configured: true, team: TEAM_NAME });
  });
});

describe("AC5 — the team's projects, live then cached", () => {
  test("a live read answers the team, the viewer and the projects, and writes the cache", async () => {
    const seen: Seen[] = [];
    const lookup = await knownProjects(fake([{ body: TEAM_ALD }], seen));
    expect(lookup).toEqual({
      projects: [
        { id: "p_alden", name: "Alden Portal" },
        { id: "p_usage", name: "Admin - Usage" },
      ],
      source: "live",
      teamId: "team_ald",
      viewerId: "user_liam",
    });
    // A personal API key goes in `authorization` unprefixed — Linear's contract for lin_api_.
    expect(seen[0].headers.authorization).toBe("lin_api_test");
    expect(seen[0].url).toBe("https://api.linear.app/graphql");
    expect((seen[0].body as { variables: { key: string } }).variables.key).toBe(
      "ALD"
    );

    const cached = JSON.parse(await readFile(projectsCacheFile(), "utf8"));
    expect(cached.teamId).toBe("team_ald");
    expect(cached.viewerId).toBe("user_liam");
    expect(cached.projects).toHaveLength(2);
  });
  test("with the credential gone the cache still answers, and Linear is never called", async () => {
    await knownProjects(fake([{ body: TEAM_ALD }], []));
    forgetProjects();
    process.env.LINEAR_API_KEY = "";

    const seen: Seen[] = [];
    const lookup = await knownProjects(fake([{ body: TEAM_ALD }], seen));
    expect(seen).toEqual([]);
    expect(lookup.source).toBe("cache");
    expect(lookup.teamId).toBe("team_ald");
    expect(lookup.projects.map((p) => p.name)).toEqual([
      "Alden Portal",
      "Admin - Usage",
    ]);
  });
  test("no credential and no cache is 'none' — a lookup that cannot be made, not a failure", async () => {
    process.env.LINEAR_API_KEY = "";
    expect(await knownProjects(fake([{ body: TEAM_ALD }], []))).toEqual({
      projects: [],
      source: "none",
    });
  });
  test("an outage falls back to the cache rather than turning every draft into a refusal", async () => {
    await knownProjects(fake([{ body: TEAM_ALD }], []));
    forgetProjects();
    const lookup = await knownProjects(
      fake([{ body: { errors: [{ message: "upstream is down" }] } }], [])
    );
    expect(lookup.source).toBe("cache");
    expect(lookup.projects).toHaveLength(2);
  });
  test("the second read inside the window is the memo, not a second round trip", async () => {
    const seen: Seen[] = [];
    const f = fake([{ body: TEAM_ALD }], seen);
    await knownProjects(f);
    await knownProjects(f);
    expect(seen).toHaveLength(1);
  });
});

describe("C5 — the project cache is per team", () => {
  test("Citadel's projects are fetched and cached under their own key, apart from Alden's", async () => {
    await knownProjects(fake([{ body: TEAM_ALD }], []));

    const seenCtd: Seen[] = [];
    const lookup = await knownProjects(
      fake([{ body: TEAM_CTD }], seenCtd),
      "CTD"
    );
    expect(lookup).toEqual({
      projects: [
        { id: "p_pensieve", name: "Pensieve" },
        { id: "p_argus", name: "Argus" },
      ],
      source: "live",
      teamId: "team_ctd",
      viewerId: "user_liam",
    });
    expect(
      (seenCtd[0].body as { variables: { key: string } }).variables.key
    ).toBe("CTD");
    expect(projectsCacheFile("CTD")).not.toBe(projectsCacheFile());

    const aldCache = JSON.parse(await readFile(projectsCacheFile(), "utf8"));
    const ctdCache = JSON.parse(
      await readFile(projectsCacheFile("CTD"), "utf8")
    );
    expect(aldCache.teamId).toBe("team_ald");
    expect(ctdCache.teamId).toBe("team_ctd");
  });

  test("with the credential gone, Citadel's cache answers from its own file, and Alden's file is untouched", async () => {
    await knownProjects(fake([{ body: TEAM_ALD }], []));
    const aldCacheBefore = await readFile(projectsCacheFile(), "utf8");
    forgetProjects();
    await knownProjects(fake([{ body: TEAM_CTD }], []), "CTD");
    forgetProjects();
    process.env.LINEAR_API_KEY = "";

    const seen: Seen[] = [];
    const lookup = await knownProjects(fake([{ body: TEAM_CTD }], seen), "CTD");
    expect(seen).toEqual([]);
    expect(lookup.source).toBe("cache");
    expect(lookup.teamId).toBe("team_ctd");
    expect(lookup.projects.map((p) => p.name)).toEqual(["Pensieve", "Argus"]);

    const aldCacheAfter = await readFile(projectsCacheFile(), "utf8");
    expect(aldCacheAfter).toBe(aldCacheBefore);
  });

  test("the draft check's own reader asks for the team it is given, not the default", async () => {
    await knownProjects(fake([{ body: TEAM_ALD }], []));
    forgetProjects();
    await knownProjects(fake([{ body: TEAM_CTD }], []), "CTD");
    forgetProjects();
    // No credential, so the read is the cache alone and never touches the real fetch.
    process.env.LINEAR_API_KEY = "";

    const lookup = await linearSources().projects("CTD");
    expect(lookup.source).toBe("cache");
    expect(lookup.teamId).toBe("team_ctd");
    expect(lookup.projects.map((p) => p.name)).toEqual(["Pensieve", "Argus"]);
  });
});

describe("AC3 — issueCreate: one issue, no labels, assigned to the key's owner", () => {
  const made = {
    data: {
      issueCreate: {
        issue: { id: "i_1", identifier: "LIA-200", url: "https://lin/LIA-200" },
        success: true,
      },
    },
  };

  test("the mutation carries exactly the contract, and nothing else", async () => {
    const seen: Seen[] = [];
    const issue = await createIssue(
      {
        assigneeId: "user_liam",
        description: "## Summary\n\nx\n",
        projectId: "p_pensieve",
        teamId: "team_ald",
        title: "[FE] Do the thing",
      },
      fake([{ body: made }], seen)
    );
    expect(issue).toEqual({
      id: "i_1",
      identifier: "LIA-200",
      url: "https://lin/LIA-200",
    });
    const { input } = (seen[0].body as { variables: { input: object } })
      .variables;
    expect(input).toEqual({
      assigneeId: "user_liam",
      description: "## Summary\n\nx\n",
      projectId: "p_pensieve",
      teamId: "team_ald",
      title: "[FE] Do the thing",
    });
    // Filing queues a ticket; it never signals readiness, and it never splits.
    expect(Object.keys(input)).not.toContain("labelIds");
    expect(Object.keys(input)).not.toContain("parentId");
  });
  test("an absent project or assignee is left off the input rather than sent as null", async () => {
    const seen: Seen[] = [];
    await createIssue(
      { description: "x", teamId: "team_ald", title: "t" },
      fake([{ body: made }], seen)
    );
    expect(
      (seen[0].body as { variables: { input: object } }).variables.input
    ).toEqual({ description: "x", teamId: "team_ald", title: "t" });
  });
  test("a GraphQL errors[] is a LinearError carrying Linear's own sentence", async () => {
    const call = createIssue(
      { description: "x", teamId: "team_ald", title: "t" },
      fake([{ body: { errors: [{ message: "project not found" }] } }], [])
    );
    await expect(call).rejects.toThrow(/Linear refused it — project not found/);
  });
  test("success: false with no issue is an error, not a silent nothing", async () => {
    const call = createIssue(
      { description: "x", teamId: "team_ald", title: "t" },
      fake(
        [{ body: { data: { issueCreate: { issue: null, success: false } } } }],
        []
      )
    );
    await expect(call).rejects.toThrow("Linear did not create the issue");
  });
  test("with no credential the mutation is refused before it is sent", async () => {
    process.env.LINEAR_API_KEY = "";
    const seen: Seen[] = [];
    try {
      await createIssue(
        { description: "x", teamId: "team_ald", title: "t" },
        fake([{ body: made }], seen)
      );
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(LinearError);
      expect((e as LinearErr).status).toBe(503);
      expect((e as LinearErr).message).toContain("LINEAR_API_KEY is not set");
    }
    expect(seen).toEqual([]);
  });
});

describe("projectCreate — a project the team does not have yet, made on File", () => {
  const made = {
    data: {
      projectCreate: {
        project: { id: "p_new", name: "Admin - Blocker Tracker" },
        success: true,
      },
    },
  };

  test("the mutation names the project and the one team, and answers the project", async () => {
    const seen: Seen[] = [];
    const project = await createProject(
      { name: "Admin - Blocker Tracker", teamId: "team_ald" },
      fake([{ body: made }], seen)
    );
    expect(project).toEqual({ id: "p_new", name: "Admin - Blocker Tracker" });
    expect(
      (seen[0].body as { variables: { input: object } }).variables.input
    ).toEqual({ name: "Admin - Blocker Tracker", teamIds: ["team_ald"] });
  });
  test("the new project joins the cache and the memo is dropped, so the next check finds it", async () => {
    const seen: Seen[] = [];
    await knownProjects(fake([{ body: TEAM_ALD }], seen));
    await createProject(
      { name: "Admin - Blocker Tracker", teamId: "team_ald" },
      fake([{ body: made }], seen)
    );
    process.env.LINEAR_API_KEY = "";
    const lookup = await knownProjects(fake([], seen));
    expect(lookup.source).toBe("cache");
    expect(lookup.projects.map((p) => p.name)).toEqual([
      "Alden Portal",
      "Admin - Usage",
      "Admin - Blocker Tracker",
    ]);
    expect(seen).toHaveLength(2);
  });
  test("success: false with no project is an error, not a silent nothing", async () => {
    const call = createProject(
      { name: "x", teamId: "team_ald" },
      fake(
        [
          {
            body: {
              data: { projectCreate: { project: null, success: false } },
            },
          },
        ],
        []
      )
    );
    await expect(call).rejects.toThrow("Linear did not create the project");
  });
});
