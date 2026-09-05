import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { listDocs } from '#/lib/api'
import { Empty, PageTitle } from '#/components/bits'
import { cn, daysSince } from '#/lib/utils'
import type { DocMeta } from '#/server/workspace'

type Search = { app?: string }

export const Route = createFileRoute('/docs/')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    app: typeof s.app === 'string' && s.app ? s.app : undefined,
  }),
  loader: () => listDocs(),
  component: DocsPage,
})

function Age({ date, label }: { date?: string; label: string }) {
  const d = daysSince(date)
  if (d === null) return <span className="text-ink-faint">{label} —</span>
  // Widest threshold first: ordering them the other way makes the second unreachable.
  return (
    <span className={cn(d > 30 ? 'text-st-hold' : d > 14 ? 'text-st-decided' : 'text-ink-faint')} title={date}>
      {label} {d}d
    </span>
  )
}

/** One app's features. Rows show the key without its app prefix; links carry it. */
function AppSection({ app, docs }: { app: string; docs: DocMeta[] }) {
  const byFeature = useMemo(() => {
    const m = new Map<string, Partial<Record<DocMeta['tier'], DocMeta>>>()
    for (const d of docs) m.set(d.feature, { ...(m.get(d.feature) ?? {}), [d.tier]: d })
    return Array.from(m.entries())
  }, [docs])

  return (
    <section className="mb-10">
      <div className="mb-1 flex items-baseline gap-3 border-b border-rule pb-1">
        <h2 className="display text-[19px] text-ink">{app}</h2>
        <span className="mono text-ink-faint">
          {byFeature.length} feature{byFeature.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="divide-y divide-rule-soft">
        {byFeature.map(([feature, tiers], i) => {
          const any = tiers.product ?? tiers.arch
          const short = feature.startsWith(`${app}/`) ? feature.slice(app.length + 1) : feature
          return (
            <li
              key={feature}
              className="rise grid grid-cols-1 gap-x-6 gap-y-1 py-3 sm:grid-cols-[1fr_auto] sm:items-baseline"
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="display text-[19px] text-ink">{any?.name ?? short}</span>
                  <span className="mono text-ink-faint">{short}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 font-mono text-[11px]">
                  <Age date={any?.lastVerifiedDate} label="fe" />
                  {/* Single-repo apps have no backend tier, so an empty `be —` on every
                      row would be noise rather than a signal. */}
                  {any?.lastVerifiedBe && <Age date={any.lastVerifiedBeDate} label="be" />}
                  {any?.status && <span className="text-ink-faint">{any.status}</span>}
                </div>
              </div>
              <div className="flex gap-1.5">
                {(['product', 'arch'] as const).map((t) =>
                  tiers[t] ? (
                    <Link
                      key={t}
                      to="/docs/$"
                      params={{ _splat: feature }}
                      search={{ tier: t }}
                      className="rounded-full border border-rule px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-dim hover:border-thread hover:text-thread"
                    >
                      {t}
                    </Link>
                  ) : (
                    <span key={t} className="rounded-full border border-dashed border-rule-soft px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint/60">
                      {t}
                    </span>
                  ),
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function DocsPage() {
  const docs = Route.useLoaderData()
  const { app: selected } = Route.useSearch()
  const navigate = Route.useNavigate()

  const apps = useMemo(() => Array.from(new Set(docs.map((d) => d.app))).sort(), [docs])
  const shown = useMemo(() => (selected ? docs.filter((d) => d.app === selected) : docs), [docs, selected])
  const grouped = useMemo(() => {
    const m = new Map<string, DocMeta[]>()
    for (const d of shown) m.set(d.app, [...(m.get(d.app) ?? []), d])
    return Array.from(m.entries())
  }, [shown])
  const features = useMemo(() => new Set(shown.map((d) => d.feature)).size, [shown])

  return (
    <>
      <PageTitle
        kicker="Dual-tier feature docs"
        title="Docs"
        aside={
          <>
            {features} feature{features === 1 ? '' : 's'}
            {apps.length > 1 && !selected && ` · ${apps.length} apps`}
            {selected && (
              <button onClick={() => navigate({ search: {}, replace: true })} className="ml-3 text-thread hover:underline">
                clear
              </button>
            )}
          </>
        }
      />

      {apps.length > 1 && (
        <div className="rise mb-8 flex flex-wrap items-center gap-1.5" style={{ animationDelay: '40ms' }}>
          {apps.map((a) => (
            <button
              key={a}
              onClick={() => navigate({ search: selected === a ? {} : { app: a }, replace: true })}
              className={cn(
                'rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] transition-colors',
                selected === a ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-dim hover:border-ink-dim',
              )}
            >
              {a}
            </button>
          ))}
        </div>
      )}

      {grouped.length === 0 && <Empty title="No docs found" />}
      {grouped.map(([app, appDocs]) => (
        <AppSection key={app} app={app} docs={appDocs} />
      ))}
    </>
  )
}
