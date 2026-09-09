/**
 * Node-only. The server half of Ask (LIA-102): the Claude Code adapter configured to
 * read the argus checkout and nothing more, a TanStack AI persistence adapter that keeps
 * one conversation per file under `PENSIEVE_HOME/conversations/`, and the run itself.
 *
 * Pensieve's rule holds: in the blackboard it writes `decisions/` and nothing else. Ask
 * writes only under `PENSIEVE_HOME` (default `~/.pensieve`). The claude process runs with
 * `permissionMode: 'default'` and a read-only allowlist, so the checkout is never touched;
 * the adapter's per-run runner files land in the checkout for the run's duration and are
 * removed in its `finally` — `git status` is unchanged afterwards.
 *
 * Three tools are bridged into the run: `propose_decision` (LIA-111), `propose_ticket`
 * (LIA-113) and `propose_arc` (LIA-147). A bridged tool always executes when the model
 * calls it, so each only reads and answers a proposal; the write is Liam's click on the
 * card the chat renders from its tool part — `decisions/` for a verdict or an arc's seed
 * file, Linear's `issueCreate` for a ticket.
 *
 * Auth is decided per request: `ANTHROPIC_API_KEY` in the environment means `'api-key'`
 * (the container); otherwise `'host'` — the machine's `claude login`. With neither,
 * `askStatus()` says so and `askStream()` answers a RUN_ERROR chunk instead of spawning.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  AnyTextAdapter,
  ChatMiddleware,
  DebugOption,
  Logger,
  ModelMessage,
  StreamChunk,
  UIMessage,
} from "@tanstack/ai";
import {
  chat,
  convertMessagesToModelMessages,
  defineChatMiddleware,
  EventType,
  modelMessagesToUIMessages,
} from "@tanstack/ai";
import type { ClaudeCodeTextConfig } from "@tanstack/ai-claude-code";
import { claudeCodeText, SESSION_ID_EVENT } from "@tanstack/ai-claude-code";
import type {
  AIPersistence,
  MessageStore,
  MetadataStore,
} from "@tanstack/ai-persistence";
import {
  defineAIPersistence,
  defineMessageStore,
  defineMetadataStore,
  withPersistence,
} from "@tanstack/ai-persistence";
import {
  defineSandbox,
  SandboxCapability,
  withSandbox,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import {
  ACCIO_WRITE_VERBS,
  BASE_TOOLS,
  bridgedToolRules,
  gitReadRules,
  HARNESS_WRITE_TOOLS,
  LINEAR_READ_TOOLS,
  LINEAR_WRITE_TOOLS,
} from "../lib/ask-tools";
import { isPointId } from "../lib/points";
import {
  proposeArcTool,
  proposeDecisionTool,
  proposeTicketTool,
} from "./ask-tools.server";
import { WORKSPACE_DIR } from "./workspace";

// ── configuration ──────────────────────────────────────────────────────────────

/** Ask's own state directory — the only place this feature writes. */
export const PENSIEVE_HOME = resolve(
  process.env.PENSIEVE_HOME || join(homedir(), ".pensieve")
);
export const CONVERSATIONS_DIR = join(PENSIEVE_HOME, "conversations");

/** The claude binary's own model alias; the CLI resolves it. */
export const MODEL = "sonnet";

/**
 * The product checkouts the `ask` skill reads at their landed refs (`git -C <repo> show
 * origin/<branch>:<path>`). Same defaults as argus's `scripts/lib/manifest.ts`; `FE_REPO` /
 * `BE_REPO` override them where the paths differ (the container).
 */
export const CHECKOUTS = [
  process.env.FE_REPO?.trim() || "~/git/alden-portal-fe",
  process.env.BE_REPO?.trim() || "~/git/alden-connect-portal-be",
];

const expandHome = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

/**
 * The allowlist for a set of checkouts. A `Bash(...)` rule is a literal command prefix, so
 * each checkout gets its rules in both spellings the session will type: `~/git/…` as the
 * skill writes it, and the absolute path as `accio point` prints it. The bridged tool joins
 * them under its `mcp__tanstack__` name — without that rule the session's call is denied.
 */
export function allowedToolsFor(checkouts: readonly string[]): string[] {
  const rules = new Set<string>([
    ...BASE_TOOLS,
    ...LINEAR_READ_TOOLS,
    ...bridgedToolRules(),
  ]);
  for (const c of checkouts) {
    for (const p of new Set([c, expandHome(c)])) {
      for (const r of gitReadRules(p)) {
        rules.add(r);
      }
    }
  }
  return [...rules];
}

/** Files, search, git history, the accio read verbs, the `ask` skill, Linear reads and the bridged tool. Nothing that writes. */
export const ALLOWED_TOOLS = allowedToolsFor(CHECKOUTS);

/** Belt and braces under `default`: these never even reach the permission check. */
export const DISALLOWED_TOOLS = [
  ...HARNESS_WRITE_TOOLS,
  ...ACCIO_WRITE_VERBS,
  ...LINEAR_WRITE_TOOLS,
];

/**
 * The adapter configuration (`docs/adapters/claude-code.md`). `cwd` is the sandbox's
 * virtual root, which the local-process provider maps onto the argus checkout.
 * `settingSources` stays at `['project']`: it is what loads argus's `.mcp.json` (the Linear
 * server) and argus symlinks its skills into its own `.claude/skills` — the host's
 * `~/.claude` stays out of the run.
 */
export const ADAPTER_CONFIG = {
  allowedTools: ALLOWED_TOOLS,
  cwd: "/workspace",
  disallowedTools: DISALLOWED_TOOLS,
  emitDiff: false,
  // One turn per model round-trip, so every tool call is one: a question about a point that
  // reads the report, a journal entry and a doc or two is 15–25. When the cap is hit the CLI
  // still prints its result (finish reason `length`) and then exits 1 — see `askStream`.
  maxTurns: 40,
  permissionMode: "default",
  settingSources: ["project"],
} satisfies ClaudeCodeTextConfig;

// Once per process, so the value the running server uses is on record (a dev server keeps
// an old module loaded across edits; the 08:48 run on 2026-09-06 ran with 12 while the
// source said 40).
console.log(
  `[ask] claude-code · model ${MODEL} · maxTurns ${ADAPTER_CONFIG.maxTurns} · permissionMode ${ADAPTER_CONFIG.permissionMode} · ${ALLOWED_TOOLS.length} allowed · ${DISALLOWED_TOOLS.length} disallowed · checkouts ${CHECKOUTS.join(", ")}`
);

/**
 * Appended to Claude Code's own prompt (`--append-system-prompt`, the adapter's default
 * mode), so the harness's tool behaviour stays and only the environment facts are added.
 * The file map and the retrieval recipes live in argus (`CLAUDE.md`, the `ask` skill),
 * which the run loads with `--setting-sources project`; they are not repeated here.
 */
export const ASK_SYSTEM_PROMPT = `You are Argus, a panel inside Pensieve — a web app that reads the argus blackboard. Your working directory is the argus checkout. This is not a terminal: there is no permission dialog, and nobody can grant, allow or approve anything. A tool that is denied stays denied for this run; say what you could not do in one sentence and answer from what you have. Never tell the user to grant, allow or approve anything, and never wait for approval.

To answer, load the \`ask\` skill (skills/ask/SKILL.md) and follow it. A point is \`bun run accio point <group>/<slug>\`; a ticket is \`bun run accio ticket LIA-nn\` then mcp__linear__get_issue; a day is \`bun run accio journal <YYYY-MM-DD>\`; an initiative is \`bun run accio arc <slug>\`. Read the product checkouts with Read, Glob, Grep and \`git -C <repo> log\` / \`git -C <repo> show origin/<branch>:<path>\`. Never run git fetch, git branch, git checkout, find, python3, or cat/grep/ls through Bash — each is a denied turn.

Cite every path and command you used. "The files don't say" beats a guess. Keep the answer short: it is read in a chat panel.

You cannot write files, edit tickets or comments, or run the sweep. To ignore or send a point, call \`propose_decision\` once as the ask skill says; Liam confirms it on the card — say it is proposed in one sentence and never say it is done. To file a new ticket, draft it per the linear-ticket skill and call \`propose_ticket\` once; Liam files it on the card — say it is proposed, never that it is filed. To open an arc for an initiative, call \`propose_arc\` once as the ask skill's Arcs section says; Liam opens it on the card and the sweep writes the arc file on its next tick — never say the arc exists.`;

/**
 * The extra system prompt a conversation opened on a point carries (LIA-109 stores it,
 * LIA-111 acts on it). Without it "ignore it" has no antecedent on the first turn: the
 * point card above the transcript is the page's, not the session's, and `chat({ context })`
 * reaches only the tool's `execute`. One line, so the skill's "the conversation's own
 * point" means something.
 */
export const pointPrompt = (point: string) =>
  `This conversation was opened on the Needs-you point \`${point}\`. "it" in a question or a verdict means that point unless the user names another; \`bun run accio point ${point}\` is its record.`;

export type AuthMode = "host" | "api-key";

/** Decided per request from the environment, never cached: the container sets the key. */
export const authMode = (env: NodeJS.ProcessEnv = process.env): AuthMode =>
  env.ANTHROPIC_API_KEY?.trim() ? "api-key" : "host";

/** The `claudeCodeText` adapter with Ask's configuration. */
export function askAdapter(overrides: Partial<ClaudeCodeTextConfig> = {}) {
  return claudeCodeText(MODEL, { ...ADAPTER_CONFIG, ...overrides });
}

/**
 * One sandbox for the process, pinned to the checkout (no temp dir, never removed on
 * destroy). `fileEvents: false` — the default watcher would fs.watch the whole checkout.
 * `@tanstack/ai-sandbox` 0.5.6 declares a projection it only provides when a `workspace`
 * is defined; narrowing `provides` to the sandbox itself is enough (see LIA-100).
 */
const sandbox = defineSandbox({
  fileEvents: false,
  id: "ask",
  provider: localProcessSandbox({ dir: WORKSPACE_DIR }),
});
export const sandboxMiddleware: ChatMiddleware = {
  ...withSandbox(sandbox),
  provides: [SandboxCapability] as const,
};

// ── availability ───────────────────────────────────────────────────────────────

/** What `claude auth status` said: logged in or not, and how (`claude.ai`, `console`, …). */
export interface LoginVerdict {
  authMethod?: string;
  loggedIn: boolean;
}

/**
 * What the page and the run know about the credential. `claudePath` and `probe` are the
 * diagnosis inputs (LIA-104): a run that fails to authenticate names them, so the next
 * "not logged in" is diagnosable rather than retried. `probe.loggedIn` is `null` when the
 * probe could not tell, or was not consulted (`api-key` mode).
 */
export type AskStatus =
  | {
      available: true;
      authMode: AuthMode;
      claudePath: string | null;
      probe: { loggedIn: boolean | null; authMethod?: string };
    }
  | {
      available: false;
      reason: string;
      claudePath: string | null;
      probe: { loggedIn: boolean | null; authMethod?: string };
    };

/** What a host-login probe can say: a verdict, or `null` — cannot tell. */
export type LoginProbe = () => Promise<LoginVerdict | null>;

/**
 * `claude auth status` prints JSON with `loggedIn` and `authMethod`. Advisory only: a
 * missing binary, a timeout, or unparseable output is `null` — "cannot tell", treated as
 * available so the first run's own error is what the user sees.
 */
export const claudeLoginProbe: LoginProbe = () =>
  new Promise((done) => {
    execFile(
      "claude",
      ["auth", "status"],
      { env: process.env, timeout: 8000 },
      (err, stdout) => {
        if (err && !stdout) {
          return done(null);
        }
        try {
          const v = JSON.parse(String(stdout)) as {
            loggedIn?: unknown;
            authMethod?: unknown;
          };
          if (typeof v.loggedIn !== "boolean") {
            return done(null);
          }
          done({
            loggedIn: v.loggedIn,
            ...(typeof v.authMethod === "string" && v.authMethod
              ? { authMethod: v.authMethod }
              : {}),
          });
        } catch {
          done(null);
        }
      }
    );
  });

/**
 * Where the `claude` the run will spawn lives. The harness runs `claude` from PATH through
 * its node runner with Pensieve's own environment, so `command -v` in a shell with that
 * environment is the same lookup. Resolved once per process; `null` when not on PATH.
 */
let claudePathCache: Promise<string | null> | undefined;
export const claudePathProbe = (): Promise<string | null> => {
  claudePathCache ??= new Promise((done) => {
    execFile(
      "sh",
      ["-c", "command -v claude"],
      { env: process.env, timeout: 8000 },
      (err, stdout) => {
        const p = String(stdout ?? "").trim();
        done(!err && p ? p : null);
      }
    );
  });
  return claudePathCache;
};

let probeCache: { at: number; verdict: LoginVerdict | null } | undefined;
const PROBE_TTL_MS = 60_000;

export const NOT_LOGGED_IN =
  "not logged in — run `claude login` on this machine (if you are logged in, a macOS Keychain dialog may be waiting for the claude process: choose Always Allow), or set ANTHROPIC_API_KEY";

/** Is a credential available for a run? Cheap for the key; the host probe is cached a minute. */
export async function askStatus(
  opts: {
    env?: NodeJS.ProcessEnv;
    probe?: LoginProbe;
    claudePath?: string | null;
    now?: number;
  } = {}
): Promise<AskStatus> {
  const mode = authMode(opts.env ?? process.env);
  const claudePath =
    opts.claudePath === undefined ? await claudePathProbe() : opts.claudePath;
  if (mode === "api-key") {
    return {
      authMode: mode,
      available: true,
      claudePath,
      probe: { loggedIn: null },
    };
  }
  const now = opts.now ?? Date.now();
  let verdict: LoginVerdict | null;
  if (opts.probe || !probeCache || now - probeCache.at > PROBE_TTL_MS) {
    verdict = await (opts.probe ?? claudeLoginProbe)();
    if (!opts.probe) {
      probeCache = { at: now, verdict };
    }
  } else {
    ({ verdict } = probeCache);
  }
  const probe = verdict
    ? {
        loggedIn: verdict.loggedIn,
        ...(verdict.authMethod ? { authMethod: verdict.authMethod } : {}),
      }
    : { loggedIn: null };
  if (verdict?.loggedIn === false) {
    return { available: false, claudePath, probe, reason: NOT_LOGGED_IN };
  }
  return { authMode: mode, available: true, claudePath, probe };
}

/**
 * One line that makes an auth failure diagnosable from the page and from the conversation
 * file: which binary, which auth mode, what the login probe said. Two causes fit the
 * 2026-09-06 08:40 failure (same binary, host mode, worked on retry): a macOS Keychain
 * access prompt on the first credential read after a `claude` update, which a headless
 * subprocess cannot answer; or a transient in the CLI's own login check.
 */
export function diagnosisLine(
  status: AskStatus,
  mode: AuthMode = status.available ? status.authMode : "host"
): string {
  const said =
    status.probe.loggedIn === null
      ? "unreachable"
      : status.probe.loggedIn
        ? `loggedIn: true${status.probe.authMethod ? `, ${status.probe.authMethod}` : ""}`
        : "not logged in";
  return `Ask runs \`claude\` from \`${status.claudePath ?? "not on PATH"}\` as \`${mode}\`; \`claude auth status\` said \`${said}\`; on macOS a Keychain dialog may be waiting for the claude process — choose Always Allow.`;
}

/** An error message that is about the credential or the binary rather than the question. */
export const AUTH_ERROR_RE =
  /not logged in|log ?in|authenticat|keychain|api[ _-]?key|credential|401|403|spawn claude|ENOENT/i;

// ── persistence: one file per conversation ─────────────────────────────────────

/**
 * `<dir>/<id>.json`. The messages store keys by thread id; the metadata store keys by
 * (namespace, key) and Ask uses the thread id as the namespace, so both land in the same
 * file. Written whole, via a temp file in the same directory and a rename, so a reader
 * never sees half of one; read-modify-write is serialised per file in this process.
 */
export interface ConversationFile {
  createdAt: string;
  messages: ModelMessage[];
  metadata: Record<string, unknown>;
  threadId: string;
  updatedAt: string;
  version: 1;
}

/** Thread ids the API accepts: what `useChat` and `crypto.randomUUID()` produce, nothing path-like. */
export const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const isThreadId = (id: unknown): id is string =>
  typeof id === "string" && THREAD_ID_RE.test(id);

/** A store id as a file name: no separators, no dot-names, reversible. */
export const fileNameOf = (id: string) =>
  `${encodeURIComponent(id).replace(/^\.+/, (dots) => "%2E".repeat(dots.length))}.json`;
const idOfFileName = (name: string) =>
  decodeURIComponent(name.slice(0, -".json".length));

export interface ConversationSummary {
  threadId: string;
  /** The first user turn. */
  title: string;
  updatedAt: string;
}

export interface ConversationStore {
  dir: string;
  list: () => Promise<ConversationSummary[]>;
  persistence: AIPersistence<{
    messages: MessageStore;
    metadata: MetadataStore;
  }>;
  read: (threadId: string) => Promise<ConversationFile | null>;
  remove: (threadId: string) => Promise<void>;
}

const textOf = (content: ModelMessage["content"]): string =>
  content === null
    ? ""
    : typeof content === "string"
      ? content
      : content
          .map((p) =>
            p.type === "text" && typeof p.content === "string" ? p.content : ""
          )
          .join("");

/** The first user turn, whitespace collapsed — the list's title. Empty when there is none. */
export const titleOf = (messages: ModelMessage[]): string =>
  textOf(messages.find((m) => m.role === "user")?.content ?? null)
    .replace(/\s+/g, " ")
    .trim();

function parseFile(text: string): ConversationFile | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const f = v as Record<string, unknown>;
  if (typeof f.threadId !== "string" || !Array.isArray(f.messages)) {
    return null;
  }
  return {
    createdAt: typeof f.createdAt === "string" ? f.createdAt : "",
    messages: f.messages as ModelMessage[],
    metadata:
      f.metadata && typeof f.metadata === "object" && !Array.isArray(f.metadata)
        ? (f.metadata as Record<string, unknown>)
        : {},
    threadId: f.threadId,
    updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : "",
    version: 1,
  };
}

export function conversationStore(dir = CONVERSATIONS_DIR): ConversationStore {
  const pathOf = (id: string) => join(dir, fileNameOf(id));
  const chains = new Map<string, Promise<unknown>>();

  /** Run `fn` after every earlier operation on the same file has settled. */
  function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(
      id,
      next.catch(() => undefined)
    );
    void next.finally(() => {
      if (chains.get(id) === next) {
        chains.delete(id);
      }
    });
    return next;
  }

  async function readRaw(id: string): Promise<ConversationFile | null> {
    try {
      return parseFile(await readFile(pathOf(id), "utf8"));
    } catch {
      return null;
    }
  }

  async function writeAtomic(
    id: string,
    file: ConversationFile
  ): Promise<void> {
    const target = pathOf(id);
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(
      dirname(target),
      `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`
    );
    try {
      await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  /** Read, patch, write — under the per-file chain. */
  const update = (
    id: string,
    patch: (current: ConversationFile) => ConversationFile
  ) =>
    serial(id, async () => {
      const now = new Date().toISOString();
      const current = (await readRaw(id)) ?? {
        createdAt: now,
        messages: [],
        metadata: {},
        threadId: id,
        updatedAt: now,
        version: 1 as const,
      };
      await writeAtomic(id, { ...patch(current), updatedAt: now });
    });

  const messages = defineMessageStore({
    async loadThread(threadId) {
      return (await serial(threadId, () => readRaw(threadId)))?.messages ?? [];
    },
    // Full replace: `messages` is the whole authoritative transcript.
    saveThread: (threadId, list) =>
      update(threadId, (f) => ({ ...f, messages: [...list] })),
  });

  const metadata = defineMetadataStore({
    delete(namespace, key) {
      return serial(namespace, async () => {
        const f = await readRaw(namespace);
        if (!(f && Object.hasOwn(f.metadata, key))) {
          return;
        }
        const { [key]: _gone, ...rest } = f.metadata;
        await writeAtomic(namespace, {
          ...f,
          metadata: rest,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    async get(namespace, key) {
      const f = await serial(namespace, () => readRaw(namespace));
      return f && Object.hasOwn(f.metadata, key)
        ? (f.metadata[key] ?? null)
        : null;
    },
    set(namespace, key, value) {
      if (value === null || value === undefined) {
        throw new TypeError(
          `metadata.set(${namespace}, ${key}): value is nullish — use delete()`
        );
      }
      return update(namespace, (f) => ({
        ...f,
        metadata: { ...f.metadata, [key]: value },
      }));
    },
  });

  return {
    dir,
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const out: ConversationSummary[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || name.startsWith(".")) {
          continue;
        }
        const id = idOfFileName(name);
        const f = await serial(id, () => readRaw(id));
        if (!f) {
          continue;
        }
        const title = titleOf(f.messages);
        if (!title) {
          continue;
        }
        out.push({ threadId: f.threadId, title, updatedAt: f.updatedAt });
      }
      return out.sort((a, b) =>
        a.updatedAt < b.updatedAt
          ? 1
          : a.updatedAt > b.updatedAt
            ? -1
            : a.threadId.localeCompare(b.threadId)
      );
    },
    persistence: defineAIPersistence({ stores: { messages, metadata } }),
    read: (threadId) => serial(threadId, () => readRaw(threadId)),
    remove: (threadId) =>
      serial(threadId, async () => {
        await unlink(pathOf(threadId)).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") {
            throw e;
          }
        });
      }),
  };
}

/** The process's store — `<PENSIEVE_HOME>/conversations/`. */
export const askStore = conversationStore();
export const askPersistence = askStore.persistence;

/** Where a thread's Claude session id lives: `metadata[<threadId>].sessionId`. */
export const SESSION_KEY = "sessionId";

/**
 * The Needs-you point this conversation is about, when it was opened from one (LIA-109).
 * Written once, on the first run that names it, and never again: the conversation is about
 * the point it started on, whatever a later request claims.
 */
export const POINT_KEY = "point";

/**
 * Where a filed ticket lives: `metadata[<threadId>]["ticket:<toolCallId>"]`. One key per
 * proposal, which is what makes File idempotent per card (LIA-113 AC3): a second click, or
 * a click after a reload replayed the tool part, answers the issue the first press filed
 * rather than creating another.
 */
export const ticketKey = (toolCallId: string) => `ticket:${toolCallId}`;

/** What a press of File recorded: the issue Linear made, and when. */
export interface FiledTicket {
  at: string;
  id: string;
  identifier: string;
  url: string;
}

const asFiledTicket = (v: unknown): FiledTicket | undefined => {
  if (!v || typeof v !== "object") {
    return;
  }
  const t = v as Record<string, unknown>;
  return typeof t.identifier === "string" && typeof t.url === "string"
    ? {
        at: typeof t.at === "string" ? t.at : "",
        id: typeof t.id === "string" ? t.id : "",
        identifier: t.identifier,
        url: t.url,
      }
    : undefined;
};

export const readFiledTicket = async (
  store: ConversationStore,
  threadId: string,
  toolCallId: string
): Promise<FiledTicket | undefined> =>
  asFiledTicket(
    await store.persistence.stores.metadata.get(threadId, ticketKey(toolCallId))
  );

/**
 * Where an opened arc lives: `metadata[<threadId>]["arc:<toolCallId>"]`. One key per
 * proposal, as `ticket:` is — a second press of Open, or a press after a reload replayed
 * the card, answers the arc the first press opened rather than writing a second file
 * (LIA-147 AC2). The decision file on disk says the same thing; this is what the card
 * reads, since it is keyed by the card rather than by the slug.
 */
export const arcKey = (toolCallId: string) => `arc:${toolCallId}`;

/** What a press of Open recorded: the arc's slug and title, and when the file was written. */
export interface OpenedArc {
  at: string;
  slug: string;
  title: string;
}

const asOpenedArc = (v: unknown): OpenedArc | undefined => {
  if (!v || typeof v !== "object") {
    return;
  }
  const a = v as Record<string, unknown>;
  return typeof a.slug === "string" && a.slug
    ? {
        at: typeof a.at === "string" ? a.at : "",
        slug: a.slug,
        title: typeof a.title === "string" ? a.title : a.slug,
      }
    : undefined;
};

export const readOpenedArc = async (
  store: ConversationStore,
  threadId: string,
  toolCallId: string
): Promise<OpenedArc | undefined> =>
  asOpenedArc(
    await store.persistence.stores.metadata.get(threadId, arcKey(toolCallId))
  );

export const writeOpenedArc = (
  store: ConversationStore,
  threadId: string,
  toolCallId: string,
  arc: OpenedArc
): Promise<void> =>
  store.persistence.stores.metadata.set(threadId, arcKey(toolCallId), arc);

export const writeFiledTicket = (
  store: ConversationStore,
  threadId: string,
  toolCallId: string,
  ticket: FiledTicket
): Promise<void> =>
  store.persistence.stores.metadata.set(
    threadId,
    ticketKey(toolCallId),
    ticket
  );

export const readSessionId = async (
  store: ConversationStore,
  threadId: string
): Promise<string | undefined> => {
  const v = await store.persistence.stores.metadata.get(threadId, SESSION_KEY);
  return typeof v === "string" && v ? v : undefined;
};

// ── the run ────────────────────────────────────────────────────────────────────

export interface AskInput {
  /**
   * The full transcript (what `useChat` sends), or `[]` to continue the stored one as it
   * stands — TanStack's "send the full transcript, or none of it". A delta would replace
   * the stored thread, so never send one.
   */
  messages: UIMessage[];
  /** The point the conversation was opened on — stored on the first run, ignored after. */
  point?: string;
  runId?: string;
  threadId: string;
}

export interface AskRunOptions {
  abortController?: AbortController;
  adapter?: AnyTextAdapter;
  env?: NodeJS.ProcessEnv;
  /** Middleware ahead of persistence; the sandbox by default. Tests pass `[]` with a fake adapter. */
  middleware?: ChatMiddleware[];
  status?: () => Promise<AskStatus>;
  store?: ConversationStore;
}

/**
 * One run at a time per thread in this process. The client's `useChat` already queues
 * sends per hook; two tabs on one thread bypass that, so this is the belt and braces.
 */
const threadChains = new Map<string, Promise<void>>();

async function acquireThread(threadId: string): Promise<() => void> {
  const prev = threadChains.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => mine);
  threadChains.set(threadId, chained);
  await prev;
  return () => {
    release();
    if (threadChains.get(threadId) === chained) {
      threadChains.delete(threadId);
    }
  };
}

/**
 * The point a run is about. The stored one wins for the same reason `onStart` refuses to
 * overwrite it: the conversation is about the point it started on, whatever a later request
 * claims.
 */
export function pointOf(
  stored: unknown,
  asked: string | undefined
): string | undefined {
  if (isPointId(stored)) {
    return stored;
  }
  return isPointId(asked) ? asked : undefined;
}

const errorChunks = (
  threadId: string,
  runId: string,
  message: string,
  code: string
): StreamChunk[] => [
  { runId, threadId, timestamp: Date.now(), type: EventType.RUN_STARTED },
  {
    code,
    error: { code, message },
    message,
    runId,
    threadId,
    timestamp: Date.now(),
    type: EventType.RUN_ERROR,
  },
];

/** Where a run's end lands in the conversation file, beside `sessionId`. */
export const LAST_ERROR_KEY = "lastError";
export const FINISH_REASON_KEY = "finishReason";

export interface LastError {
  at: string;
  code?: string;
  message: string;
}

const errorMessageOf = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : JSON.stringify(e);
const errorCodeOf = (e: unknown): string | undefined =>
  e && typeof e === "object" && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;

/**
 * The harness's non-JSON stdout lines and the adapter's errors, per run. The adapter logs
 * them through TanStack's debug logger at the `provider` category and nowhere else, so a
 * logger that keeps them is the only way to see what the CLI printed before it died. With
 * `ASK_DEBUG=1` every category goes to the console instead.
 */
function harnessLog(): { debug: DebugOption; lines: string[] } {
  if (process.env.ASK_DEBUG === "1") {
    return { debug: true, lines: [] };
  }
  const lines: string[] = [];
  const NON_JSON = "provider=claude-code non-json line: ";
  const logger: Logger = {
    debug: (message) => {
      if (message.startsWith(NON_JSON)) {
        lines.push(message.slice(NON_JSON.length));
      }
    },
    error: (message, meta) => console.error(`[ask] ${message}`, meta ?? ""),
    info: () => undefined,
    warn: (message, meta) => console.warn(`[ask] ${message}`, meta ?? ""),
  };
  return {
    debug: {
      agentLoop: false,
      config: false,
      errors: true,
      logger,
      middleware: false,
      output: false,
      provider: true,
      request: false,
      sandbox: false,
      tools: false,
    },
    lines,
  };
}

/**
 * At `maxTurns` the claude CLI prints its result — the adapter emits RUN_FINISHED with
 * `finishReason: 'length'` — and then exits 1. The sandbox runner throws, the adapter
 * answers with a RUN_ERROR chunk, and the engine takes its error path: the assistant turn
 * is never assembled onto the transcript and persistence never writes it, so the file
 * keeps the streaming snapshot (text only, throttled) and the page shows nothing. The run
 * did finish. Whatever comes after the adapter's own finish — a RUN_ERROR chunk or a
 * throw — is logged and dropped here, before the engine sees it, so the run ends the way
 * a clean one does (LIA-104, AC8).
 */
export function finishedIsFinished<A extends AnyTextAdapter>(
  adapter: A,
  late: (what: unknown) => void
): A {
  const chatStream = async function* (options: Parameters<A["chatStream"]>[0]) {
    let finished = false;
    try {
      for await (const chunk of adapter.chatStream(options)) {
        if (chunk.type === EventType.RUN_FINISHED) {
          finished = true;
        } else if (finished && chunk.type === EventType.RUN_ERROR) {
          late(chunk.message);
          continue;
        }
        yield chunk;
      }
    } catch (e) {
      if (!finished) {
        throw e;
      }
      late(e instanceof Error ? e.message : e);
    }
  };
  return new Proxy(adapter, {
    get: (target, prop) =>
      prop === "chatStream" ? chatStream : Reflect.get(target, prop, target),
  });
}

/**
 * Run one Ask turn. Under the thread's lock: read the stored session id, run `chat()` with
 * the adapter, the sandbox and `withPersistence` (streaming snapshots on, so a page closed
 * mid-answer keeps the partial text), and record the session id the run reports.
 *
 * RUN_FINISHED is held back until the run's hooks have completed — the engine emits it
 * before persistence's finish hook writes the final transcript, and a client must be able
 * to reload on RUN_FINISHED and see the whole conversation.
 *
 * A run that ends in RUN_ERROR leaves `metadata.lastError` in the file; when the error is
 * about the credential its message gains the diagnosis line (`diagnosisLine`), on screen
 * and on disk. A run that ended at the turn cap leaves `metadata.finishReason: 'length'`
 * and, thanks to `finishedIsFinished`, its whole transcript (LIA-104).
 */
export async function* askStream(
  input: AskInput,
  opts: AskRunOptions = {}
): AsyncIterable<StreamChunk> {
  const store = opts.store ?? askStore;
  const runId = input.runId ?? `run_${randomBytes(8).toString("hex")}`;
  const status = await (opts.status ?? askStatus)();
  if (!status.available) {
    yield* errorChunks(
      input.threadId,
      runId,
      `${status.reason}\n${diagnosisLine(status)}`,
      "ASK_UNAVAILABLE"
    );
    return;
  }
  const mode = authMode(opts.env ?? process.env);
  const diagnosis = diagnosisLine(status, mode);
  const release = await acquireThread(input.threadId);
  try {
    const sessionId = await readSessionId(store, input.threadId);
    if (input.messages.length === 0) {
      const stored = await store.persistence.stores.messages.loadThread(
        input.threadId
      );
      if (stored.at(-1)?.role !== "user") {
        yield* errorChunks(
          input.threadId,
          runId,
          "nothing to continue — the stored conversation has no unanswered question; send the full transcript with the new one",
          "ASK_NOTHING_TO_CONTINUE"
        );
        return;
      }
    }
    const { metadata } = store.persistence.stores;
    const point = pointOf(
      await metadata.get(input.threadId, POINT_KEY),
      input.point
    );
    const harness = harnessLog();
    let lastError: LastError | undefined;
    const recordError = async (message: string, code: string | undefined) => {
      const full =
        AUTH_ERROR_RE.test(message) && !message.includes(diagnosis)
          ? `${message}\n${diagnosis}`
          : message;
      lastError = {
        message: full,
        ...(code ? { code } : {}),
        at: new Date().toISOString(),
      };
      await metadata.set(input.threadId, LAST_ERROR_KEY, lastError);
      if (harness.lines.length) {
        console.warn(
          `[ask] ${input.threadId}: the harness printed, before the error —\n${harness.lines.join("\n")}`
        );
      }
      return full;
    };
    const recorder = defineChatMiddleware({
      name: "ask-session",
      async onChunk(_ctx, chunk) {
        if (chunk.type === EventType.RUN_ERROR) {
          const message = await recordError(chunk.message, chunk.code);
          return message === chunk.message
            ? undefined
            : { ...chunk, error: { ...chunk.error, message }, message };
        }
        if (
          chunk.type !== EventType.CUSTOM ||
          chunk.name !== SESSION_ID_EVENT
        ) {
          return;
        }
        const id = (chunk.value as { sessionId?: unknown } | undefined)
          ?.sessionId;
        if (typeof id === "string" && id) {
          await metadata.set(input.threadId, SESSION_KEY, id);
        }
      },
      // A throw the engine caught (the adapter's RUN_ERROR chunk is the other way in).
      async onError(_ctx, info) {
        if (!lastError) {
          await recordError(
            errorMessageOf(info.error),
            errorCodeOf(info.error)
          );
        }
      },
      async onFinish(_ctx, info) {
        if (info.finishReason === "length") {
          await metadata.set(input.threadId, FINISH_REASON_KEY, "length");
        }
      },
      // A new run starts clean: what the last one left is superseded by this one's end.
      // The point is the exception — it is the thread's own, written once and kept.
      async onStart() {
        await metadata.delete(input.threadId, LAST_ERROR_KEY);
        await metadata.delete(input.threadId, FINISH_REASON_KEY);
        if (
          isPointId(input.point) &&
          (await metadata.get(input.threadId, POINT_KEY)) === null
        ) {
          await metadata.set(input.threadId, POINT_KEY, input.point);
        }
      },
    });
    const middleware: ChatMiddleware[] = [
      ...(opts.middleware ?? [sandboxMiddleware]),
      withPersistence(store.persistence, { snapshotStreaming: true }),
      recorder,
    ];
    const late = (what: unknown) =>
      console.warn(
        `[ask] ${input.threadId}: the run finished, then the agent process failed —`,
        what
      );
    const stream = chat({
      abortController: opts.abortController,
      adapter: finishedIsFinished(opts.adapter ?? askAdapter(), late),
      // Each tool's `execute` runs here, in this process, through the adapter's MCP bridge —
      // which is provisioned only because `tools` below is non-empty (LIA-111).
      context: { threadId: input.threadId, ...(point ? { point } : {}) },
      debug: harness.debug,
      messages: convertMessagesToModelMessages(input.messages),
      middleware,
      modelOptions: { authMode: mode, ...(sessionId ? { sessionId } : {}) },
      runId,
      systemPrompts: [
        ASK_SYSTEM_PROMPT,
        ...(point ? [pointPrompt(point)] : []),
      ],
      threadId: input.threadId,
      tools: [proposeDecisionTool, proposeTicketTool, proposeArcTool],
    });
    let finished: StreamChunk | undefined;
    for await (const chunk of stream) {
      if (chunk.type === EventType.RUN_FINISHED) {
        finished = chunk;
        continue;
      }
      yield chunk;
    }
    if (finished) {
      yield finished;
    }
  } finally {
    release();
  }
}

// ── reads for the pages ────────────────────────────────────────────────────────

export interface Conversation {
  createdAt: string;
  /** `'length'` when the last run stopped at the turn cap — the page says so under the answer. */
  finishReason?: "length";
  /** How the last run ended, when it ended in error; cleared when the next run starts. */
  lastError?: LastError;
  messages: UIMessage[];
  /** The Needs-you point this conversation was opened on, when it was (LIA-109). */
  point?: string;
  sessionId?: string;
  threadId: string;
  updatedAt: string;
}

const lastErrorOf = (v: unknown): LastError | undefined => {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const e = v as Record<string, unknown>;
  if (typeof e.message !== "string") {
    return undefined;
  }
  return {
    message: e.message,
    ...(typeof e.code === "string" ? { code: e.code } : {}),
    at: typeof e.at === "string" ? e.at : "",
  };
};

export async function getConversation(
  threadId: string,
  store = askStore
): Promise<Conversation | null> {
  const f = await store.read(threadId);
  if (!f) {
    return null;
  }
  const sessionId = f.metadata[SESSION_KEY];
  const lastError = lastErrorOf(f.metadata[LAST_ERROR_KEY]);
  const point = f.metadata[POINT_KEY];
  return {
    messages: modelMessagesToUIMessages(f.messages),
    threadId: f.threadId,
    ...(isPointId(point) ? { point } : {}),
    ...(typeof sessionId === "string" && sessionId ? { sessionId } : {}),
    ...(f.metadata[FINISH_REASON_KEY] === "length"
      ? { finishReason: "length" as const }
      : {}),
    ...(lastError ? { lastError } : {}),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

export const listConversations = (store = askStore) => store.list();

/** Remove that one file; answer the remaining list. */
export async function deleteConversation(
  threadId: string,
  store = askStore
): Promise<ConversationSummary[]> {
  await store.remove(threadId);
  return store.list();
}
