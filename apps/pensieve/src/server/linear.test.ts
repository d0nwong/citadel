import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The project cache lives under PENSIEVE_HOME and the key is read fresh per call; both are
// pinned to scratch before the module loads, so this machine's own credentials play no part.
const HOME = await mkdtemp(join(tmpdir(), "pensieve-linear-"));
const SHARED = join(HOME, "liamai-env");
process.env.PENSIEVE_HOME = HOME;
process.env.LIAMAI_ENV = SHARED;
process.env.LINEAR_API_KEY = "lin_api_test";

const {
  createIssue,
  forgetProjects,
  knownProjects,
  linearConfig,
  linearKey,
  LinearError,
  projectsCacheFile,
  TEAM_NAME,
} = await import("./linear");
type LinearErr = InstanceType<typeof LinearError>;

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

const TEAM = {
  data: {
    teams: {
      nodes: [
        {
          id: "team_lia",
          name: "Liamai",
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
  await rm(SHARED, { force: true });
});

describe("the credential — the environment first, then the shared file", () => {
  test("the environment wins, and the shared file answers when it is unset", async () => {
    expect(await linearKey()).toBe("lin_api_test");

    process.env.LINEAR_API_KEY = "";
    await writeFile(
      SHARED,
      "SLACK_TOKEN=xoxb-1\nLINEAR_API_KEY=lin_api_shared\n",
      "utf8"
    );
    expect(await linearKey()).toBe("lin_api_shared");
  });
  test("with neither, linearConfig says so and names the file to put it in", async () => {
    process.env.LINEAR_API_KEY = "";
    expect(await linearKey()).toBeUndefined();
    const config = await linearConfig();
    expect(config.configured).toBe(false);
    expect(config.team).toBe(TEAM_NAME);
    expect(config.reason).toContain("LINEAR_API_KEY is not set");
    expect(config.reason).toContain(SHARED);
  });
  test("with one, it is configured and has no reason to give", async () => {
    expect(await linearConfig()).toEqual({ configured: true, team: TEAM_NAME });
  });
});

describe("AC5 — the team's projects, live then cached", () => {
  test("a live read answers the team, the viewer and the projects, and writes the cache", async () => {
    const seen: Seen[] = [];
    const lookup = await knownProjects(fake([{ body: TEAM }], seen));
    expect(lookup).toEqual({
      projects: [
        { id: "p_pensieve", name: "Pensieve" },
        { id: "p_argus", name: "Argus" },
      ],
      source: "live",
      teamId: "team_lia",
      viewerId: "user_liam",
    });
    // A personal API key goes in `authorization` unprefixed — Linear's contract for lin_api_.
    expect(seen[0].headers.authorization).toBe("lin_api_test");
    expect(seen[0].url).toBe("https://api.linear.app/graphql");
    expect((seen[0].body as { variables: { key: string } }).variables.key).toBe(
      "LIA"
    );

    const cached = JSON.parse(await readFile(projectsCacheFile(), "utf8"));
    expect(cached.teamId).toBe("team_lia");
    expect(cached.viewerId).toBe("user_liam");
    expect(cached.projects).toHaveLength(2);
  });
  test("with the credential gone the cache still answers, and Linear is never called", async () => {
    await knownProjects(fake([{ body: TEAM }], []));
    forgetProjects();
    process.env.LINEAR_API_KEY = "";

    const seen: Seen[] = [];
    const lookup = await knownProjects(fake([{ body: TEAM }], seen));
    expect(seen).toEqual([]);
    expect(lookup.source).toBe("cache");
    expect(lookup.teamId).toBe("team_lia");
    expect(lookup.projects.map((p) => p.name)).toEqual(["Pensieve", "Argus"]);
  });
  test("no credential and no cache is 'none' — a lookup that cannot be made, not a failure", async () => {
    process.env.LINEAR_API_KEY = "";
    expect(await knownProjects(fake([{ body: TEAM }], []))).toEqual({
      projects: [],
      source: "none",
    });
  });
  test("an outage falls back to the cache rather than turning every draft into a refusal", async () => {
    await knownProjects(fake([{ body: TEAM }], []));
    forgetProjects();
    const lookup = await knownProjects(
      fake([{ body: { errors: [{ message: "upstream is down" }] } }], [])
    );
    expect(lookup.source).toBe("cache");
    expect(lookup.projects).toHaveLength(2);
  });
  test("the second read inside the window is the memo, not a second round trip", async () => {
    const seen: Seen[] = [];
    const f = fake([{ body: TEAM }], seen);
    await knownProjects(f);
    await knownProjects(f);
    expect(seen).toHaveLength(1);
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
        teamId: "team_lia",
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
      teamId: "team_lia",
      title: "[FE] Do the thing",
    });
    // Filing queues a ticket; it never signals readiness, and it never splits.
    expect(Object.keys(input)).not.toContain("labelIds");
    expect(Object.keys(input)).not.toContain("parentId");
  });
  test("an absent project or assignee is left off the input rather than sent as null", async () => {
    const seen: Seen[] = [];
    await createIssue(
      { description: "x", teamId: "team_lia", title: "t" },
      fake([{ body: made }], seen)
    );
    expect(
      (seen[0].body as { variables: { input: object } }).variables.input
    ).toEqual({ description: "x", teamId: "team_lia", title: "t" });
  });
  test("a GraphQL errors[] is a LinearError carrying Linear's own sentence", async () => {
    const call = createIssue(
      { description: "x", teamId: "team_lia", title: "t" },
      fake([{ body: { errors: [{ message: "project not found" }] } }], [])
    );
    await expect(call).rejects.toThrow(/Linear refused it — project not found/);
  });
  test("success: false with no issue is an error, not a silent nothing", async () => {
    const call = createIssue(
      { description: "x", teamId: "team_lia", title: "t" },
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
        { description: "x", teamId: "team_lia", title: "t" },
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
