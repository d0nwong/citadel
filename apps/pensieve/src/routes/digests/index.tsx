import { Link, createFileRoute } from '@tanstack/react-router'
import { listDigests } from '#/lib/api'
import { Empty, PageTitle } from '#/components/bits'
import { prettyDay } from '#/lib/utils'

export const Route = createFileRoute('/digests/')({
  loader: () => listDigests(),
  component: DigestsPage,
})

function DigestsPage() {
  const digests = Route.useLoaderData()
  return (
    <>
      <PageTitle kicker="#dev-team" title="Digests" aside={`${digests.length} day${digests.length === 1 ? '' : 's'}`} />
      {digests.length === 0 && <Empty title="No digests yet" />}
      <ul className="divide-y divide-rule-soft">
        {digests.map((d, i) => (
          <li key={d.day} className="rise" style={{ animationDelay: `${i * 30}ms` }}>
            <Link to="/digests/$day" params={{ day: d.day }} className="group flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="mono w-28 shrink-0 text-ink-faint">{d.day}</span>
              <span className="display text-[19px] text-ink group-hover:text-thread">{prettyDay(d.day)}</span>
              {d.lede && <span className="min-w-0 truncate text-sm text-ink-faint">{d.lede}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
