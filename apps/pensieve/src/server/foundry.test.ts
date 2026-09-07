import { describe, expect, test } from "bun:test";

// The token is read fresh per call; set it before the module is imported so the shared
// credentials file on this machine plays no part.
process.env.FOUNDRY_API_TOKEN = "test-token";
process.env.FOUNDRY_URL = "http://foundry.test";

const { createJob, getJob, listRepos, trackedRepos, FoundryError } =
  await import("./foundry");
// Destructured from a dynamic import, `FoundryError` is a value; this is its instance type.
type FoundryErr = InstanceType<typeof FoundryError>;

interface Seen {
  init: RequestInit;
  url: string;
}
const fake = (status: number, body: unknown, seen: Seen[] = []) =>
  ((url: string | URL | Request, init?: RequestInit) => {
    seen.push({ init: init ?? {}, url: String(url) });
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status,
      })
    );
  }) as typeof fetch;

const job = {
  createdAt: 1,
  id: "0f3a2c1e-1111-4222-8333-444455556666",
  status: "queued",
};

describe("AC3 — one POST /api/jobs with ticketId, repo, no instructions, Idempotency-Key = point id", () => {
  test("202 is created, 200 is a replay; body and headers are exactly the contract", async () => {
    const seen: Seen[] = [];
    const r = await createJob(
      {
        idempotencyKey: "decide/lia-86",
        repo: "alden-portal-fe",
        ticketId: "LIA-86",
      },
      fake(202, job, seen)
    );
    expect(r).toEqual({
      job: { createdAt: 1, id: job.id, status: "queued" },
      replay: false,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://foundry.test/api/jobs");
    expect(seen[0].init.method).toBe("POST");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      repo: "alden-portal-fe",
      ticketId: "LIA-86",
    });
    const h = seen[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer test-token");
    expect(h["Idempotency-Key"]).toBe("decide/lia-86");

    const again = await createJob(
      {
        idempotencyKey: "decide/lia-86",
        repo: "alden-portal-fe",
        ticketId: "LIA-86",
      },
      fake(200, { ...job, status: "running" })
    );
    expect(again.replay).toBe(true);
    expect(again.job.status).toBe("running");
  });
});

describe("AC6 — a Foundry error carries its `error` text; 409 names the holding job", () => {
  test.each([
    [400, 'repo "x" is not tracked — known: a, b'],
    [401, "unauthorized"],
    [503, "trigger API not configured — run: foundry auth --api"],
  ])("%i", async (status, error) => {
    const p = createJob(
      { idempotencyKey: "decide/x", repo: "x", ticketId: "LIA-1" },
      fake(status, { error })
    );
    await expect(p).rejects.toBeInstanceOf(FoundryError);
    await p.catch((e: FoundryErr) => {
      expect(e.status).toBe(status);
      expect(e.message).toBe(error);
      expect(e.job).toBeUndefined();
    });
  });
  test("409", async () => {
    const p = createJob(
      { idempotencyKey: "decide/x", repo: "x", ticketId: "LIA-1" },
      fake(409, {
        error: "ticket LIA-1 already has a job",
        job: { id: job.id, status: "running" },
      })
    );
    await p.catch((e: FoundryErr) => {
      expect(e.status).toBe(409);
      expect(e.job).toEqual({ id: job.id, status: "running" });
    });
  });
  test("a network failure is a FoundryError(0) naming the URL", async () => {
    const down = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    await createJob(
      { idempotencyKey: "decide/x", repo: "x", ticketId: "LIA-1" },
      down
    ).catch((e: FoundryErr) => {
      expect(e.status).toBe(0);
      expect(e.message).toContain("http://foundry.test");
    });
  });
});

describe("AC4 — GET /api/jobs/:id", () => {
  test("returns the job slice", async () => {
    const seen: Seen[] = [];
    const j = await getJob(
      job.id,
      fake(
        200,
        {
          ...job,
          extra: "dropped",
          prUrl: "https://x/pr/1",
          status: "succeeded",
        },
        seen
      )
    );
    expect(seen[0].url).toBe(`http://foundry.test/api/jobs/${job.id}`);
    expect(j).toEqual({
      createdAt: 1,
      id: job.id,
      prUrl: "https://x/pr/1",
      status: "succeeded",
    });
  });
  test("refuses an id that is not one before calling out", async () => {
    let called = false;
    const spy = (() => {
      called = true;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;
    await expect(getJob("../secrets", spy)).rejects.toBeInstanceOf(
      FoundryError
    );
    expect(called).toBe(false);
  });
});

describe("LIA-120 — GET /api/repos, the set Send offers", () => {
  const rows = [
    { name: "argus", path: "/Users/l/git/argus" },
    { name: "pensieve", path: "/Users/l/git/pensieve" },
  ];

  test("the rows, on the bearer, with nothing invented", async () => {
    const seen: Seen[] = [];
    const repos = await listRepos(
      fake(200, [...rows, { name: "extra", notes: "private" }, null], seen)
    );
    expect(seen[0].url).toBe("http://foundry.test/api/repos");
    expect(seen[0].init.method).toBe("GET");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-token"
    );
    // A row without both fields is not a repo; nothing beyond name and path survives.
    expect(repos).toEqual(rows);
  });

  test("nothing tracked is an empty list, not an error", async () => {
    expect(await listRepos(fake(200, []))).toEqual([]);
  });

  test.each([
    [404, "a Foundry from before LIA-119"],
    [401, "the wrong token"],
    [500, "a host in trouble"],
  ])("%i throws — %s", async (status) => {
    await expect(listRepos(fake(status, undefined))).rejects.toBeInstanceOf(
      FoundryError
    );
  });

  test("a 200 that is not a list throws rather than passing something else on", async () => {
    await expect(listRepos(fake(200, { repos: rows }))).rejects.toBeInstanceOf(
      FoundryError
    );
  });

  test("AC4 — trackedRepos answers no list for every failure, so the page falls back", async () => {
    const page = (status: number) =>
      (() =>
        Promise.resolve(
          new Response("<!doctype html><title>Foundry</title>", {
            headers: { "content-type": "text/html" },
            status,
          })
        )) as unknown as typeof fetch;
    // A Foundry from before LIA-119 answers the route as its own web page, and a router
    // that catches unknown paths answers 200 while doing it — so the status alone is not
    // the test, and neither answer may reach the field as a repo.
    expect(await trackedRepos(page(404))).toEqual([]);
    expect(await trackedRepos(page(200))).toEqual([]);

    const down = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect(await trackedRepos(down)).toEqual([]);

    // And the happy path is the list itself.
    expect(await trackedRepos(fake(200, rows))).toEqual(rows);
  });
});
