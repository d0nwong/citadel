import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import { EventType } from '@tanstack/ai'
import type { AdapterYieldChunk, DefaultMessageMetadataByModality, ModelMessage, StreamChunk, TextOptions, UIMessage } from '@tanstack/ai'
import { BaseTextAdapter } from '@tanstack/ai/adapters'
import type { StructuredOutputResult } from '@tanstack/ai/adapters'
import type { AskStatus, ConversationFile } from './ask'
import { WORKSPACE_DIR } from './workspace'
import { SESSION_ID_EVENT } from '@tanstack/ai-claude-code'
import type { ClaudeCodeTextProviderOptions } from '@tanstack/ai-claude-code'

// Ask's default store lives under PENSIEVE_HOME; point it at a scratch dir before the module loads.
const HOME = await mkdtemp(join(tmpdir(), 'pensieve-home-'))
process.env.PENSIEVE_HOME = HOME
const ask = await import('./ask')
const { conversationStore, askStream, askStatus, authMode, ADAPTER_CONFIG, titleOf, getConversation, listConversations, deleteConversation, fileNameOf } = ask

afterAll(() => rm(HOME, { recursive: true, force: true }))

const scratch = () => mkdtemp(join(tmpdir(), 'pensieve-conv-'))
const user = (text: string, id = `u_${Math.random().toString(36).slice(2)}`): UIMessage => ({ id, role: 'user', parts: [{ type: 'text', content: text }] })
const readJson = async (dir: string, threadId: string) => JSON.parse(await readFile(join(dir, fileNameOf(threadId)), 'utf8')) as ConversationFile
const collect = async (stream: AsyncIterable<StreamChunk>, onChunk?: (c: StreamChunk) => Promise<void> | void) => {
  const out: Array<StreamChunk> = []
  for await (const c of stream) {
    out.push(c)
    await onChunk?.(c)
  }
  return out
}
const available = async (): Promise<AskStatus> => ({ available: true, authMode: 'host' })

/**
 * Stands in for `claudeCodeText`: emits the session-id event the way the real adapter
 * does (echoing a resumed id, minting one otherwise), then one text reply. Records what
 * `chat()` handed it so the tests can see the transcript and `modelOptions` it got.
 */
class FakeClaude extends BaseTextAdapter<'fake', ClaudeCodeTextProviderOptions, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'fake'
  calls: Array<{ messages: Array<ModelMessage>; modelOptions: ClaudeCodeTextProviderOptions | undefined; at: number }> = []
  constructor(private readonly cfg: { sessionId: string; reply?: string; onCall?: () => Promise<void>; delayMs?: number }) {
    super({}, 'fake')
  }
  async *chatStream(options: TextOptions<ClaudeCodeTextProviderOptions>): AsyncIterable<AdapterYieldChunk> {
    this.calls.push({ messages: [...options.messages], modelOptions: options.modelOptions, at: Date.now() })
    await this.cfg.onCall?.()
    const model = 'fake'
    const threadId = options.threadId ?? 't'
    const runId = options.runId ?? 'r'
    const now = () => Date.now()
    yield {
      type: EventType.CUSTOM,
      threadId,
      runId,
      model,
      timestamp: now(),
      name: SESSION_ID_EVENT,
      value: { sessionId: options.modelOptions?.sessionId ?? this.cfg.sessionId, skills: ['sweep', 'slack-digest'] },
    }
    yield { type: EventType.RUN_STARTED, threadId, runId, model, timestamp: now() }
    if (this.cfg.delayMs) await new Promise((r) => setTimeout(r, this.cfg.delayMs))
    const messageId = this.generateId()
    yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', model, timestamp: now() }
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: this.cfg.reply ?? 'answer', model, timestamp: now() }
    yield { type: EventType.TEXT_MESSAGE_END, messageId, model, timestamp: now() }
    yield { type: EventType.RUN_FINISHED, threadId, runId, model, timestamp: now(), finishReason: 'stop' }
  }
  structuredOutput(): Promise<StructuredOutputResult<unknown>> {
    return Promise.reject(new Error('not supported'))
  }
}

// ── AC3: the store passes the shared conformance suite ─────────────────────────

runPersistenceConformance('pensieve file store', async () => conversationStore(await scratch()).persistence, {
  skip: ['runs', 'interrupts', 'generationRuns', 'artifacts', 'blobs'],
})

describe('file store — beyond the suite', () => {
  test('ids become safe file names and round-trip through list()', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    await store.persistence.stores.messages.saveThread('..', [{ role: 'user', content: 'dots' }])
    await store.persistence.stores.messages.saveThread('a/b c', [{ role: 'user', content: 'slash' }])
    const names = (await readdir(dir)).sort()
    expect(names).toEqual(['%2E%2E.json', 'a%2Fb%20c.json'])
    expect((await store.list()).map((c) => c.threadId).sort()).toEqual(['..', 'a/b c'])
  })

  test('writes are whole files: no temp file survives, and a torn read never happens', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.persistence.stores.messages.saveThread('t', [{ role: 'user', content: `v${i}` }])))
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.persistence.stores.metadata.set('t', `k${i}`, i)))
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([])
    const f = await readJson(dir, 't')
    expect(f.messages).toEqual([{ role: 'user', content: 'v19' }])
    expect(Object.keys(f.metadata)).toHaveLength(20)
  })
})

// ── AC1 + AC2: a run persists, and the next one resumes the session ────────────

describe('AC1 — a run writes the user turn on start and the full transcript before RUN_FINISHED', () => {
  test('new thread', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    let atStart: ConversationFile | undefined
    const adapter = new FakeClaude({
      sessionId: 'sess-1',
      reply: 'hello there',
      onCall: async () => {
        atStart = await readJson(dir, 'th1')
      },
    })
    let atFinish: ConversationFile | undefined
    const chunks = await collect(askStream({ threadId: 'th1', messages: [user('hi')] }, { adapter, middleware: [], store, status: available }), async (c) => {
      if (c.type === EventType.RUN_FINISHED) atFinish = await readJson(dir, 'th1')
    })
    // On run start: the user turn only.
    expect(atStart?.messages).toMatchObject([{ role: 'user', content: 'hi' }])
    // At RUN_FINISHED: the whole transcript and the session id, before the chunk went out.
    expect(atFinish?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(atFinish?.messages[1]?.content).toBe('hello there')
    expect(atFinish?.metadata.sessionId).toBe('sess-1')
    expect(chunks.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    expect(chunks.some((c) => c.type === EventType.RUN_ERROR)).toBe(false)
  })
})

describe('AC2 — the second run on a thread resumes the stored session', () => {
  test('full transcript resent: sessionId comes from the store, not the client', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    const adapter = new FakeClaude({ sessionId: 'sess-A' })
    const u1 = user('first')
    await collect(askStream({ threadId: 'th2', messages: [u1] }, { adapter, middleware: [], store, status: available }))
    const stored = await getConversation('th2', store)
    expect(stored?.sessionId).toBe('sess-A')

    const chunks = await collect(askStream({ threadId: 'th2', messages: [...(stored?.messages ?? []), user('second')] }, { adapter, middleware: [], store, status: available }))
    expect(adapter.calls).toHaveLength(2)
    expect(adapter.calls[1].modelOptions?.sessionId).toBe('sess-A')
    expect(adapter.calls[1].messages.at(-1)).toMatchObject({ role: 'user', content: 'second' })
    const evt = chunks.find((c) => c.type === EventType.CUSTOM && c.name === SESSION_ID_EVENT)
    expect((evt as { value?: { sessionId?: string } } | undefined)?.value?.sessionId).toBe('sess-A')
    expect((await readJson(dir, 'th2')).messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  test('empty messages: continues the stored transcript as it stands', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    await store.persistence.stores.messages.saveThread('th3', [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2 (unanswered)' }])
    await store.persistence.stores.metadata.set('th3', 'sessionId', 'sess-B')
    const adapter = new FakeClaude({ sessionId: 'never-used' })
    const chunks = await collect(askStream({ threadId: 'th3', messages: [] }, { adapter, middleware: [], store, status: available }))
    expect(adapter.calls[0].messages).toEqual([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2 (unanswered)' }])
    expect(adapter.calls[0].modelOptions?.sessionId).toBe('sess-B')
    expect(chunks.at(-1)?.type).toBe(EventType.RUN_FINISHED)
    expect((await readJson(dir, 'th3')).messages).toHaveLength(4)
  })

  test('empty messages with nothing unanswered is an error chunk, not a spawn', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    await store.persistence.stores.messages.saveThread('th4', [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }])
    const adapter = new FakeClaude({ sessionId: 'x' })
    const chunks = await collect(askStream({ threadId: 'th4', messages: [] }, { adapter, middleware: [], store, status: available }))
    expect(adapter.calls).toHaveLength(0)
    expect(chunks.map((c) => c.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR])
    expect((chunks[1] as { code?: string }).code).toBe('ASK_NOTHING_TO_CONTINUE')
  })

  test('one run at a time per thread: a second send waits for the first to finish', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    const adapter = new FakeClaude({ sessionId: 's', delayMs: 120 })
    const finishedAt: Array<number> = []
    const run = (text: string) =>
      collect(askStream({ threadId: 'th5', messages: [user(text)] }, { adapter, middleware: [], store, status: available }), (c) => {
        if (c.type === EventType.RUN_FINISHED) finishedAt.push(Date.now())
      })
    await Promise.all([run('one'), run('two')])
    expect(adapter.calls).toHaveLength(2)
    expect(adapter.calls[1].at).toBeGreaterThanOrEqual(finishedAt[0])
  })
})

// ── AC4 / AC6: configuration and availability ──────────────────────────────────

describe('AC4 — read-only tool set', () => {
  test('allowedTools is exactly the list; permissionMode is default', () => {
    expect(ADAPTER_CONFIG.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)'])
    expect(ADAPTER_CONFIG.permissionMode).toBe('default')
    expect(ADAPTER_CONFIG.disallowedTools).toContain('Write')
    expect(ADAPTER_CONFIG.disallowedTools).toContain('Edit')
  })
})

describe('AC6 — auth mode and availability', () => {
  test('ANTHROPIC_API_KEY decides api-key; otherwise host', () => {
    expect(authMode({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBe('api-key')
    expect(authMode({ ANTHROPIC_API_KEY: '  ' })).toBe('host')
    expect(authMode({})).toBe('host')
  })
  test('askStatus: key → available; host probe false → reason; probe cannot tell → available', async () => {
    expect(await askStatus({ env: { ANTHROPIC_API_KEY: 'k' } })).toEqual({ available: true, authMode: 'api-key' })
    const off = await askStatus({ env: {}, probe: async () => false })
    expect(off.available).toBe(false)
    expect(off.available === false && off.reason).toMatch(/claude login|ANTHROPIC_API_KEY/)
    expect(await askStatus({ env: {}, probe: async () => null })).toEqual({ available: true, authMode: 'host' })
    expect(await askStatus({ env: {}, probe: async () => true })).toEqual({ available: true, authMode: 'host' })
  })
  test('unavailable: a 503-style error chunk, nothing spawned, nothing written', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    const adapter = new FakeClaude({ sessionId: 'x' })
    const chunks = await collect(askStream({ threadId: 'th6', messages: [user('hi')] }, { adapter, middleware: [], store, status: async () => ({ available: false, reason: 'no credential' }) }))
    expect(adapter.calls).toHaveLength(0)
    expect(chunks.map((c) => c.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR])
    expect(chunks[1]).toMatchObject({ code: 'ASK_UNAVAILABLE', message: 'no credential' })
    expect(await store.read('th6')).toBeNull()
  })
  test('the run passes authMode through modelOptions', async () => {
    const store = conversationStore(await scratch())
    const adapter = new FakeClaude({ sessionId: 'x' })
    await collect(askStream({ threadId: 'th7', messages: [user('hi')] }, { adapter, middleware: [], store, status: available, env: { ANTHROPIC_API_KEY: 'k' } }))
    await collect(askStream({ threadId: 'th8', messages: [user('hi')] }, { adapter, middleware: [], store, status: available, env: {} }))
    expect(adapter.calls[0].modelOptions?.authMode).toBe('api-key')
    expect(adapter.calls[1].modelOptions?.authMode).toBe('host')
  })
})

// ── AC7: the list and delete ───────────────────────────────────────────────────

describe('AC7 — listConversations and deleteConversation', () => {
  test('newest first, title = first user turn; delete removes that one file', async () => {
    const dir = await scratch()
    const store = conversationStore(dir)
    const adapter = new FakeClaude({ sessionId: 'x' })
    for (const [id, q] of [
      ['c1', 'What   changed\nyesterday?'],
      ['c2', 'Second question'],
      ['c3', 'Third question'],
    ] as const) {
      await collect(askStream({ threadId: id, messages: [user(q)] }, { adapter, middleware: [], store, status: available }))
      await new Promise((r) => setTimeout(r, 5))
    }
    // A file with no user turn is not a conversation.
    await store.persistence.stores.metadata.set('orphan', 'sessionId', 'z')

    const list = await listConversations(store)
    expect(list.map((c) => c.threadId)).toEqual(['c3', 'c2', 'c1'])
    expect(list[2]).toMatchObject({ threadId: 'c1', title: 'What changed yesterday?' })
    expect(list.every((c) => /^\d{4}-\d{2}-\d{2}T/.test(c.updatedAt))).toBe(true)

    const remaining = await deleteConversation('c2', store)
    expect(remaining.map((c) => c.threadId)).toEqual(['c3', 'c1'])
    expect((await readdir(dir)).sort()).toEqual(['c1.json', 'c3.json', 'orphan.json'])
    // Deleting again is quiet.
    expect((await deleteConversation('c2', store)).map((c) => c.threadId)).toEqual(['c3', 'c1'])
  })

  test('getConversation gives UI messages plus the session id; unknown is null', async () => {
    const store = conversationStore(await scratch())
    const adapter = new FakeClaude({ sessionId: 'sess-Q', reply: 'forty-two' })
    await collect(askStream({ threadId: 'g1', messages: [user('the answer?')] }, { adapter, middleware: [], store, status: available }))
    const c = await getConversation('g1', store)
    expect(c?.sessionId).toBe('sess-Q')
    expect(c?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(c?.messages[1]?.parts).toEqual([{ type: 'text', content: 'forty-two' }])
    expect(await getConversation('nope', store)).toBeNull()
  })

  test('titleOf reads string and part content', () => {
    expect(titleOf([{ role: 'assistant', content: 'x' }, { role: 'user', content: [{ type: 'text', content: ' a  b ' }] }])).toBe('a b')
    expect(titleOf([])).toBe('')
  })
})

// ── Live round trip (AC1, AC2, AC4, AC5 against the real claude) ───────────────
//
// Spawns claude over the argus checkout twice; needs `claude login` (or a key) and a
// minute. Off unless ASK_LIVE=1 so `bun test` stays free and offline.

const live = process.env.ASK_LIVE === '1'

describe.skipIf(!live)('live — real adapter over the checkout', () => {
  const git = (...args: Array<string>) => execFileSync('git', ['-C', WORKSPACE_DIR, ...args], { encoding: 'utf8' })
  const fingerprint = () => git('status', '--porcelain=v1', '--untracked-files=all') + git('rev-parse', 'HEAD')
  let before = ''
  beforeAll(() => {
    before = fingerprint()
  })

  test(
    'two turns share one session; skills are argus\'s; the checkout is untouched',
    async () => {
      const store = conversationStore(await scratch())
      const events: Array<{ sessionId: string; skills: Array<unknown> }> = []
      const onChunk = (c: StreamChunk) => {
        if (c.type === EventType.CUSTOM && c.name === SESSION_ID_EVENT) events.push(c.value as { sessionId: string; skills: Array<unknown> })
      }
      const q1 = user('Reply with exactly the word PONG and nothing else.')
      const run1 = await collect(askStream({ threadId: 'live-1', messages: [q1] }, { store, status: available }), onChunk)
      expect(run1.find((c) => c.type === EventType.RUN_ERROR)).toBeUndefined()
      expect(run1.at(-1)?.type).toBe(EventType.RUN_FINISHED)
      const stored = await getConversation('live-1', store)
      expect(stored?.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
      expect(stored?.sessionId).toBe(events[0].sessionId)

      const run2 = await collect(askStream({ threadId: 'live-1', messages: [...(stored?.messages ?? []), user('Now reply with exactly PONG2.')] }, { store, status: available }), onChunk)
      expect(run2.find((c) => c.type === EventType.RUN_ERROR)).toBeUndefined()
      expect(events).toHaveLength(2)
      expect(events[1].sessionId).toBe(events[0].sessionId)

      const names = events[0].skills.map((s) => (typeof s === 'string' ? s : (s as { name?: string }).name))
      for (const s of ['sweep', 'slack-digest', 'log-change', 'feature-docs', 'linear-ticket']) expect(names).toContain(s)

      expect(fingerprint()).toBe(before)
      console.log('[live] session', events[0].sessionId, 'skills', names)
    },
    240_000,
  )
})
