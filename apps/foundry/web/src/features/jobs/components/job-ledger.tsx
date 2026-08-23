import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, GitBranch } from 'lucide-react'
import { NewJobDialog } from './new-job-dialog'
import { JobDetailSheet } from './job-detail-sheet'
import { JobStatusChip } from './job-status-chip'
import { Skeleton } from '@/shared/ui/skeleton'
import { PageHeader } from '@/shared/components/page-header'
import { jobQueries } from '../queries'
import { duration, relative, tildePath } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
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
      className="group animate-rise-in relative grid w-full grid-cols-[128px_minmax(0,1fr)_240px_104px_84px_100px_24px] items-center gap-4 border-b border-hairline bg-iron-900 px-6 py-3.5 text-left transition-colors hover:bg-iron-850"
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

      <JobStatusChip status={job.status} />

      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium text-txt">{job.task}</span>
        <span className="mt-0.5 block font-mono text-[11px] text-txt-faint">{job.id}</span>
      </span>

      <span className="min-w-0 font-mono text-[12px]">
        <span className="block truncate text-txt-dim">{tildePath(job.repoPath)}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-txt-faint">
          <GitBranch className="size-3" />
          <span className="truncate">{job.branch}</span>
        </span>
      </span>

      <span className="font-mono text-[12px] text-txt-dim">{job.forge}</span>
      <span className="text-right font-mono text-[12px] tabular-nums text-txt-dim">
        {job.status === 'queued' ? '—' : duration(elapsed)}
      </span>
      <span className="text-right font-mono text-[11px] text-txt-faint">{relative(job.createdAt)}</span>
      <ChevronRight className="size-4 text-txt-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  )
}

export function JobLedger() {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const { data: jobs, isLoading } = useQuery(jobQueries.list())

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs?.length ?? 0 }
    for (const j of jobs ?? []) c[j.status] = (c[j.status] ?? 0) + 1
    return c
  }, [jobs])

  const visible = useMemo(
    () => (filter === 'all' ? (jobs ?? []) : (jobs ?? []).filter((j) => j.status === (filter as JobStatus))),
    [jobs, filter],
  )

  const active = counts.running ?? 0

  return (
    <>
      <PageHeader
        title="Jobs"
        below={
          <div className="flex items-center gap-1 border-b border-hairline bg-iron-900/60 px-6 py-2">
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
          {active > 0 ? <span className="text-ember">{active} forging</span> : <span>all forges cool</span>}
          <span className="mx-2 text-hairline">│</span>
          {counts.all} total
        </span>
        <NewJobDialog />
      </PageHeader>

      <div className="flex-1">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="border-b border-hairline px-6 py-4">
              <Skeleton className="h-9 w-full bg-iron-800" />
            </div>
          ))}

        {!isLoading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-24">
            <p className="text-[14px] text-txt-dim">Nothing in the fire.</p>
            <p className="font-mono text-[12px] text-txt-faint">No jobs match this filter.</p>
          </div>
        )}

        {visible.map((job, i) => (
          <JobRow key={job.id} job={job} index={i} onOpen={() => setSelected(job.id)} />
        ))}
      </div>

      <JobDetailSheet jobId={selected} onClose={() => setSelected(null)} />
    </>
  )
}
