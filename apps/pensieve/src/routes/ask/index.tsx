/**
 * /ask — every stored conversation, newest first, titled by its first question (AC5), and
 * the way to start one: mint a thread id here, and the conversation page does the rest.
 */
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { listConversations } from '#/lib/api'
import { Empty, PageTitle } from '#/components/bits'
import { Button } from '#/components/ui/button'
import { prettyStamp } from '#/lib/utils'
import { newThreadId } from '#/features/ask'

export const Route = createFileRoute('/ask/')({
  loader: () => listConversations(),
  component: AskListPage,
})

function AskListPage() {
  const conversations = Route.useLoaderData()
  const navigate = useNavigate()
  const start = () => navigate({ to: '/ask/$id', params: { id: newThreadId() } })
  return (
    <>
      <PageTitle
        kicker="Ask"
        title="Conversations"
        aside={
          <Button size="sm" onClick={start}>
            <PlusIcon />
            New conversation
          </Button>
        }
      />
      <p className="rise mb-8 max-w-[62ch] text-sm leading-snug text-ink-dim">
        Claude Code with the argus checkout open and nothing but <span className="mono">Read</span>, <span className="mono">Grep</span>,{' '}
        <span className="mono">Glob</span> and <span className="mono">git log</span> — it can read the blackboard, not write it. Each
        conversation keeps its Claude session, so a follow-up question picks up where the last answer left off.
      </p>
      {conversations.length === 0 && (
        <Empty title="No conversations yet">Start one and ask what the last sweep found, or where a feature lives.</Empty>
      )}
      <ul className="divide-y divide-rule-soft">
        {conversations.map((c, i) => (
          <li key={c.threadId} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
            <Link to="/ask/$id" params={{ id: c.threadId }} className="group flex items-baseline gap-4 py-3">
              <span className="mono w-36 shrink-0 text-ink-faint">{prettyStamp(c.updatedAt)}</span>
              <span className="display min-w-0 truncate text-[19px] text-ink group-hover:text-thread">{c.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
