import { describe, expect, test } from "bun:test";
import { JEV_API_URL, JEV_MODEL, NOTHING, NOTHING_DESCRIPTION, suggestFeature } from "./suggest.ts";

const options = [
  { feature: "tasks", description: "Tasks - routes /tasks" },
  { feature: "sweep", description: "Sweep" },
];

/** a reply body: the version that answered at the top level, the Choice's answer under it */
const answer = (model = "jev-1.13.1") => ({
  model,
  answers: [{ choice: "tasks", probabilities: { tasks: 0.8, sweep: 0.1, nothing: 0.1 }, confidence: 0.8 }],
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
    const opts = seen!.body.questions[0].options;
    expect(opts).toContainEqual({ id: "tasks", description: "Tasks - routes /tasks" });
    expect(opts).toContainEqual({ id: "sweep", description: "Sweep" });
    expect(opts).toContainEqual({ id: NOTHING, description: NOTHING_DESCRIPTION });
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
