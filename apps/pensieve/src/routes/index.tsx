import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { getInbox } from '#/lib/api'
import { Md } from '#/components/md'
import { Empty, PageTitle } from '#/components/bits'
import { prettyDay } from '#/lib/utils'

export const Route = createFileRoute('/')({
  loader: () => getInbox(),
  component: InboxPage,
})

function InboxPage() {
  const { report, digest, workspace } = Route.useLoaderData()
  return (
    <>
      <PageTitle
        kicker="Inbox"
        title={report ? prettyDay(report.day) : 'Nothing drawn yet'}
        aside={
          <span className="mono text-ink-faint" title={workspace}>
            {workspace.replace(/^\/Users\/[^/]+/, '~')}
          </span>
        }
      />

      <section className="rise" style={{ animationDelay: '60ms' }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="kicker">Sweep report</h2>
          <Link to="/reports" className="text-[12.5px] text-ink-faint hover:text-thread">
            past reports
          </Link>
        </div>
        {report ? (
          <Md doc={report.doc} />
        ) : (
          <Empty title="No sweep report on file">
            The sweep writes <span className="mono">reports/&lt;day&gt;.md</span> each tick. Run <span className="mono">/sweep</span> in
            ai-workspace and this page fills in.
          </Empty>
        )}
      </section>

      <section className="rise mt-12" style={{ animationDelay: '140ms' }}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="kicker">Latest digest{digest ? ` · ${prettyDay(digest.day, { weekday: false })}` : ''}</h2>
          {digest && (
            <Link to="/digests/$day" params={{ day: digest.day }} className="inline-flex items-center gap-1 text-[12.5px] text-ink-faint hover:text-thread">
              open <ArrowUpRight className="size-3" />
            </Link>
          )}
        </div>
        {digest ? <Md doc={digest.doc} /> : <Empty title="No digest on file" />}
      </section>
    </>
  )
}
