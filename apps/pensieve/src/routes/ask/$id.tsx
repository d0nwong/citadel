/**
 * /ask/$id — one conversation. The loader brings the stored turns (none for a thread the
 * list page just minted) and whether a credential is available; the page hands both to
 * the bound chat from `#/chat/ask-ui` and adds the title, Delete, and a footer with the
 * thread and Claude session ids.
 *
 * Reload during an answer behaves like Stop: the request drops, the server kills the
 * claude process, and what was persisted while streaming is what comes back (AC2, AC7).
 * The next question resumes the same session — the id is stored server-side, never sent
 * from here (AC3).
 *
 * Opened from a point (`?q=…&from=points`): the question is sent as soon as a credential is
 * known to be available — or left in the composer when it is not — and the kicker is a
 * breadcrumb back to the points. `q` is dropped from the URL once sent.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import type { UIMessage } from '@tanstack/ai'
import { ArrowLeftIcon, Trash2Icon } from 'lucide-react'
import { askStatus, deleteConversation, getConversation } from '#/lib/api'
import { AskStatusProvider, useAppChat } from '#/chat/ask-ui'
import { PageTitle } from '#/components/bits'
import { Button } from '#/components/ui/button'

type From = 'points'

export const Route = createFileRoute('/ask/$id')({
  validateSearch: (s: Record<string, unknown>): { q?: string; from?: From } => ({
    ...(typeof s.q === 'string' && s.q.trim() ? { q: s.q } : {}),
    ...(s.from === 'points' ? { from: 'points' as const } : {}),
  }),
  loader: async ({ params }) => {
    // The server refuses anything that is not a thread id (path-like, too long); that is a 404 here, not a crash.
    const [conversation, status] = await Promise.all([getConversation({ data: params.id }).catch(() => undefined), askStatus()])
    if (conversation === undefined) throw notFound()
    return { conversation, status }
  },
  component: AskConversationPage,
  notFoundComponent: () => <p className="text-ink-dim">That is not a conversation id.</p>,
})

/** The first user turn, one line — the same title the list shows. */
const firstQuestion = (messages: Array<UIMessage>): string =>
  (messages.find((m) => m.role === 'user')?.parts ?? [])
    .flatMap((p) => (p.type === 'text' ? [p.content] : []))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

function AskConversationPage() {
  const { id } = Route.useParams()
  const { q, from } = Route.useSearch()
  const { conversation, status } = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  // `messages` crossed the wire as JSON (see `ConversationWire`); the bytes are UIMessages.
  const chat = useAppChat({ threadId: id, initialMessages: (conversation?.messages ?? []) as unknown as Array<UIMessage> })

  // When an answer finishes, re-run the loader: the footer learns the session id and the
  // list / Inbox counts are fresh on the way back. The chat itself is keyed on the thread
  // id, so new loader data never resets it.
  const wasLoading = useRef(false)
  useEffect(() => {
    if (wasLoading.current && !chat.isLoading) void router.invalidate()
    wasLoading.current = chat.isLoading
  }, [chat.isLoading, router])

  // A question that arrived with the URL (a point's Ask) goes out by itself, once. Not on the
  // first effect pass: after a client-side navigation React commits this tree, something below
  // suspends, and the effects are cleaned up and re-run on the same instance — `useChat`'s
  // cleanup detaches the client and aborts whatever it was sending. A short timer that the
  // cleanup cancels means the send happens only once the tree has settled. A reload cannot
  // send it twice: the stored turns hydrate `messages`, and the guard sees them. Without a
  // credential the question waits in the composer instead.
  const seeded = useRef(false)
  useEffect(() => {
    if (!q || seeded.current || !status.available || chat.isLoading || chat.messages.length > 0) return
    const t = setTimeout(() => {
      seeded.current = true
      void chat.sendMessage(q)
    }, 50)
    return () => clearTimeout(t)
  }, [q, status.available, chat])

  const remove = async () => {
    if (!window.confirm('Delete this conversation? Its file under PENSIEVE_HOME is removed.')) return
    setDeleting(true)
    if (chat.isLoading) chat.stop()
    try {
      await deleteConversation({ data: id })
    } finally {
      setDeleting(false)
    }
    await router.invalidate()
    await navigate({ to: '/ask' })
  }

  const title = firstQuestion(chat.messages as Array<UIMessage>) || 'New conversation'

  return (
    <div className="flex h-[calc(100dvh-5rem)] flex-col">
      <PageTitle
        kicker={
          from === 'points' ? (
            <span className="inline-flex items-center gap-1.5">
              <Link to="/points" className="inline-flex items-center gap-1 hover:text-thread">
                <ArrowLeftIcon className="size-3" /> Points
              </Link>
              <span aria-hidden>›</span>
              <Link to="/ask" className="hover:text-thread">
                Ask
              </Link>
            </span>
          ) : (
            <Link to="/ask" className="inline-flex items-center gap-1 hover:text-thread">
              <ArrowLeftIcon className="size-3" /> Ask
            </Link>
          )
        }
        title={<span className="line-clamp-2 text-[24px] leading-tight sm:text-[28px]">{title}</span>}
        aside={
          <Button variant="ghost" size="sm" onClick={remove} disabled={deleting} className="text-ink-dim hover:text-st-hold">
            <Trash2Icon />
            Delete
          </Button>
        }
      />
      <AskStatusProvider status={status} threadId={id} draft={q && !status.available ? q : undefined}>
        <chat.AppChat />
      </AskStatusProvider>
      <p className="mono mt-2 truncate text-ink-faint" title={conversation?.sessionId ? `session ${conversation.sessionId}` : undefined}>
        thread {id}
        {conversation?.sessionId && <> · session {conversation.sessionId}</>}
      </p>
    </div>
  )
}
