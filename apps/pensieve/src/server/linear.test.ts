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
  forgetProjects,
  knownProjects,
  linearConfig,
  linearKey,
  projectsCacheFile,
  TEAM_NAME,
} = await import("./linear");

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
    // `ticketSources().catalog` is the one production caller that turns a Citadel draft's
    // team into a project list; it reads through the cache under PENSIEVE_HOME, which this
    // file already pins to scratch, so the wiring is provable here without a stubbed fetch.
    const { ticketSources } = await import("./ticket");
    await knownProjects(fake([{ body: TEAM_ALD }], []));
    forgetProjects();
    await knownProjects(fake([{ body: TEAM_CTD }], []), "CTD");
    forgetProjects();
    // No credential, so the read is the cache alone and never touches the real fetch.
    process.env.LINEAR_API_KEY = "";

    const lookup = await ticketSources().catalog({
      key: "CTD",
      name: "Citadel",
    });
    expect(lookup.verified).toBe(true);
    expect(lookup.names).toEqual(["Pensieve", "Argus"]);
  });
});

// `createIssue`/`createProject` moved to `@citadel/tickets`' `linearCreate` (CTD-201,
// CTD-207) — see `packages/tickets/src/linear.test.ts` for their coverage now.
