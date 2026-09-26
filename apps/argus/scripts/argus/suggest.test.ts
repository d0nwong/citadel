import { describe, expect, test } from "bun:test";
import { JEV_API_URL, JEV_MODEL, NOTHING, NOTHING_DESCRIPTION, QUESTION, QUESTION_ID, QUESTION_WITH_CONTEXT, earlierMessages, suggestFeature } from "./suggest.ts";

const options = [
  { feature: "tasks", description: "Tasks - routes /tasks" },
  { feature: "sweep", description: "Sweep" },
];

/** a reply body: the version that answered at the top level, the Choice's answer under it */
const answer = (model = "jev-1.13.1") => ({
  model,
  answers: { [QUESTION_ID]: { type: "choice", choice: "tasks", probabilities: { tasks: 0.8, sweep: 0.1, nothing: 0.1 }, confidence: 0.8 } },
});

describe("suggestFeature (AC2)", () => {
  test("C2: posts the state, the pinned model, every feature option and a nothing option described as chat, thanks, logistics or tooling, with a bearer key", async () => {
    let seen: { url: string; auth: string | null; body: any } | null = null;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), auth: (init?.headers as Record<string, string>).Authorization ?? null, body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify(answer()), { status: 200 });
    }) as unknown as typeof fetch;
    await suggestFeature("thread state here", options, { fetch: f, apiKey: "k" });
    expect(seen!.url).toBe(JEV_API_URL);
    expect(seen!.auth).toBe("Bearer k");
    expect(seen!.body.model).toBe(JEV_MODEL);
    expect(seen!.body.state).toBe("thread state here");
    // the API's shape: a map of questions by id, each Choice with instructions and criteria
    expect(seen!.body.questions).toEqual({
      [QUESTION_ID]: { type: "choice", instructions: QUESTION, criteria: { tasks: "Tasks - routes /tasks", sweep: "Sweep", [NOTHING]: NOTHING_DESCRIPTION } },
    });
  });

  test("C2: the version reported is the response's own model, not the pinned constant", async () => {
    const f = (async () => new Response(JSON.stringify(answer("jev-1.14.0")), { status: 200 })) as unknown as typeof fetch;
    const r = await suggestFeature("s", options, { fetch: f, apiKey: "k" });
    expect(r.model).toBe("jev-1.14.0");
    expect(r.model).not.toBe(JEV_MODEL);
    expect(r.choice).toBe("tasks");
    expect(r.confidence).toBe(0.8);
  });

  test("C2: a 429 retries with backoff and succeeds on the second try", async () => {
    let calls = 0;
    const slept: number[] = [];
    const f = (async () => {
      calls++;
      if (calls === 1) return new Response("slow down", { status: 429 });
      return new Response(JSON.stringify(answer()), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await suggestFeature("s", options, { fetch: f, apiKey: "k", sleep: async (ms) => { slept.push(ms); } });
    expect(calls).toBe(2);
    expect(slept.length).toBe(1);
    expect(r.choice).toBe("tasks");
  });

  test("C2: a 529 that never recovers fails after exactly two retries (three attempts)", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("overloaded", { status: 529 });
    }) as unknown as typeof fetch;
    await expect(suggestFeature("s", options, { fetch: f, apiKey: "k", sleep: async () => {} })).rejects.toThrow(/529/);
    expect(calls).toBe(3);
  });

  test("C2: a timeout retries, and a timeout that never recovers fails after three attempts", async () => {
    let calls = 0;
    const hangingThenOk = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      return new Response(JSON.stringify(answer()), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await suggestFeature("s", options, { fetch: hangingThenOk, apiKey: "k", timeoutMs: 5, sleep: async () => {} });
    expect(calls).toBe(2);
    expect(r.choice).toBe("tasks");

    let alwaysHangs = 0;
    const alwaysHangingFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      alwaysHangs++;
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }) as unknown as typeof fetch;
    await expect(suggestFeature("s", options, { fetch: alwaysHangingFetch, apiKey: "k", timeoutMs: 5, sleep: async () => {} })).rejects.toThrow(/timed out/);
    expect(alwaysHangs).toBe(3);
  });

  test("C2: a plain 500 is not retried", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("nope", { status: 500 }); }) as unknown as typeof fetch;
    await expect(suggestFeature("s", options, { fetch: f, apiKey: "k", sleep: async () => {} })).rejects.toThrow(/500/);
    expect(calls).toBe(1);
  });

  test("C2: with no TYPESAFE_API_KEY, the call is refused before any fetch", async () => {
    let asked = 0;
    const f = (async () => { asked++; return new Response("{}"); }) as unknown as typeof fetch;
    await expect(suggestFeature("s", options, { fetch: f, apiKey: null })).rejects.toThrow(/TYPESAFE_API_KEY/);
    expect(asked).toBe(0);
  });
});

describe("earlierMessages and the context question", () => {
  const m = (ts: number, thread = ts, channel = "C1") => ({ ts: String(ts), thread: String(thread), channel });
  test("the channel's own messages just before, newest eight, oldest first; other channels, replies, later and stale messages left out", () => {
    const first = m(100_000);
    const history = [m(90_000), ...Array.from({ length: 10 }, (_, i) => m(99_000 + i)), m(99_500, 99_000), m(99_600, 99_600, "C2"), m(100_500), first];
    const got = earlierMessages(first, history).map((x) => x.ts);
    expect(got).toEqual(["99002", "99003", "99004", "99005", "99006", "99007", "99008", "99009"]);
  });
  test("an object state asks the context question; a string state the plain one", async () => {
    const bodies: any[] = [];
    const f = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answer()), { status: 200 });
    }) as unknown as typeof fetch;
    await suggestFeature({ earlier_messages: "e", thread: "t" }, options, { fetch: f, apiKey: "k" });
    await suggestFeature("t", options, { fetch: f, apiKey: "k" });
    expect(bodies[0].questions[QUESTION_ID].instructions).toBe(QUESTION_WITH_CONTEXT);
    expect(bodies[0].state).toEqual({ earlier_messages: "e", thread: "t" });
    expect(bodies[1].questions[QUESTION_ID].instructions).toBe(QUESTION);
  });
});
