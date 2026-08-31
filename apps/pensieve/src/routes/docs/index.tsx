import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { listDocs } from '#/lib/api'
import { Empty, PageTitle } from '#/components/bits'
import { cn, daysSince } from '#/lib/utils'
import type { DocMeta } from '#/server/workspace'

export const Route = createFileRoute('/docs/')({
  loader: () => listDocs(),
  component: DocsPage,
})

function Age({ date, label }: { date?: string; label: string }) {
  const d = daysSince(date)
  if (d === null) return <span className="text-ink-faint">{label} —</span>
  return (
    <span className={cn(d > 14 ? 'text-st-decided' : d > 30 ? 'text-st-hold' : 'text-ink-faint')} title={date}>
      {label} {d}d
    </span>
  )
}

function DocsPage() {
  const docs = Route.useLoaderData()
  const byFeature = useMemo(() => {
    const m = new Map<string, Partial<Record<DocMeta['tier'], DocMeta>>>()
    for (const d of docs) m.set(d.feature, { ...(m.get(d.feature) ?? {}), [d.tier]: d })
    return Array.from(m.entries())
  }, [docs])

  return (
    <>
      <PageTitle kicker="Dual-tier feature docs" title="Docs" aside={`${byFeature.length} features`} />
      {byFeature.length === 0 && <Empty title="No docs found" />}
      <ul className="divide-y divide-rule-soft">
        {byFeature.map(([feature, tiers], i) => {
          const any = tiers.product ?? tiers.arch
          return (
            <li key={feature} className="rise grid grid-cols-1 gap-x-6 gap-y-1 py-3 sm:grid-cols-[1fr_auto] sm:items-baseline" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="display text-[19px] text-ink">{any?.name ?? feature}</span>
                  <span className="mono text-ink-faint">{feature}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 font-mono text-[11px]">
                  <Age date={any?.lastVerifiedDate} label="fe" />
                  <Age date={any?.lastVerifiedBeDate} label="be" />
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
    </>
  )
}
