import { ChevronRight, GitBranch } from 'lucide-react'
import { blueprintLabel } from '@/features/blueprints/types'
import { repoLabel } from '@/features/repos/types'
import { duration, relative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { JobStatusChip } from './job-status-chip'
import { shortId } from '../types'
import type { Job } from '../types'

/** How long a job has run, or ran: from its start (else its queueing) to its finish (else now). */
export const elapsedOf = (job: Job) => (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt)

/**
 * One job in the ledger's full grid — a root job, the head of its group.
 * `joined` is set when follow-ups hang below it (CTD-183): the row gives up its
 * bottom border to the group and starts the tree's rail at its status dot.
 */
export function JobRow({
  job,
  onOpen,
  index,
  joined = false,
}: {
  job: Job
  onOpen: () => void
  index: number
  joined?: boolean
}) {
  const running = job.status === 'running'

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${Math.min(index, 12) * 26}ms` }}
      className={cn(
        'group animate-rise-in relative flex w-full flex-col gap-1.5 bg-iron-900 px-4 py-3 text-left transition-colors hover:bg-iron-850 lg:grid lg:grid-cols-[128px_minmax(0,1fr)_240px_104px_84px_100px_24px] lg:items-center lg:gap-4 lg:px-6 lg:py-3.5',
        !joined && 'border-b border-hairline',
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-0 h-full w-0.5 origin-top scale-y-0 bg-ember transition-transform duration-200 group-hover:scale-y-100',
          running && 'scale-y-100',
        )}
      />
      {joined && (
        // The rail's first stretch, from the status dot down to the row's edge.
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-[18.5px] top-[22px] w-px bg-iron-700 lg:left-[26.5px] lg:top-1/2"
        />
      )}
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
          {job.status === 'queued' ? '—' : duration(elapsedOf(job))}
        </span>
        <span className="font-mono text-[11px] text-txt-faint lg:text-right">{relative(job.createdAt)}</span>
      </span>

      <ChevronRight className="hidden size-4 text-txt-faint opacity-0 transition-opacity group-hover:opacity-100 lg:block" />
    </button>
  )
}
