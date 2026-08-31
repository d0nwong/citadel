import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { getJournalEntry } from '#/lib/api'
import { Md } from '#/components/md'
import { Fact, FeatureLink, PageTitle, PrLink, StatusPill, TicketLink } from '#/components/bits'
import { prettyDay } from '#/lib/utils'

export const Route = createFileRoute('/journal/$')({
  loader: async ({ params }) => {
    const r = await getJournalEntry({ data: params._splat ?? '' })
    if (!r) throw notFound()
    return r
  },
  component: EntryPage,
  notFoundComponent: () => <p className="text-ink-dim">No journal entry at that path.</p>,
})

function EntryPage() {
  const { doc, meta, path } = Route.useLoaderData()
  return (
    <>
      <PageTitle
        kicker={
          <>
            <Link to="/journal" search={{ day: meta.date }} className="hover:text-thread">
              {prettyDay(meta.date)}
            </Link>
            {' · '}
            <FeatureLink feature={meta.feature} className="text-[10.5px] uppercase tracking-[0.16em]" />
          </>
        }
        title={meta.summary ?? meta.slug}
        aside={<StatusPill status={meta.status} hold={meta.hold} />}
      />
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[1fr_13rem]">
        <div className="rise min-w-0" style={{ animationDelay: '60ms' }}>
          <Md doc={doc} />
        </div>
        <dl className="rise order-first lg:order-none lg:sticky lg:top-6 lg:self-start" style={{ animationDelay: '120ms' }}>
          <Fact label="Landing">
            <PrLink pr={meta.pr} url={meta.url} />
            {meta.merge && <span className="mono ml-2 text-ink-faint">{meta.merge}</span>}
          </Fact>
          <Fact label="Ticket">
            <TicketLink ticket={meta.ticket} />
          </Fact>
          <Fact label="Scope">{meta.scope}</Fact>
          <Fact label="Features">
            <span className="flex flex-wrap gap-x-2">
              {meta.features.map((f) => (
                <FeatureLink key={f} feature={f} />
              ))}
            </span>
          </Fact>
          <Fact label="Hold">{meta.hold && <span className="text-st-hold">{meta.hold}</span>}</Fact>
          <Fact label="Source">{meta.source && meta.source !== 'null' ? meta.source : undefined}</Fact>
          <Fact label="File">
            <span className="mono break-all text-ink-faint">{path}</span>
          </Fact>
        </dl>
      </div>
    </>
  )
}
