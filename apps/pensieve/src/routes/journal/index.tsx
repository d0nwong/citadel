import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { listJournal } from '#/lib/api'
import { Empty, FeatureLink, PageTitle, PrLink, StatusPill, TicketLink } from '#/components/bits'
import { cn, prettyDay } from '#/lib/utils'
import type { JournalEntry, JournalStatus } from '#/server/workspace'

const STATUSES: Array<JournalStatus | 'hold'> = ['decided', 'implemented', 'documented', 'superseded', 'hold']

type Search = { app?: string; day?: string; feature?: string; status?: JournalStatus | 'hold'; q?: string }

export const Route = createFileRoute('/journal/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    app: typeof s.app === 'string' && s.app ? s.app : undefined,
    day: typeof s.day === 'string' ? s.day : undefined,
    feature: typeof s.feature === 'string' ? s.feature : undefined,
    status: STATUSES.includes(s.status as JournalStatus) ? (s.status as Search['status']) : undefined,
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
  }),
  loader: () => listJournal(),
  component: JournalPage,
})

function matches(e: JournalEntry, s: Search) {
  if (s.app && e.app !== s.app) return false
  if (s.day && e.date !== s.day) return false
  // `features:` holds bare ids, `e.feature` is `<app>/<dir>` — accept a filter written
  // either way, so a link from a doc's feature key and a click on this page agree.
  if (s.feature && e.feature !== s.feature && !e.features.includes(s.feature) && !e.feature.endsWith(`/${s.feature}`))
    return false
  if (s.status === 'hold' ? !e.hold : s.status && e.status !== s.status) return false
  if (s.q) {
    const hay = `${e.slug} ${e.summary ?? ''} ${e.pr ?? ''} ${e.ticket ?? ''} ${e.merge ?? ''}`.toLowerCase()
    if (!hay.includes(s.q.toLowerCase())) return false
  }
  return true
}

function JournalPage() {
  const all = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  const apps = useMemo(() => Array.from(new Set(all.map((e) => e.app))).sort(), [all])
  // The feature list follows the app filter: every feature of every app at once is a
  // wall of names, and a feature only means something inside its app.
  const features = useMemo(
    () => Array.from(new Set(all.filter((e) => !search.app || e.app === search.app).map((e) => e.feature))).sort(),
    [all, search.app],
  )
  const shown = useMemo(() => all.filter((e) => matches(e, search)), [all, search])
  const byDay = useMemo(() => {
    const m = new Map<string, JournalEntry[]>()
    for (const e of shown) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return Array.from(m.entries())
  }, [shown])

  const set = (patch: Partial<Search>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const filtered = Boolean(search.app || search.day || search.feature || search.status || search.q)

  return (
    <>
      <PageTitle
        kicker="Change journal"
        title={search.day ? prettyDay(search.day) : 'Landings'}
        aside={
          <>
            {shown.length}
            {filtered ? ` of ${all.length}` : ''} entr{shown.length === 1 ? 'y' : 'ies'}
            {filtered && (
              <button onClick={() => navigate({ search: {}, replace: true })} className="ml-3 text-thread hover:underline">
                clear
              </button>
            )}
          </>
        }
      />

      <div className="rise mb-8 flex flex-col gap-3" style={{ animationDelay: '40ms' }}>
        {apps.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {apps.map((a) => (
              <button
                key={a}
                // Changing app drops the feature filter — a feature key belongs to one app.
                onClick={() => set({ app: search.app === a ? undefined : a, feature: undefined })}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors',
                  search.app === a ? 'border-thread bg-thread text-paper' : 'border-rule text-ink-dim hover:border-ink-dim',
                )}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => set({ status: search.status === s ? undefined : s })}
              className={cn(
                'rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors',
                search.status === s ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-dim hover:border-ink-dim',
              )}
            >
              {s}
            </button>
          ))}
          <input
            value={search.q ?? ''}
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder="search slug, summary, pr, ticket…"
            className="ml-auto w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-thread focus:outline-none sm:w-72"
          />
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {features.map((f) => (
            <button
              key={f}
              onClick={() => set({ feature: search.feature === f ? undefined : f })}
              className={cn('mono transition-colors', search.feature === f ? 'text-thread underline underline-offset-4' : 'text-ink-faint hover:text-ink')}
            >
              {search.app && f.startsWith(`${search.app}/`) ? f.slice(search.app.length + 1) : f}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <Empty title="Nothing matches">Loosen a filter, or widen the window the sweep scans.</Empty>}

      {byDay.map(([day, entries], di) => (
        <section key={day} className="rise mb-8 grid grid-cols-1 gap-x-8 md:grid-cols-[9rem_1fr]" style={{ animationDelay: `${60 + di * 40}ms` }}>
          <div className="md:sticky md:top-6 md:self-start">
            <Link to="/journal" search={{ day }} className="display block text-[19px] leading-tight text-ink hover:text-thread">
              {prettyDay(day)}
            </Link>
            <p className="mono mt-0.5 text-ink-faint">
              {entries.length} landing{entries.length === 1 ? '' : 's'}
            </p>
          </div>
          <ol className="divide-y divide-rule-soft border-t border-rule md:border-t-0">
            {entries.map((e) => (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <FeatureLink feature={e.feature} app={e.app} />
                  <PrLink pr={e.pr} url={e.url} />
                  {e.merge && <span className="mono text-ink-faint">{e.merge.slice(0, 9)}</span>}
                  <TicketLink ticket={e.ticket} />
                  <span className="ml-auto">
                    <StatusPill status={e.status} hold={e.hold} />
                  </span>
                </div>
                <Link to="/journal/$" params={{ _splat: e.id }} className="mt-1 block text-[16px] leading-snug text-ink hover:text-thread">
                  {e.summary ?? e.slug}
                </Link>
                {e.hold && <p className="mt-1 text-sm italic text-st-hold">hold: {e.hold}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  )
}
