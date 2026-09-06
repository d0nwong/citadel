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
 * Auth is decided per request: `ANTHROPIC_API_KEY` in the environment means `'api-key'`
 * (the container); otherwise `'host'` — the machine's `claude login`. With neither,
 * `askStatus()` says so and `askStream()` answers a RUN_ERROR chunk instead of spawning.
 */
import { homedir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chat, convertMessagesToModelMessages, defineChatMiddleware, EventType, modelMessagesToUIMessages } from '@tanstack/ai'
import type { ChatMiddleware, ModelMessage, StreamChunk, UIMessage } from '@tanstack/ai'
import type { AnyTextAdapter } from '@tanstack/ai'
import { claudeCodeText, SESSION_ID_EVENT } from '@tanstack/ai-claude-code'
import type { ClaudeCodeTextConfig } from '@tanstack/ai-claude-code'
import { defineAIPersistence, defineMessageStore, defineMetadataStore, withPersistence } from '@tanstack/ai-persistence'
import type { AIPersistence, MessageStore, MetadataStore } from '@tanstack/ai-persistence'
import { SandboxCapability, defineSandbox, withSandbox } from '@tanstack/ai-sandbox'
import { localProcessSandbox } from '@tanstack/ai-sandbox-local-process'
import { WORKSPACE_DIR } from './workspace'

// ── configuration ──────────────────────────────────────────────────────────────

/** Ask's own state directory — the only place this feature writes. */
export const PENSIEVE_HOME = resolve(process.env.PENSIEVE_HOME || join(homedir(), '.pensieve'))
export const CONVERSATIONS_DIR = join(PENSIEVE_HOME, 'conversations')

/** The claude binary's own model alias; the CLI resolves it. */
export const MODEL = 'sonnet'

/** Exactly the read-only set: files, search, and git history. Nothing that writes or runs. */
export const ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)'] as const

/**
 * The adapter configuration (`docs/adapters/claude-code.md`). `cwd` is the sandbox's
 * virtual root, which the local-process provider maps onto the argus checkout.
 * `settingSources` stays at `['project']`: argus symlinks its skills into its own
 * `.claude/skills`, and the spike (LIA-100) saw them all reported that way — the host's
 * `~/.claude` stays out of the run.
 */
export const ADAPTER_CONFIG = {
  cwd: '/workspace',
  permissionMode: 'default',
  allowedTools: [...ALLOWED_TOOLS],
  // Belt and braces under `default`: these never even reach the permission check.
  disallowedTools: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
  settingSources: ['project'],
  maxTurns: 12,
  emitDiff: false,
} satisfies ClaudeCodeTextConfig

export type AuthMode = 'host' | 'api-key'

/** Decided per request from the environment, never cached: the container sets the key. */
export const authMode = (env: NodeJS.ProcessEnv = process.env): AuthMode => (env.ANTHROPIC_API_KEY?.trim() ? 'api-key' : 'host')

/** The `claudeCodeText` adapter with Ask's configuration. */
export function askAdapter(overrides: Partial<ClaudeCodeTextConfig> = {}) {
  return claudeCodeText(MODEL, { ...ADAPTER_CONFIG, ...overrides })
}

/**
 * One sandbox for the process, pinned to the checkout (no temp dir, never removed on
 * destroy). `fileEvents: false` — the default watcher would fs.watch the whole checkout.
 * `@tanstack/ai-sandbox` 0.5.6 declares a projection it only provides when a `workspace`
 * is defined; narrowing `provides` to the sandbox itself is enough (see LIA-100).
 */
const sandbox = defineSandbox({
  id: 'ask',
  provider: localProcessSandbox({ dir: WORKSPACE_DIR }),
  fileEvents: false,
})
export const sandboxMiddleware: ChatMiddleware = { ...withSandbox(sandbox), provides: [SandboxCapability] as const }

// ── availability ───────────────────────────────────────────────────────────────

export type AskStatus = { available: true; authMode: AuthMode } | { available: false; reason: string }

/** What a host-login probe can say: logged in, not logged in, or cannot tell. */
export type LoginProbe = () => Promise<boolean | null>

/**
 * `claude auth status` prints JSON with `loggedIn`. Advisory only: a missing binary, a
 * timeout, or unparseable output is `null` — "cannot tell", treated as available so the
 * first run's own error is what the user sees.
 */
export const claudeLoginProbe: LoginProbe = () =>
  new Promise((done) => {
    execFile('claude', ['auth', 'status'], { timeout: 8_000, env: process.env }, (err, stdout) => {
      if (err && !stdout) return done(null)
      try {
        const v = JSON.parse(String(stdout)) as { loggedIn?: unknown }
        done(typeof v.loggedIn === 'boolean' ? v.loggedIn : null)
      } catch {
        done(null)
      }
    })
  })

let probeCache: { at: number; loggedIn: boolean | null } | undefined
const PROBE_TTL_MS = 60_000

/** Is a credential available for a run? Cheap for the key; the host probe is cached a minute. */
export async function askStatus(opts: { env?: NodeJS.ProcessEnv; probe?: LoginProbe; now?: number } = {}): Promise<AskStatus> {
  const mode = authMode(opts.env ?? process.env)
  if (mode === 'api-key') return { available: true, authMode: mode }
  const now = opts.now ?? Date.now()
  if (opts.probe || !probeCache || now - probeCache.at > PROBE_TTL_MS) {
    const loggedIn = await (opts.probe ?? claudeLoginProbe)()
    if (!opts.probe) probeCache = { at: now, loggedIn }
    if (loggedIn === false) return { available: false, reason: 'not logged in — run `claude login` on this machine, or set ANTHROPIC_API_KEY' }
    return { available: true, authMode: mode }
  }
  if (probeCache.loggedIn === false) return { available: false, reason: 'not logged in — run `claude login` on this machine, or set ANTHROPIC_API_KEY' }
  return { available: true, authMode: mode }
}

// ── persistence: one file per conversation ─────────────────────────────────────

/**
 * `<dir>/<id>.json`. The messages store keys by thread id; the metadata store keys by
 * (namespace, key) and Ask uses the thread id as the namespace, so both land in the same
 * file. Written whole, via a temp file in the same directory and a rename, so a reader
 * never sees half of one; read-modify-write is serialised per file in this process.
 */
export interface ConversationFile {
  version: 1
  threadId: string
  messages: Array<ModelMessage>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Thread ids the API accepts: what `useChat` and `crypto.randomUUID()` produce, nothing path-like. */
export const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const isThreadId = (id: unknown): id is string => typeof id === 'string' && THREAD_ID_RE.test(id)

/** A store id as a file name: no separators, no dot-names, reversible. */
export const fileNameOf = (id: string) => `${encodeURIComponent(id).replace(/^\.+/, (dots) => '%2E'.repeat(dots.length))}.json`
const idOfFileName = (name: string) => decodeURIComponent(name.slice(0, -'.json'.length))

export interface ConversationSummary {
  threadId: string
  /** The first user turn. */
  title: string
  updatedAt: string
}

export interface ConversationStore {
  dir: string
  persistence: AIPersistence<{ messages: MessageStore; metadata: MetadataStore }>
  read: (threadId: string) => Promise<ConversationFile | null>
  list: () => Promise<Array<ConversationSummary>>
  remove: (threadId: string) => Promise<void>
}

const textOf = (content: ModelMessage['content']): string =>
  content === null
    ? ''
    : typeof content === 'string'
      ? content
      : content.map((p) => (p.type === 'text' && typeof p.content === 'string' ? p.content : '')).join('')

/** The first user turn, whitespace collapsed — the list's title. Empty when there is none. */
export const titleOf = (messages: Array<ModelMessage>): string =>
  textOf(messages.find((m) => m.role === 'user')?.content ?? null)
    .replace(/\s+/g, ' ')
    .trim()

function parseFile(text: string): ConversationFile | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const f = v as Record<string, unknown>
  if (typeof f.threadId !== 'string' || !Array.isArray(f.messages)) return null
  return {
    version: 1,
    threadId: f.threadId,
    messages: f.messages as Array<ModelMessage>,
    metadata: f.metadata && typeof f.metadata === 'object' && !Array.isArray(f.metadata) ? (f.metadata as Record<string, unknown>) : {},
    createdAt: typeof f.createdAt === 'string' ? f.createdAt : '',
    updatedAt: typeof f.updatedAt === 'string' ? f.updatedAt : '',
  }
}

export function conversationStore(dir = CONVERSATIONS_DIR): ConversationStore {
  const pathOf = (id: string) => join(dir, fileNameOf(id))
  const chains = new Map<string, Promise<unknown>>()

  /** Run `fn` after every earlier operation on the same file has settled. */
  function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(id) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    chains.set(
      id,
      next.catch(() => undefined),
    )
    void next.finally(() => {
      if (chains.get(id) === next) chains.delete(id)
    })
    return next
  }

  async function readRaw(id: string): Promise<ConversationFile | null> {
    try {
      return parseFile(await readFile(pathOf(id), 'utf8'))
    } catch {
      return null
    }
  }

  async function writeAtomic(id: string, file: ConversationFile): Promise<void> {
    const target = pathOf(id)
    await mkdir(dirname(target), { recursive: true })
    const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      await writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8')
      await rename(tmp, target)
    } catch (e) {
      await unlink(tmp).catch(() => undefined)
      throw e
    }
  }

  /** Read, patch, write — under the per-file chain. */
  const update = (id: string, patch: (current: ConversationFile) => ConversationFile) =>
    serial(id, async () => {
      const now = new Date().toISOString()
      const current = (await readRaw(id)) ?? { version: 1 as const, threadId: id, messages: [], metadata: {}, createdAt: now, updatedAt: now }
      await writeAtomic(id, { ...patch(current), updatedAt: now })
    })

  const messages = defineMessageStore({
    async loadThread(threadId) {
      return (await serial(threadId, () => readRaw(threadId)))?.messages ?? []
    },
    // Full replace: `messages` is the whole authoritative transcript.
    saveThread: (threadId, list) => update(threadId, (f) => ({ ...f, messages: [...list] })),
  })

  const metadata = defineMetadataStore({
    async get(namespace, key) {
      const f = await serial(namespace, () => readRaw(namespace))
      return f && Object.prototype.hasOwnProperty.call(f.metadata, key) ? (f.metadata[key] ?? null) : null
    },
    set(namespace, key, value) {
      if (value === null || value === undefined) throw new TypeError(`metadata.set(${namespace}, ${key}): value is nullish — use delete()`)
      return update(namespace, (f) => ({ ...f, metadata: { ...f.metadata, [key]: value } }))
    },
    delete(namespace, key) {
      return serial(namespace, async () => {
        const f = await readRaw(namespace)
        if (!f || !Object.prototype.hasOwnProperty.call(f.metadata, key)) return
        const { [key]: _gone, ...rest } = f.metadata
        await writeAtomic(namespace, { ...f, metadata: rest, updatedAt: new Date().toISOString() })
      })
    },
  })

  return {
    dir,
    persistence: defineAIPersistence({ stores: { messages, metadata } }),
    read: (threadId) => serial(threadId, () => readRaw(threadId)),
    async list() {
      let names: Array<string>
      try {
        names = await readdir(dir)
      } catch {
        return []
      }
      const out: Array<ConversationSummary> = []
      for (const name of names) {
        if (!name.endsWith('.json') || name.startsWith('.')) continue
        const id = idOfFileName(name)
        const f = await serial(id, () => readRaw(id))
        if (!f) continue
        const title = titleOf(f.messages)
        if (!title) continue
        out.push({ threadId: f.threadId, title, updatedAt: f.updatedAt })
      }
      return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.threadId.localeCompare(b.threadId)))
    },
    remove: (threadId) =>
      serial(threadId, async () => {
        await unlink(pathOf(threadId)).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e
        })
      }),
  }
}

/** The process's store — `<PENSIEVE_HOME>/conversations/`. */
export const askStore = conversationStore()
export const askPersistence = askStore.persistence

/** Where a thread's Claude session id lives: `metadata[<threadId>].sessionId`. */
export const SESSION_KEY = 'sessionId'

export const readSessionId = async (store: ConversationStore, threadId: string): Promise<string | undefined> => {
  const v = await store.persistence.stores.metadata.get(threadId, SESSION_KEY)
  return typeof v === 'string' && v ? v : undefined
}

// ── the run ────────────────────────────────────────────────────────────────────

export interface AskInput {
  threadId: string
  /**
   * The full transcript (what `useChat` sends), or `[]` to continue the stored one as it
   * stands — TanStack's "send the full transcript, or none of it". A delta would replace
   * the stored thread, so never send one.
   */
  messages: Array<UIMessage>
  runId?: string
}

export interface AskRunOptions {
  adapter?: AnyTextAdapter
  /** Middleware ahead of persistence; the sandbox by default. Tests pass `[]` with a fake adapter. */
  middleware?: Array<ChatMiddleware>
  store?: ConversationStore
  status?: () => Promise<AskStatus>
  abortController?: AbortController
  env?: NodeJS.ProcessEnv
}

/**
 * One run at a time per thread in this process. The client's `useChat` already queues
 * sends per hook; two tabs on one thread bypass that, so this is the belt and braces.
 */
const threadChains = new Map<string, Promise<void>>()

async function acquireThread(threadId: string): Promise<() => void> {
  const prev = threadChains.get(threadId) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((r) => (release = r))
  const chained = prev.then(() => mine)
  threadChains.set(threadId, chained)
  await prev
  return () => {
    release()
    if (threadChains.get(threadId) === chained) threadChains.delete(threadId)
  }
}

const errorChunks = (threadId: string, runId: string, message: string, code: string): Array<StreamChunk> => [
  { type: EventType.RUN_STARTED, threadId, runId, timestamp: Date.now() },
  { type: EventType.RUN_ERROR, threadId, runId, timestamp: Date.now(), message, code, error: { message, code } },
]

/**
 * Run one Ask turn. Under the thread's lock: read the stored session id, run `chat()` with
 * the adapter, the sandbox and `withPersistence` (streaming snapshots on, so a page closed
 * mid-answer keeps the partial text), and record the session id the run reports.
 *
 * RUN_FINISHED is held back until the run's hooks have completed — the engine emits it
 * before persistence's finish hook writes the final transcript, and a client must be able
 * to reload on RUN_FINISHED and see the whole conversation.
 */
export async function* askStream(input: AskInput, opts: AskRunOptions = {}): AsyncIterable<StreamChunk> {
  const store = opts.store ?? askStore
  const runId = input.runId ?? `run_${randomBytes(8).toString('hex')}`
  const status = await (opts.status ?? askStatus)()
  if (!status.available) {
    yield* errorChunks(input.threadId, runId, status.reason, 'ASK_UNAVAILABLE')
    return
  }
  const release = await acquireThread(input.threadId)
  try {
    const sessionId = await readSessionId(store, input.threadId)
    if (input.messages.length === 0) {
      const stored = await store.persistence.stores.messages.loadThread(input.threadId)
      if (stored.at(-1)?.role !== 'user') {
        yield* errorChunks(input.threadId, runId, 'nothing to continue — the stored conversation has no unanswered question; send the full transcript with the new one', 'ASK_NOTHING_TO_CONTINUE')
        return
      }
    }
    const recorder = defineChatMiddleware({
      name: 'ask-session',
      async onChunk(_ctx, chunk) {
        if (chunk.type !== EventType.CUSTOM || chunk.name !== SESSION_ID_EVENT) return
        const id = (chunk.value as { sessionId?: unknown } | undefined)?.sessionId
        if (typeof id === 'string' && id) await store.persistence.stores.metadata.set(input.threadId, SESSION_KEY, id)
      },
    })
    const middleware: Array<ChatMiddleware> = [...(opts.middleware ?? [sandboxMiddleware]), withPersistence(store.persistence, { snapshotStreaming: true }), recorder]
    const stream = chat({
      adapter: opts.adapter ?? askAdapter(),
      messages: convertMessagesToModelMessages(input.messages),
      threadId: input.threadId,
      runId,
      modelOptions: { authMode: authMode(opts.env ?? process.env), ...(sessionId ? { sessionId } : {}) },
      middleware,
      abortController: opts.abortController,
    })
    let finished: StreamChunk | undefined
    for await (const chunk of stream) {
      if (chunk.type === EventType.RUN_FINISHED) {
        finished = chunk
        continue
      }
      yield chunk
    }
    if (finished) yield finished
  } finally {
    release()
  }
}

// ── reads for the pages ────────────────────────────────────────────────────────

export interface Conversation {
  threadId: string
  messages: Array<UIMessage>
  sessionId?: string
  createdAt: string
  updatedAt: string
}

export async function getConversation(threadId: string, store = askStore): Promise<Conversation | null> {
  const f = await store.read(threadId)
  if (!f) return null
  const sessionId = f.metadata[SESSION_KEY]
  return {
    threadId: f.threadId,
    messages: modelMessagesToUIMessages(f.messages),
    ...(typeof sessionId === 'string' && sessionId ? { sessionId } : {}),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }
}

export const listConversations = (store = askStore) => store.list()

/** Remove that one file; answer the remaining list. */
export async function deleteConversation(threadId: string, store = askStore): Promise<Array<ConversationSummary>> {
  await store.remove(threadId)
  return store.list()
}
