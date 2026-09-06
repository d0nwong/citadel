/**
 * /ask-spike — throwaway page from LIA-100, now over `askChat` (LIA-102): one thread per
 * page load, persisted under PENSIEVE_HOME, resumed on the second question. A text
 * input, a raw dump of the messages `useChat` holds, and a log of the
 * `claude-code.session-id` event. No design work here on purpose. Replaced by LIA-103.
 */
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useChat } from '@tanstack/ai-react'
import { askChat } from '#/lib/api'

export const Route = createFileRoute('/ask-spike')({
  component: AskSpikePage,
})

interface SessionEvent {
  sessionId: string
  skills: Array<unknown>
  raw: unknown
}

function AskSpikePage() {
  const [input, setInput] = useState('what is in reports/points.json?')
  const [session, setSession] = useState<SessionEvent | null>(null)
  const [events, setEvents] = useState<Array<string>>([])
  const [deltas, setDeltas] = useState(0)
  const [threadId] = useState(() => `spike-${Math.random().toString(36).slice(2, 10)}`)

  const { messages, sendMessage, isLoading, status, error, stop, clear } = useChat({
    fetcher: ({ messages }, { signal }) => askChat({ data: { threadId, messages }, signal }),
    onChunk: (chunk) => {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') setDeltas((n) => n + 1)
      if (chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR' || chunk.type === 'RUN_STARTED') {
        setEvents((e) => [...e, `${new Date().toISOString()} ${chunk.type}`])
      }
    },
    onCustomEvent: (name, value) => {
      // AC3: the adapter surfaces the SDK's init message as this custom event.
      if (name === 'claude-code.session-id' && typeof value === 'object' && value !== null && 'sessionId' in value) {
        const v = value as { sessionId: string; skills?: Array<unknown> }
        console.log('[ask-spike] claude-code.session-id', { sessionId: v.sessionId, skills: v.skills ?? [] })
        setSession({ sessionId: v.sessionId, skills: v.skills ?? [], raw: value })
      } else {
        console.log('[ask-spike] custom event', name, value)
      }
      setEvents((e) => [...e, `${new Date().toISOString()} CUSTOM ${name}`])
    },
  })

  const ask = (e: React.FormEvent) => {
    e.preventDefault()
    const q = input.trim()
    if (!q || isLoading) return
    setDeltas(0)
    void sendMessage(q)
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-[28px]">Ask spike</h1>
      <p className="text-[13px] text-ink-dim">
        LIA-100 — Claude Code adapter over a Start server function. Watch the delta count tick while the answer streams.
      </p>

      <form onSubmit={ask} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 rounded-md border border-rule bg-paper px-3 py-2 text-[14px]"
          placeholder="ask about the argus checkout"
        />
        <button type="submit" disabled={isLoading} className="rounded-md border border-rule px-3 py-2 text-[14px] disabled:opacity-50">
          Ask
        </button>
        <button type="button" onClick={stop} disabled={!isLoading} className="rounded-md border border-rule px-3 py-2 text-[14px] disabled:opacity-50">
          Stop
        </button>
        <button type="button" onClick={clear} className="rounded-md border border-rule px-3 py-2 text-[14px]">
          Clear
        </button>
      </form>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
        <dt className="text-ink-faint">thread</dt>
        <dd data-testid="thread-id">{threadId}</dd>
        <dt className="text-ink-faint">status</dt>
        <dd data-testid="status">{status}</dd>
        <dt className="text-ink-faint">text deltas</dt>
        <dd data-testid="deltas">{deltas}</dd>
        <dt className="text-ink-faint">sessionId</dt>
        <dd data-testid="session-id">{session?.sessionId ?? '—'}</dd>
        <dt className="text-ink-faint">skills</dt>
        <dd data-testid="skills">{session ? JSON.stringify(session.skills) : '—'}</dd>
        {error && (
          <>
            <dt className="text-ink-faint">error</dt>
            <dd className="text-red-700">{error.message}</dd>
          </>
        )}
      </dl>

      <section>
        <h2 className="kicker mb-2">messages</h2>
        {messages.map((m) => (
          <article key={m.id} className="mb-4 border-t border-rule-soft pt-2">
            <p className="font-mono text-[11px] uppercase text-ink-faint">{m.role}</p>
            {m.parts.map((p, i) =>
              p.type === 'text' ? (
                <pre key={i} data-testid={`${m.role}-text`} className="whitespace-pre-wrap text-[13.5px]">
                  {p.content}
                </pre>
              ) : (
                <pre key={i} className="overflow-x-auto text-[11px] text-ink-dim">
                  {JSON.stringify(p, null, 1)}
                </pre>
              ),
            )}
          </article>
        ))}
      </section>

      <section>
        <h2 className="kicker mb-2">events</h2>
        <pre className="font-mono text-[11px] text-ink-dim">{events.join('\n')}</pre>
      </section>

      <details>
        <summary className="kicker cursor-pointer">raw useChat messages</summary>
        <pre className="overflow-x-auto text-[11px]">{JSON.stringify(messages, null, 2)}</pre>
      </details>
    </div>
  )
}
