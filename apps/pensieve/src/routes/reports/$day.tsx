import { createFileRoute, notFound } from '@tanstack/react-router'
import { getReport } from '#/lib/api'
import { Md } from '#/components/md'
import { PageTitle } from '#/components/bits'
import { prettyDay } from '#/lib/utils'

export const Route = createFileRoute('/reports/$day')({
  loader: async ({ params }) => {
    const r = await getReport({ data: params.day })
    if (!r) throw notFound()
    return r
  },
  component: ReportPage,
  notFoundComponent: () => <p className="text-ink-dim">No report for that day.</p>,
})

function ReportPage() {
  const { day } = Route.useParams()
  const r = Route.useLoaderData()
  return (
    <>
      <PageTitle kicker="Sweep report" title={prettyDay(day)} aside={<span className="mono">{r.path}</span>} />
      <div className="rise" style={{ animationDelay: '60ms' }}>
        <Md doc={r.doc} />
      </div>
    </>
  )
}
