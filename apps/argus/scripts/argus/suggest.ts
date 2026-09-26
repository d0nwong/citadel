/**
 * The Jev client (task 289): TypeSafe's System One model, over plain HTTPS — the repo makes
 * no other HTTP model call, so this is `fetch`, no SDK. One Choice question per unplaced
 * thread: which feature it belongs to, or nothing (chat, thanks, logistics or tooling). The
 * options are `featureSummaries`'s own per-feature summaries (`reader.ts` `featureOptions`),
 * so a reviewer sees the same list attribution does. `QUESTION` and `JEV_MODEL` are the one
 * place the wording and the pinned model id live. Shared with ticket 3's live sweep.
 *
 * A call times out at `timeoutMs` (10s live) and retries a 429, a 529, or a timeout at most
 * twice with backoff, then throws; anything else throws straight away. The version that
 * answered is read off the response's own `model` field, never the pinned constant, since
 * TypeSafe may answer with a newer one than was asked for.
 */

export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
/** the version asked for; `SuggestResult.model` is the version that actually answered */
export const JEV_MODEL = "jev-1.13.0";
export const NOTHING = "nothing";
export const NOTHING_DESCRIPTION = "chat, thanks, logistics or tooling that is not part of a conversation about one of the features";
export const QUESTION_ID = "feature";
export const QUESTION = "Which feature does this thread belong to, or nothing if it is chat, thanks, logistics or tooling?";
/**
 * With the channel's earlier messages in the state: a short reply posted straight into the
 * channel ("haha, ok", "thank you sir") belongs to the conversation it answers, which the
 * thread alone cannot show. Jev reads questions literally, so the rule is spelled out.
 */
export const QUESTION_WITH_CONTEXT =
  "Which feature is `thread` about? When `thread` alone does not name one, it belongs to the feature that `earlier_messages` were discussing just before it, if they were; nothing if it is chat, thanks, logistics or tooling outside any feature conversation.";
/** how much of the channel before a thread Jev sees: at most this many messages, from at most this long before */
export const CONTEXT_MESSAGES = 8;
export const CONTEXT_WINDOW_MS = 3 * 60 * 60 * 1000;

/** what Jev evaluates: the thread alone, or the thread and the channel just before it */
export type SuggestState = string | { earlier_messages: string; thread: string };

/**
 * The channel's messages just before `first`: same channel, other threads, within the
 * window, newest `CONTEXT_MESSAGES`, oldest first. Replies inside other threads are left
 * out; only what was said in the channel itself sets the conversation.
 */
export function earlierMessages<M extends { ts: string; channel: string; thread: string }>(first: M, history: M[]): M[] {
  const at = Number(first.ts) * 1000;
  return history
    .filter((m) => m.channel === first.channel && m.thread === m.ts && m.thread !== first.thread && Number(m.ts) < Number(first.ts) && at - Number(m.ts) * 1000 <= CONTEXT_WINDOW_MS)
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .slice(-CONTEXT_MESSAGES);
}

/** one try, then at most two retries: three attempts total */
const MAX_ATTEMPTS = 3;
const RETRY_STATUSES = new Set([429, 529]);

export type ChoiceOption = { feature: string; description: string };
export type SuggestResult = { choice: string; probabilities: Record<string, number>; confidence: number; model: string };
export type SuggestOptions = { fetch?: typeof fetch; apiKey?: string | null; timeoutMs?: number; sleep?: (ms: number) => Promise<void> };

const keyOf = (opts: SuggestOptions) => (opts.apiKey === undefined ? process.env.TYPESAFE_API_KEY?.trim() || null : opts.apiKey);
const backoff = (attempt: number) => 250 * 2 ** attempt;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** one thread's Choice question against Jev; `state` is the thread's messages as rendered for attribution */
export async function suggestFeature(state: SuggestState, options: ChoiceOption[], opts: SuggestOptions = {}): Promise<SuggestResult> {
  const apiKey = keyOf(opts);
  if (!apiKey) throw new Error("jev: no TYPESAFE_API_KEY");
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // the API's shape (docs.typesafe.ai/api): questions and answers are maps keyed by an id we
  // choose; a Choice carries `instructions` and `criteria`, option → description
  const criteria: Record<string, string> = {};
  for (const o of options) criteria[o.feature] = o.description;
  criteria[NOTHING] = NOTHING_DESCRIPTION;
  const body = {
    model: JEV_MODEL,
    state,
    questions: { [QUESTION_ID]: { type: "choice", instructions: typeof state === "string" ? QUESTION : QUESTION_WITH_CONTEXT, criteria } },
  };

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retryReason: string | null = null;
    try {
      const res = await f(JEV_API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: controller.signal });
      if (RETRY_STATUSES.has(res.status)) {
        retryReason = `${res.status}`;
      } else if (!res.ok) {
        throw new Error(`jev: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`.trim());
      } else {
        const json = (await res.json()) as { model: string; answers?: Record<string, { choice: string; probabilities: Record<string, number>; confidence: number }> };
        const answer = json.answers?.[QUESTION_ID];
        if (!answer) throw new Error("jev: no answer in reply");
        return { choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence, model: json.model };
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") retryReason = "timed out";
      else throw e;
    } finally {
      clearTimeout(timer);
    }
    if (attempt >= MAX_ATTEMPTS - 1) throw new Error(`jev: ${retryReason}, out of retries`);
    await sleep(backoff(attempt));
  }
}
