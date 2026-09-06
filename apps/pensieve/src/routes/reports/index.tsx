import { Link, createFileRoute } from '@tanstack/react-router'
import { listReports } from '#/lib/api'
import { Empty, PageTitle } from '#/components/bits'
import { prettyDay } from '#/lib/utils'

export const Route = createFileRoute('/reports/')({
  loader: () => listReports(),
  component: ReportsPage,
})

function ReportsPage() {
  const reports = Route.useLoaderData()
  return (
    <>
      <PageTitle kicker="Sweep" title="Reports" aside={`${reports.length} day${reports.length === 1 ? '' : 's'}`} />
      {reports.length === 0 && <Empty title="No reports yet" />}
      <ul className="divide-y divide-rule-soft">
        {reports.map((r, i) => (
          <li key={r.day} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
            <Link to="/reports/$day" params={{ day: r.day }} className="group flex items-baseline gap-4 py-3">
              <span className="mono w-28 shrink-0 text-ink-faint">{r.day}</span>
              <span className="display text-[19px] text-ink group-hover:text-thread">{prettyDay(r.day)}</span>
              {r.lede && <span className="truncate text-sm text-ink-faint">{r.lede}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
