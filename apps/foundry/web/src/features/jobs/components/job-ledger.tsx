import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { NewJobDialog } from './new-job-dialog'
import { PurgeJobsDialog } from './purge-jobs-dialog'
import { JobDetailSheet } from './job-detail-sheet'
import { JobGroupItem } from './job-group'
import { Skeleton } from '@/shared/ui/skeleton'
import { PageHeader } from '@/shared/components/page-header'
import { jobQueries } from '../queries'
import { cn } from '@/shared/lib/utils'
import type { JobGroup, JobStatus } from '../types'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'running', label: 'Forging' },
  { key: 'queued', label: 'Queued' },
  { key: 'succeeded', label: 'Succeeded' },
  { key: 'failed', label: 'Failed' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

/** Heights before the virtualizer measures: a job row, plus the follow-up strip when a group has one. */
const ROW_ESTIMATE = 62
const STRIP_ESTIMATE = 34

export function JobLedger() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<string | null>(null)
  // Groups the user has opened or closed, by root id. The rest follow `autoOpen`.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
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

  // A group is ordered by its newest follow-up, so between polls it can move up
  // a page and briefly sit on two; the first sighting wins.
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<JobGroup> = []
    for (const page of data?.pages ?? []) {
      for (const g of page.jobs) {
        if (seen.has(g.id)) continue
        seen.add(g.id)
        out.push(g)
      }
    }
    return out
  }, [data])

  // Folded by default, open by itself when folding would hide what the user is
  // looking at: the job open in the sheet (a follow-up just queued from it,
  // say), or — under a status filter — the follow-up that matched it.
  const autoOpen = (g: JobGroup) =>
    g.followUps.some((f) => f.id === selected) || (filter !== 'all' && g.status !== filter)
  const isOpen = (g: JobGroup) => toggled[g.id] ?? autoOpen(g)

  const rowCount = hasNextPage ? groups.length + 1 : groups.length
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: (i) => ROW_ESTIMATE + ((groups[i]?.followUps.length ?? 0) > 0 ? STRIP_ESTIMATE : 0),
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })
  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= groups.length - 1 && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [virtualItems, groups.length, hasNextPage, isFetchingNextPage, fetchNextPage])

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

        {!isLoading && groups.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-24">
            <p className="text-[14px] text-txt-dim">Nothing in the fire.</p>
            <p className="font-mono text-[12px] text-txt-faint">No jobs match this filter.</p>
          </div>
        )}

        {!isLoading && groups.length > 0 && (
          <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((item) => {
              const isLoaderRow = item.index > groups.length - 1
              const group = groups[item.index]

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)` }}
                >
                  {isLoaderRow || !group ? (
                    <div className="border-b border-hairline px-4 py-4 lg:px-6">
                      <Skeleton className="h-9 w-full bg-iron-800" />
                    </div>
                  ) : (
                    <JobGroupItem
                      group={group}
                      index={item.index}
                      open={isOpen(group)}
                      onToggle={() => setToggled((t) => ({ ...t, [group.id]: !isOpen(group) }))}
                      onOpen={setSelected}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <JobDetailSheet jobId={selected} onClose={() => setSelected(null)} onOpenJob={setSelected} />
    </>
  )
}
