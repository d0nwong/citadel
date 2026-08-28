import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, GitBranch } from 'lucide-react'
import { NewJobDialog } from './new-job-dialog'
import { PurgeJobsDialog } from './purge-jobs-dialog'
import { JobDetailSheet } from './job-detail-sheet'
import { JobStatusChip } from './job-status-chip'
import { Skeleton } from '@/shared/ui/skeleton'
import { PageHeader } from '@/shared/components/page-header'
import { jobQueries } from '../queries'
import { duration, relative } from '@/shared/lib/format'
import { repoLabel } from '@/features/repos/types'
import { blueprintLabel } from '@/features/blueprints/types'
import { cn } from '@/shared/lib/utils'
import { shortId } from '../types'
import type { Job, JobStatus } from '../types'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Forging' },
  { key: 'queued', label: 'Queued' },
  { key: 'succeeded', label: 'Succeeded' },
  { key: 'failed', label: 'Failed' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function JobRow({ job, onOpen, index }: { job: Job; onOpen: () => void; index: number }) {
  const elapsed = (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt)
  const running = job.status === 'running'

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 12) * 26}ms` }}
      className="group animate-rise-in relative flex w-full flex-col gap-1.5 border-b border-hairline bg-iron-900 px-4 py-3 text-left transition-colors hover:bg-iron-850 lg:grid lg:grid-cols-[128px_minmax(0,1fr)_240px_104px_84px_100px_24px] lg:items-center lg:gap-4 lg:px-6 lg:py-3.5"
    >
      <span
        className={cn(
          'absolute left-0 top-0 h-full w-0.5 origin-top scale-y-0 bg-ember transition-transform duration-200 group-hover:scale-y-100',
          running && 'scale-y-100',
        )}
      />
      {running && (
        <span className="pointer-events-none absolute inset-y-0 left-0 w-24 overflow-hidden">
          <span className="animate-heat-sweep block h-full w-8 bg-gradient-to-r from-transparent via-ember/10 to-transparent" />
        </span>
      )}

      {/* Two stacked bands on a phone. At lg the wrappers become `display: contents`
          so their children drop straight into the ledger grid — one DOM, two layouts. */}
      <span className="flex min-w-0 items-center gap-3 lg:contents">
        <JobStatusChip status={job.status} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-txt">{job.task}</span>
          <span className="mt-0.5 hidden font-mono text-[11px] text-txt-faint lg:block">{shortId(job.id)}</span>
        </span>
      </span>

      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 lg:contents">
        <span className="w-full min-w-0 font-mono text-[12px] lg:w-auto">
          <span className="block truncate text-txt-dim">{repoLabel(job.repo)}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-txt-faint">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{job.branch}</span>
          </span>
        </span>

        <span className="min-w-0 font-mono text-[12px] text-txt-dim">
          <span className="block truncate">{job.forge}</span>
          {job.blueprint && (
            <span className="block truncate text-[11px] text-ember-soft">{blueprintLabel(job.blueprint)}</span>
          )}
        </span>
        <span className="font-mono text-[12px] tabular-nums text-txt-dim lg:text-right">
          {job.status === 'queued' ? '—' : duration(elapsed)}
        </span>
        <span className="font-mono text-[11px] text-txt-faint lg:text-right">{relative(job.createdAt)}</span>
      </span>

      <ChevronRight className="hidden size-4 text-txt-faint opacity-0 transition-opacity group-hover:opacity-100 lg:block" />
    </button>
  )
}

export function JobLedger() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { data: statusCounts } = useQuery(jobQueries.counts())
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, ...statusCounts }
    for (const n of Object.values(statusCounts ?? {})) c.all += n
    return c
  }, [statusCounts])

  const active = counts.running ?? 0
  // Mirrors the store's OPEN set: everything not queued/running is purgeable.
  const purgeable = counts.all - active - (counts.queued ?? 0)

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(jobQueries.list(filter === 'all' ? undefined : (filter as JobStatus)))

  const jobs = useMemo(() => data?.pages.flatMap((p) => p.jobs) ?? [], [data])

  const rowCount = hasNextPage ? jobs.length + 1 : jobs.length
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 62,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= jobs.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [virtualItems, jobs.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      <PageHeader
        title="Jobs"
        below={
          <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline bg-iron-900/60 px-4 py-2 lg:px-6">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                  filter === f.key ? 'bg-iron-750 text-txt' : 'text-txt-faint hover:bg-iron-850 hover:text-txt-dim',
                )}
              >
                {f.label}
                <span className="ml-1.5 font-mono text-[10px] text-txt-faint">{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </div>
        }
      >
        <span className="font-mono text-[11px] text-txt-faint">
          {active > 0 ? <span className="text-slag">{active} forging</span> : <span>all forges cool</span>}
          <span className="mx-2 text-hairline">│</span>
          {counts.all} total
        </span>
        <PurgeJobsDialog purgeable={purgeable} />
        <NewJobDialog />
      </PageHeader>

      <div className="flex-1">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b border-hairline px-4 py-4 lg:px-6">
              <Skeleton className="h-9 w-full bg-iron-800" />
            </div>
          ))}

        {!isLoading && jobs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-24">
            <p className="text-[14px] text-txt-dim">Nothing in the fire.</p>
            <p className="font-mono text-[12px] text-txt-faint">No jobs match this filter.</p>
          </div>
        )}

        {!isLoading && jobs.length > 0 && (
          <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((item) => {
              const isLoaderRow = item.index > jobs.length - 1
              const job = jobs[item.index]

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
                >
                  {isLoaderRow || !job ? (
                    <div className="border-b border-hairline px-4 py-4 lg:px-6">
                      <Skeleton className="h-9 w-full bg-iron-800" />
                    </div>
                  ) : (
                    <JobRow job={job} index={item.index} onOpen={() => setSelected(job.id)} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <JobDetailSheet jobId={selected} onClose={() => setSelected(null)} onRerun={setSelected} />
    </>
  )
}
