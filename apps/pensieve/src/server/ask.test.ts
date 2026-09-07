import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterYieldChunk,
  DefaultMessageMetadataByModality,
  ModelMessage,
  StreamChunk,
  TextOptions,
  UIMessage,
} from "@tanstack/ai";
import { EventType } from "@tanstack/ai";
import type { StructuredOutputResult } from "@tanstack/ai/adapters";
import { BaseTextAdapter } from "@tanstack/ai/adapters";
import type { ClaudeCodeTextProviderOptions } from "@tanstack/ai-claude-code";
import { SESSION_ID_EVENT } from "@tanstack/ai-claude-code";
import { runPersistenceConformance } from "@tanstack/ai-persistence/testkit";
import type { AskStatus, ConversationFile } from "./ask";
import { WORKSPACE_DIR } from "./workspace";

// Ask's default store lives under PENSIEVE_HOME; point it at a scratch dir before the module loads.
const HOME = await mkdtemp(join(tmpdir(), "pensieve-home-"));
process.env.PENSIEVE_HOME = HOME;
const ask = await import("./ask");
const {
  conversationStore,
  askStream,
  askStatus,
  authMode,
  allowedToolsFor,
  ADAPTER_CONFIG,
  ASK_SYSTEM_PROMPT,
  AUTH_ERROR_RE,
  pointPrompt,
  diagnosisLine,
  titleOf,
  getConversation,
  listConversations,
  deleteConversation,
  fileNameOf,
} = ask;
const {
  BASE_TOOLS,
  ACCIO_WRITE_VERBS,
  BRIDGED_MCP_PREFIX,
  LINEAR_READ_TOOLS,
  LINEAR_WRITE_TOOLS,
  ASK_TOOL_PART_NAMES,
  PROPOSE_DECISION,
} = await import("../lib/ask-tools");

afterAll(() => rm(HOME, { force: true, recursive: true }));

const scratch = () => mkdtemp(join(tmpdir(), "pensieve-conv-"));
const user = (
  text: string,
  id = `u_${Math.random().toString(36).slice(2)}`
): UIMessage => ({
  id,
  parts: [{ content: text, type: "text" }],
  role: "user",
});
const readJson = async (dir: string, threadId: string) =>
  JSON.parse(
    await readFile(join(dir, fileNameOf(threadId)), "utf8")
  ) as ConversationFile;
const collect = async (
  stream: AsyncIterable<StreamChunk>,
  onChunk?: (c: StreamChunk) => Promise<void> | void
) => {
  const out: StreamChunk[] = [];
  for await (const c of stream) {
    out.push(c);
    await onChunk?.(c);
  }
  return out;
};
/** The engine's own RUN_FINISHED carries the reason in `metadata.tanstack` (spec shape); the adapter's carries it top-level. */
const finishReasonOf = (c: StreamChunk | undefined): string | undefined => {
  if (!c || c.type !== EventType.RUN_FINISHED) {
    return undefined;
  }
  const top = (c as { finishReason?: string }).finishReason;
  const meta = (c as { metadata?: { tanstack?: { finishReason?: string } } })
    .metadata?.tanstack?.finishReason;
  return top ?? meta;
};
const HOST_STATUS: AskStatus = {
  authMode: "host",
  available: true,
  claudePath: "/opt/bin/claude",
  probe: { authMethod: "claude.ai", loggedIn: true },
};
const available = async (): Promise<AskStatus> => HOST_STATUS;

interface FakeClaudeConfig {
  delayMs?: number;
  /** Yield a RUN_ERROR after RUN_FINISHED — what the real adapter does when the CLI exits 1 after its result. */
  errorAfterFinish?: string;
  /** Yield a RUN_ERROR with this message before anything else — the run never reached init (the 08:40 shape). */
  errorBeforeSession?: string;
  /** End with `length` (the CLI's `error_max_turns`) instead of `stop`. */
  finishReason?: "stop" | "length";
  onCall?: () => Promise<void>;
  reply?: string;
  sessionId: string;
  /** Throw after that, the way the sandbox runner does when the CLI exits 1; or before it. */
  throwAfter?: "finish" | "text";
  /** One harness tool call (with its result) before the text, as a real run has. */
  toolCall?: {
    name: string;
    input: Record<string, unknown>;
    result: string;
  };
}

/**
 * Stands in for `claudeCodeText`: emits the session-id event the way the real adapter
 * does (echoing a resumed id, minting one otherwise), then one text reply. Records what
 * `chat()` handed it so the tests can see the transcript, `modelOptions` and system
 * prompts it got.
 */
class FakeClaude extends BaseTextAdapter<
  "fake",
  ClaudeCodeTextProviderOptions,
  readonly ["text"],
  DefaultMessageMetadataByModality
> {
  readonly name = "fake";
  calls: Array<{
    messages: ModelMessage[];
    modelOptions: ClaudeCodeTextProviderOptions | undefined;
    systemPrompts: unknown[];
    at: number;
  }> = [];
  private readonly cfg: FakeClaudeConfig;
  constructor(cfg: FakeClaudeConfig) {
    super({}, "fake");
    this.cfg = cfg;
  }
  async *chatStream(
    options: TextOptions<ClaudeCodeTextProviderOptions>
  ): AsyncIterable<AdapterYieldChunk> {
    this.calls.push({
      at: Date.now(),
      messages: [...options.messages],
      modelOptions: options.modelOptions,
      systemPrompts: [...(options.systemPrompts ?? [])],
    });
    await this.cfg.onCall?.();
    const model = "fake";
    const threadId = options.threadId ?? "t";
    const runId = options.runId ?? "r";
    const now = () => Date.now();
    if (this.cfg.errorBeforeSession) {
      const message = this.cfg.errorBeforeSession;
      yield {
        error: { message },
        message,
        model,
        timestamp: now(),
        type: EventType.RUN_ERROR,
      };
      return;
    }
    yield {
      model,
      name: SESSION_ID_EVENT,
      runId,
      threadId,
      timestamp: now(),
      type: EventType.CUSTOM,
      value: {
        sessionId: options.modelOptions?.sessionId ?? this.cfg.sessionId,
        skills: ["sweep", "slack-digest"],
      },
    };
    yield {
      model,
      runId,
      threadId,
      timestamp: now(),
      type: EventType.RUN_STARTED,
    };
    if (this.cfg.delayMs) {
      await new Promise((r) => setTimeout(r, this.cfg.delayMs));
    }
    const messageId = this.generateId();
    if (this.cfg.toolCall) {
      const toolCallId = this.generateId();
      const { name, input, result } = this.cfg.toolCall;
      const args = JSON.stringify(input);
      yield {
        model,
        timestamp: now(),
        toolCallId,
        toolCallName: name,
        toolName: name,
        type: EventType.TOOL_CALL_START,
      };
      yield {
        args,
        delta: args,
        model,
        timestamp: now(),
        toolCallId,
        type: EventType.TOOL_CALL_ARGS,
      };
      yield {
        input,
        model,
        timestamp: now(),
        toolCallId,
        toolCallName: name,
        toolName: name,
        type: EventType.TOOL_CALL_END,
      };
      yield {
        content: result,
        messageId: this.generateId(),
        model,
        timestamp: now(),
        toolCallId,
        type: EventType.TOOL_CALL_RESULT,
      };
    }
    yield {
      messageId,
      model,
      role: "assistant",
      timestamp: now(),
      type: EventType.TEXT_MESSAGE_START,
    };
    yield {
      delta: this.cfg.reply ?? "answer",
      messageId,
      model,
      timestamp: now(),
      type: EventType.TEXT_MESSAGE_CONTENT,
    };
    yield {
      messageId,
      model,
      timestamp: now(),
      type: EventType.TEXT_MESSAGE_END,
    };
    if (this.cfg.throwAfter === "text") {
      throw new Error("Agent process exited with code 1");
    }
    yield {
      finishReason: this.cfg.finishReason ?? "stop",
      model,
      runId,
      threadId,
      timestamp: now(),
      type: EventType.RUN_FINISHED,
    };
    if (this.cfg.throwAfter === "finish") {
      throw new Error("Agent process exited with code 1");
    }
    if (this.cfg.errorAfterFinish) {
      const message = this.cfg.errorAfterFinish;
      yield {
        error: { message },
        message,
        model,
        timestamp: now(),
        type: EventType.RUN_ERROR,
      };
    }
  }
  structuredOutput(): Promise<StructuredOutputResult<unknown>> {
    return Promise.reject(new Error("not supported"));
  }
}

// ── AC3: the store passes the shared conformance suite ─────────────────────────

runPersistenceConformance(
  "pensieve file store",
  async () => conversationStore(await scratch()).persistence,
  {
    skip: ["runs", "interrupts", "generationRuns", "artifacts", "blobs"],
  }
);

describe("file store — beyond the suite", () => {
  test("ids become safe file names and round-trip through list()", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await store.persistence.stores.messages.saveThread("..", [
      { content: "dots", role: "user" },
    ]);
    await store.persistence.stores.messages.saveThread("a/b c", [
      { content: "slash", role: "user" },
    ]);
    const names = (await readdir(dir)).sort();
    expect(names).toEqual(["%2E%2E.json", "a%2Fb%20c.json"]);
    expect((await store.list()).map((c) => c.threadId).sort()).toEqual([
      "..",
      "a/b c",
    ]);
  });

  test("writes are whole files: no temp file survives, and a torn read never happens", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.persistence.stores.messages.saveThread("t", [
          { content: `v${i}`, role: "user" },
        ])
      )
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.persistence.stores.metadata.set("t", `k${i}`, i)
      )
    );
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    const f = await readJson(dir, "t");
    expect(f.messages).toEqual([{ content: "v19", role: "user" }]);
    expect(Object.keys(f.metadata)).toHaveLength(20);
  });
});

// ── AC1 + AC2: a run persists, and the next one resumes the session ────────────

describe("AC1 — a run writes the user turn on start and the full transcript before RUN_FINISHED", () => {
  test("new thread", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    let atStart: ConversationFile | undefined;
    const adapter = new FakeClaude({
      onCall: async () => {
        atStart = await readJson(dir, "th1");
      },
      reply: "hello there",
      sessionId: "sess-1",
    });
    let atFinish: ConversationFile | undefined;
    const chunks = await collect(
      askStream(
        { messages: [user("hi")], threadId: "th1" },
        { adapter, middleware: [], status: available, store }
      ),
      async (c) => {
        if (c.type === EventType.RUN_FINISHED) {
          atFinish = await readJson(dir, "th1");
        }
      }
    );
    // On run start: the user turn only.
    expect(atStart?.messages).toMatchObject([{ content: "hi", role: "user" }]);
    // At RUN_FINISHED: the whole transcript and the session id, before the chunk went out.
    expect(atFinish?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(atFinish?.messages[1]?.content).toBe("hello there");
    expect(atFinish?.metadata.sessionId).toBe("sess-1");
    expect(chunks.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(
      false
    );
  });
});

describe("LIA-109 AC1/AC6/AC7 — the point a conversation was opened on", () => {
  test("written on the first run that names it, and never overwritten", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ sessionId: "sess-P" });
    await collect(
      askStream(
        {
          messages: [user("what is this point")],
          point: "decide/lia-71-history-rollup",
          threadId: "tp1",
        },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect((await readJson(dir, "tp1")).metadata.point).toBe(
      "decide/lia-71-history-rollup"
    );
    expect((await getConversation("tp1", store))?.point).toBe(
      "decide/lia-71-history-rollup"
    );

    // A later run claiming a different point does not re-point the conversation.
    await collect(
      askStream(
        {
          messages: [user("and now")],
          point: "housekeeping/something-else",
          threadId: "tp1",
        },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect((await readJson(dir, "tp1")).metadata.point).toBe(
      "decide/lia-71-history-rollup"
    );
  });

  test("no point given: none stored, and none on the wire (AC6)", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await collect(
      askStream(
        { messages: [user("plain question")], threadId: "tp2" },
        {
          adapter: new FakeClaude({ sessionId: "sess-Q" }),
          middleware: [],
          status: available,
          store,
        }
      )
    );
    expect((await readJson(dir, "tp2")).metadata.point).toBeUndefined();
    expect((await getConversation("tp2", store))?.point).toBeUndefined();
  });

  test("a value that is not a point id is neither stored nor returned", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await collect(
      askStream(
        {
          messages: [user("hi")],
          point: "../../etc/passwd",
          threadId: "tp3",
        },
        {
          adapter: new FakeClaude({ sessionId: "sess-R" }),
          middleware: [],
          status: available,
          store,
        }
      )
    );
    expect((await readJson(dir, "tp3")).metadata.point).toBeUndefined();
    // Nor one that reached the file some other way — a hand edit, an older shape.
    await store.persistence.stores.metadata.set("tp3", "point", "not a point");
    expect((await getConversation("tp3", store))?.point).toBeUndefined();
  });
});

describe("AC2 — the second run on a thread resumes the stored session", () => {
  test("full transcript resent: sessionId comes from the store, not the client", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ sessionId: "sess-A" });
    const u1 = user("first");
    await collect(
      askStream(
        { messages: [u1], threadId: "th2" },
        { adapter, middleware: [], status: available, store }
      )
    );
    const stored = await getConversation("th2", store);
    expect(stored?.sessionId).toBe("sess-A");

    const chunks = await collect(
      askStream(
        {
          messages: [...(stored?.messages ?? []), user("second")],
          threadId: "th2",
        },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1].modelOptions?.sessionId).toBe("sess-A");
    expect(adapter.calls[1].messages.at(-1)).toMatchObject({
      content: "second",
      role: "user",
    });
    const evt = chunks.find(
      (c) => c.type === EventType.CUSTOM && c.name === SESSION_ID_EVENT
    );
    expect(
      (evt as { value?: { sessionId?: string } } | undefined)?.value?.sessionId
    ).toBe("sess-A");
    expect((await readJson(dir, "th2")).messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  test("empty messages: continues the stored transcript as it stands", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await store.persistence.stores.messages.saveThread("th3", [
      { content: "q1", role: "user" },
      { content: "a1", role: "assistant" },
      { content: "q2 (unanswered)", role: "user" },
    ]);
    await store.persistence.stores.metadata.set("th3", "sessionId", "sess-B");
    const adapter = new FakeClaude({ sessionId: "never-used" });
    const chunks = await collect(
      askStream(
        { messages: [], threadId: "th3" },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect(adapter.calls[0].messages).toEqual([
      { content: "q1", role: "user" },
      { content: "a1", role: "assistant" },
      { content: "q2 (unanswered)", role: "user" },
    ]);
    expect(adapter.calls[0].modelOptions?.sessionId).toBe("sess-B");
    expect(chunks.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect((await readJson(dir, "th3")).messages).toHaveLength(4);
  });

  test("empty messages with nothing unanswered is an error chunk, not a spawn", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await store.persistence.stores.messages.saveThread("th4", [
      { content: "q1", role: "user" },
      { content: "a1", role: "assistant" },
    ]);
    const adapter = new FakeClaude({ sessionId: "x" });
    const chunks = await collect(
      askStream(
        { messages: [], threadId: "th4" },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect(adapter.calls).toHaveLength(0);
    expect(chunks.map((c) => c.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
    expect((chunks[1] as { code?: string }).code).toBe(
      "ASK_NOTHING_TO_CONTINUE"
    );
  });

  test("one run at a time per thread: a second send waits for the first to finish", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ delayMs: 120, sessionId: "s" });
    const finishedAt: number[] = [];
    const run = (text: string) =>
      collect(
        askStream(
          { messages: [user(text)], threadId: "th5" },
          { adapter, middleware: [], status: available, store }
        ),
        (c) => {
          if (c.type === EventType.RUN_FINISHED) {
            finishedAt.push(Date.now());
          }
        }
      );
    await Promise.all([run("one"), run("two")]);
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1].at).toBeGreaterThanOrEqual(finishedAt[0]);
  });
});

// ── AC4 / AC6: configuration and availability ──────────────────────────────────

describe("AC4 (LIA-102) / LIA-104 — the tool set: read-only, with accio, the checkouts and Linear reads", () => {
  test("the base set, the Linear read tools and both spellings of each checkout are allowed; permissionMode is default", () => {
    for (const t of [...BASE_TOOLS, ...LINEAR_READ_TOOLS]) {
      expect(ADAPTER_CONFIG.allowedTools).toContain(t);
    }
    expect(ADAPTER_CONFIG.permissionMode).toBe("default");
    const rules = allowedToolsFor(["~/git/x", "/srv/y"]);
    const home = process.env.HOME ?? "";
    for (const r of [
      "Bash(git -C ~/git/x log:*)",
      "Bash(git -C ~/git/x show:*)",
      `Bash(git -C ${home}/git/x log:*)`,
      `Bash(git -C ${home}/git/x show:*)`,
      "Bash(git -C /srv/y log:*)",
      "Bash(git -C /srv/y show:*)",
    ]) {
      expect(rules).toContain(r);
    }
    expect(rules.filter((r) => r.startsWith("Bash(git -C"))).toHaveLength(6);
    // `git fetch`, `branch`, `find`, `python3`: nothing lets them through.
    expect(rules.some((r) => /fetch|branch|find|python/.test(r))).toBe(false);
  });
  test("writes are denied by name: harness, accio sync/map, every Linear write tool; no name is in both lists", () => {
    for (const t of [
      "Write",
      "Edit",
      ...ACCIO_WRITE_VERBS,
      ...LINEAR_WRITE_TOOLS,
    ]) {
      expect(ADAPTER_CONFIG.disallowedTools).toContain(t);
    }
    const both = ADAPTER_CONFIG.allowedTools.filter((t) =>
      ADAPTER_CONFIG.disallowedTools.includes(t)
    );
    expect(both).toEqual([]);
    expect(LINEAR_WRITE_TOOLS.every((t) => t.startsWith("mcp__linear__"))).toBe(
      true
    );
    expect(
      LINEAR_WRITE_TOOLS.some((t) =>
        /save_issue$|save_comment|share_issue|diff|release/.test(t)
      )
    ).toBe(true);
  });
  test("LIA-111 — the bridged tool is allowed under its mcp__tanstack__ name, and no bridged name is denied", () => {
    // Under `permissionMode: 'default'` an MCP tool absent from --allowedTools is denied,
    // and the session only ever sees the prefixed spelling.
    expect(ADAPTER_CONFIG.allowedTools).toContain(
      `${BRIDGED_MCP_PREFIX}${PROPOSE_DECISION}`
    );
    expect(ADAPTER_CONFIG.allowedTools).toContain(
      "mcp__tanstack__propose_decision"
    );
    expect(
      ADAPTER_CONFIG.disallowedTools.filter((t) =>
        t.startsWith(BRIDGED_MCP_PREFIX)
      )
    ).toEqual([]);
    // The bare name never reaches the CLI: a rule spelled without the prefix matches nothing.
    expect(ADAPTER_CONFIG.allowedTools).not.toContain(PROPOSE_DECISION);
  });
  test("the page can render every name a run may call: the allowlist collapsed to tool names, and the denied ones", () => {
    for (const t of [
      "Read",
      "Grep",
      "Glob",
      "Bash",
      "Skill",
      "Edit",
      "Write",
      // The adapter strips `mcp__tanstack__` on the way back, so the part carries the bare name.
      PROPOSE_DECISION,
      ...LINEAR_READ_TOOLS,
      ...LINEAR_WRITE_TOOLS,
    ]) {
      expect(ASK_TOOL_PART_NAMES).toContain(t);
    }
    expect(ASK_TOOL_PART_NAMES.some((t) => t.includes("("))).toBe(false);
    expect(
      ASK_TOOL_PART_NAMES.some((t) => t.startsWith(BRIDGED_MCP_PREFIX))
    ).toBe(false);
  });
});

describe("LIA-104 — the system prompt", () => {
  test("is short, says where the session is, how to retrieve, how to answer, and what it cannot do", () => {
    expect(ASK_SYSTEM_PROMPT.split(/\s+/).length).toBeLessThan(260);
    for (const re of [
      /not a terminal/i,
      /no permission dialog/i,
      /never tell the user to grant, allow or approve/i,
      /skills\/ask\/SKILL\.md/,
      /bun run accio point/,
      /bun run accio ticket/,
      /mcp__linear__get_issue/,
      /git -C <repo> show origin/,
      /never run git fetch/i,
      /cite every path/i,
      /the files don't say/i,
      /cannot write files, edit tickets or comments, or run the sweep/i,
      /call `propose_decision` once as the ask skill says/,
      /confirms it on the card/i,
      /never say it is done/i,
    ]) {
      expect(ASK_SYSTEM_PROMPT).toMatch(re);
    }
  });
  test("LIA-111 — a conversation opened on a point tells the run which point it is, and one without says nothing", async () => {
    const store = conversationStore(await scratch());
    const withPoint = new FakeClaude({ sessionId: "p1" });
    await collect(
      askStream(
        {
          messages: [user("ignore it")],
          point: "decide/lia-71-history-rollup",
          threadId: "pt1",
        },
        { adapter: withPoint, middleware: [], status: available, store }
      )
    );
    expect(withPoint.calls[0].systemPrompts).toEqual([
      ASK_SYSTEM_PROMPT,
      pointPrompt("decide/lia-71-history-rollup"),
    ]);
    expect(pointPrompt("decide/x")).toContain("decide/x");
    expect(pointPrompt("decide/x")).toMatch(/"it" in a question or a verdict/);

    const noPoint = new FakeClaude({ sessionId: "p2" });
    await collect(
      askStream(
        { messages: [user("hi")], threadId: "pt2" },
        { adapter: noPoint, middleware: [], status: available, store }
      )
    );
    expect(noPoint.calls[0].systemPrompts).toEqual([ASK_SYSTEM_PROMPT]);
  });
  test("is passed to the adapter on every run", async () => {
    const store = conversationStore(await scratch());
    const adapter = new FakeClaude({ sessionId: "x" });
    await collect(
      askStream(
        { messages: [user("hi")], threadId: "sp1" },
        { adapter, middleware: [], status: available, store }
      )
    );
    expect(adapter.calls[0].systemPrompts).toEqual([ASK_SYSTEM_PROMPT]);
  });
});

describe("AC6 (LIA-102) / AC5 (LIA-104) — auth mode, availability, and what the probe said", () => {
  test("ANTHROPIC_API_KEY decides api-key; otherwise host", () => {
    expect(authMode({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("api-key");
    expect(authMode({ ANTHROPIC_API_KEY: "  " })).toBe("host");
    expect(authMode({})).toBe("host");
  });
  test("askStatus: key → available (probe not consulted); host probe false → reason; probe cannot tell → available; the verdict and path come through", async () => {
    const path = "/opt/homebrew/bin/claude";
    expect(
      await askStatus({ claudePath: path, env: { ANTHROPIC_API_KEY: "k" } })
    ).toEqual({
      authMode: "api-key",
      available: true,
      claudePath: path,
      probe: { loggedIn: null },
    });
    const off = await askStatus({
      claudePath: path,
      env: {},
      probe: async () => ({ loggedIn: false }),
    });
    expect(off.available).toBe(false);
    expect(off.available === false && off.reason).toMatch(/claude login/);
    expect(off.available === false && off.reason).toMatch(/Keychain/);
    expect(off.probe).toEqual({ loggedIn: false });
    expect(
      await askStatus({ claudePath: null, env: {}, probe: async () => null })
    ).toEqual({
      authMode: "host",
      available: true,
      claudePath: null,
      probe: { loggedIn: null },
    });
    expect(
      await askStatus({
        claudePath: path,
        env: {},
        probe: async () => ({ authMethod: "claude.ai", loggedIn: true }),
      })
    ).toEqual({
      authMode: "host",
      available: true,
      claudePath: path,
      probe: { authMethod: "claude.ai", loggedIn: true },
    });
  });
  test("the diagnosis line names the binary, the auth mode and the verdict", () => {
    expect(diagnosisLine(HOST_STATUS)).toBe(
      "Ask runs `claude` from `/opt/bin/claude` as `host`; `claude auth status` said `loggedIn: true, claude.ai`; on macOS a Keychain dialog may be waiting for the claude process — choose Always Allow."
    );
    expect(
      diagnosisLine({
        authMode: "api-key",
        available: true,
        claudePath: null,
        probe: { loggedIn: null },
      })
    ).toMatch(
      /from `not on PATH` as `api-key`; `claude auth status` said `unreachable`/
    );
    expect(
      diagnosisLine({
        available: false,
        claudePath: "/c",
        probe: { loggedIn: false },
        reason: "x",
      })
    ).toMatch(/said `not logged in`/);
  });
  test("unavailable: a 503-style error chunk carrying the diagnosis, nothing spawned, nothing written", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ sessionId: "x" });
    const status: AskStatus = {
      available: false,
      claudePath: "/c",
      probe: { loggedIn: false },
      reason: "no credential",
    };
    const chunks = await collect(
      askStream(
        { messages: [user("hi")], threadId: "th6" },
        { adapter, middleware: [], status: async () => status, store }
      )
    );
    expect(adapter.calls).toHaveLength(0);
    expect(chunks.map((c) => c.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
    expect(chunks[1]).toMatchObject({
      code: "ASK_UNAVAILABLE",
      message: `no credential\n${diagnosisLine(status)}`,
    });
    expect(await store.read("th6")).toBeNull();
  });
  test("the run passes authMode through modelOptions", async () => {
    const store = conversationStore(await scratch());
    const adapter = new FakeClaude({ sessionId: "x" });
    await collect(
      askStream(
        { messages: [user("hi")], threadId: "th7" },
        {
          adapter,
          env: { ANTHROPIC_API_KEY: "k" },
          middleware: [],
          status: available,
          store,
        }
      )
    );
    await collect(
      askStream(
        { messages: [user("hi")], threadId: "th8" },
        { adapter, env: {}, middleware: [], status: available, store }
      )
    );
    expect(adapter.calls[0].modelOptions?.authMode).toBe("api-key");
    expect(adapter.calls[1].modelOptions?.authMode).toBe("host");
  });
});

// ── AC7: the list and delete ───────────────────────────────────────────────────

describe("AC7 — listConversations and deleteConversation", () => {
  test("newest first, title = first user turn; delete removes that one file", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ sessionId: "x" });
    for (const [id, q] of [
      ["c1", "What   changed\nyesterday?"],
      ["c2", "Second question"],
      ["c3", "Third question"],
    ] as const) {
      await collect(
        askStream(
          { messages: [user(q)], threadId: id },
          { adapter, middleware: [], status: available, store }
        )
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    // A file with no user turn is not a conversation.
    await store.persistence.stores.metadata.set("orphan", "sessionId", "z");

    const list = await listConversations(store);
    expect(list.map((c) => c.threadId)).toEqual(["c3", "c2", "c1"]);
    expect(list[2]).toMatchObject({
      threadId: "c1",
      title: "What changed yesterday?",
    });
    expect(list.every((c) => /^\d{4}-\d{2}-\d{2}T/.test(c.updatedAt))).toBe(
      true
    );

    const remaining = await deleteConversation("c2", store);
    expect(remaining.map((c) => c.threadId)).toEqual(["c3", "c1"]);
    expect((await readdir(dir)).sort()).toEqual([
      "c1.json",
      "c3.json",
      "orphan.json",
    ]);
    // Deleting again is quiet.
    expect(
      (await deleteConversation("c2", store)).map((c) => c.threadId)
    ).toEqual(["c3", "c1"]);
  });

  test("getConversation gives UI messages plus the session id; unknown is null", async () => {
    const store = conversationStore(await scratch());
    const adapter = new FakeClaude({ reply: "forty-two", sessionId: "sess-Q" });
    await collect(
      askStream(
        { messages: [user("the answer?")], threadId: "g1" },
        { adapter, middleware: [], status: available, store }
      )
    );
    const c = await getConversation("g1", store);
    expect(c?.sessionId).toBe("sess-Q");
    expect(c?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(c?.messages[1]?.parts).toEqual([
      { content: "forty-two", type: "text" },
    ]);
    expect(await getConversation("nope", store)).toBeNull();
  });

  test("titleOf reads string and part content", () => {
    expect(
      titleOf([
        { content: "x", role: "assistant" },
        { content: [{ content: " a  b ", type: "text" }], role: "user" },
      ])
    ).toBe("a b");
    expect(titleOf([])).toBe("");
  });
});

// ── Live round trip (AC1, AC2, AC4, AC5 against the real claude) ───────────────
//
// Spawns claude over the argus checkout twice; needs `claude login` (or a key) and a
// minute. Off unless ASK_LIVE=1 so `bun test` stays free and offline.

const live = process.env.ASK_LIVE === "1";

describe("AC8 (LIA-104) — the turn cap: the CLI prints its result, then exits 1", () => {
  const toolCall = {
    input: { file_path: "reports/points.json" },
    name: "Read",
    result: '{"points":[]}',
  };
  for (const [how, after] of [
    [
      "the adapter yields RUN_ERROR after its finish (the real adapter)",
      { errorAfterFinish: "Agent process exited with code 1" },
    ],
    ["the adapter throws after its finish", { throwAfter: "finish" as const }],
  ] as const) {
    test(`${how}: RUN_FINISHED(length) goes out, nothing errors, the whole transcript (tool parts included) and the reason are on disk`, async () => {
      const dir = await scratch();
      const store = conversationStore(dir);
      const adapter = new FakeClaude({
        finishReason: "length",
        reply: "Now let me check what",
        sessionId: "s",
        toolCall,
        ...after,
      });
      // The harness runs its tools itself, so the engine never writes them to the transcript;
      // `withSandbox` records them (`ai-sandbox/tool-history`) and reconciles on finish — the
      // finish that never came on this path before `finishedIsFinished`. So the sandbox is in.
      const { sandboxMiddleware } = ask;
      const chunks = await collect(
        askStream(
          { messages: [user("read everything")], threadId: "cap" },
          { adapter, middleware: [sandboxMiddleware], status: available, store }
        )
      );
      expect(chunks.at(-1)?.type).toBe(EventType.RUN_FINISHED);
      expect(finishReasonOf(chunks.at(-1))).toBe("length");
      expect(chunks.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(
        false
      );
      const f = await readJson(dir, "cap");
      expect(f.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(JSON.stringify(f.messages[1])).toContain("reports/points.json");
      expect(f.messages[3]?.content).toBe("Now let me check what");
      expect(f.metadata.sessionId).toBe("s");
      expect(f.metadata.finishReason).toBe("length");
      expect(f.metadata.lastError).toBeUndefined();
      const c = await getConversation("cap", store);
      expect(c?.finishReason).toBe("length");
      expect(c?.lastError).toBeUndefined();
      // The parts the page hydrates from: the tool call with its result, then the text.
      expect(c?.messages[1]?.parts.map((p) => p.type)).toEqual([
        "tool-call",
        "tool-result",
      ]);
      expect(c?.messages[2]?.parts.map((p) => p.type)).toEqual(["text"]);
    });
  }
  test("a failure before the result is still a failure, and is on disk as lastError", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({ sessionId: "s", throwAfter: "text" });
    await expect(
      collect(
        askStream(
          { messages: [user("read everything")], threadId: "cap2" },
          { adapter, middleware: [], status: available, store }
        )
      )
    ).rejects.toThrow("exited with code 1");
    const f = await readJson(dir, "cap2");
    expect(f.metadata.lastError).toMatchObject({
      message: "Agent process exited with code 1",
    });
    expect(f.metadata.finishReason).toBeUndefined();
  });
  test("a clean run clears what the last one left", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    await store.persistence.stores.messages.saveThread("cap3", [
      { content: "q", role: "user" },
      { content: "a", role: "assistant" },
    ]);
    await store.persistence.stores.metadata.set(
      "cap3",
      "finishReason",
      "length"
    );
    await store.persistence.stores.metadata.set("cap3", "lastError", {
      at: "",
      message: "old",
    });
    const adapter = new FakeClaude({ sessionId: "s" });
    await collect(
      askStream(
        { messages: [user("q"), user("again")], threadId: "cap3" },
        { adapter, middleware: [], status: available, store }
      )
    );
    const f = await readJson(dir, "cap3");
    expect(f.metadata.finishReason).toBeUndefined();
    expect(f.metadata.lastError).toBeUndefined();
  });
});

// ── AC4 (LIA-104): an auth failure leaves a diagnosable trace ─────────────────

describe("AC4 (LIA-104) — a run that fails before its session id", () => {
  test("the RUN_ERROR shown carries the diagnosis line; the file holds the user turn, no session id, and lastError", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const raw =
      "Agent process exited with code 1: Not logged in · Please run /login";
    const adapter = new FakeClaude({
      errorBeforeSession: raw,
      sessionId: "never",
    });
    const chunks = await collect(
      askStream(
        { messages: [user("hi")], threadId: "auth1" },
        { adapter, env: {}, middleware: [], status: available, store }
      )
    ).catch((e: unknown) => {
      // The engine rethrows after the chunk went out; what matters is what went out and what is on disk.
      expect(String(e)).toContain("Not logged in");
      return [] as StreamChunk[];
    });
    const err = chunks.find((c) => c.type === EventType.RUN_ERROR) as
      | { message: string }
      | undefined;
    const expected = `${raw}\n${diagnosisLine(HOST_STATUS, "host")}`;
    expect(err?.message).toBe(expected);
    const f = await readJson(dir, "auth1");
    expect(f.messages).toMatchObject([{ content: "hi", role: "user" }]);
    expect(f.metadata.sessionId).toBeUndefined();
    expect(f.metadata.lastError).toMatchObject({ message: expected });
    expect((f.metadata.lastError as { at: string }).at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/
    );
    expect((await getConversation("auth1", store))?.lastError?.message).toBe(
      expected
    );
  });
  test("an error that is not about the credential is stored as it is", async () => {
    const dir = await scratch();
    const store = conversationStore(dir);
    const adapter = new FakeClaude({
      errorBeforeSession: "read ECONNRESET",
      sessionId: "never",
    });
    await collect(
      askStream(
        { messages: [user("hi")], threadId: "auth2" },
        { adapter, middleware: [], status: available, store }
      )
    ).catch(() => undefined);
    expect((await readJson(dir, "auth2")).metadata.lastError).toMatchObject({
      message: "read ECONNRESET",
    });
  });
  test("AUTH_ERROR_RE matches the shapes seen and expected", () => {
    for (const s of [
      "Not logged in · Please run /login",
      "authentication_error: invalid x-api-key",
      "Keychain access denied",
      "OAuth token expired, login again",
      "Agent process exited with code 1: Error: spawn claude ENOENT",
    ]) {
      expect(AUTH_ERROR_RE.test(s)).toBe(true);
    }
    expect(AUTH_ERROR_RE.test("Agent process exited with code 1")).toBe(false);
  });
});

describe.skipIf(!live)("live — real adapter over the checkout", () => {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", WORKSPACE_DIR, ...args], { encoding: "utf8" });
  const fingerprint = () =>
    git("status", "--porcelain=v1", "--untracked-files=all") +
    git("rev-parse", "HEAD");
  let before = "";
  beforeAll(() => {
    before = fingerprint();
  });

  test("two turns share one session; skills are argus's; the checkout is untouched", async () => {
    const store = conversationStore(await scratch());
    const events: Array<{ sessionId: string; skills: unknown[] }> = [];
    const onChunk = (c: StreamChunk) => {
      if (c.type === EventType.CUSTOM && c.name === SESSION_ID_EVENT) {
        events.push(c.value as { sessionId: string; skills: unknown[] });
      }
    };
    const q1 = user("Reply with exactly the word PONG and nothing else.");
    const run1 = await collect(
      askStream(
        { messages: [q1], threadId: "live-1" },
        { status: available, store }
      ),
      onChunk
    );
    expect(run1.find((c) => c.type === EventType.RUN_ERROR)).toBeUndefined();
    expect(run1.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const stored = await getConversation("live-1", store);
    expect(stored?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored?.sessionId).toBe(events[0].sessionId);

    const run2 = await collect(
      askStream(
        {
          messages: [
            ...(stored?.messages ?? []),
            user("Now reply with exactly PONG2."),
          ],
          threadId: "live-1",
        },
        { status: available, store }
      ),
      onChunk
    );
    expect(run2.find((c) => c.type === EventType.RUN_ERROR)).toBeUndefined();
    expect(events).toHaveLength(2);
    expect(events[1].sessionId).toBe(events[0].sessionId);

    const names = events[0].skills.map((s) =>
      typeof s === "string" ? s : (s as { name?: string }).name
    );
    for (const s of [
      "sweep",
      "slack-digest",
      "log-change",
      "feature-docs",
      "linear-ticket",
    ]) {
      expect(names).toContain(s);
    }

    expect(fingerprint()).toBe(before);
    console.log("[live] session", events[0].sessionId, "skills", names);
  }, 240_000);
});
