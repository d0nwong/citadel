import { ChevronRight } from 'lucide-react'
import { Collapse } from '@/shared/components/collapse'
import { duration, relative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { JobRow, elapsedOf } from './job-row'
import { JobStatusChip } from './job-status-chip'
import { shortId } from '../types'
import type { FollowUp, Job, JobGroup } from '../types'

const TRIGGER: Record<FollowUp, string> = { review: 'review', check: 'failing check' }

/** What a follow-up answered, in the ledger's words; rows from before CTD-170 carry no kind. */
export const triggerLabel = (job: Job) => (job.followUp ? TRIGGER[job.followUp] : 'follow-up')

/**
 * One ledger entry (CTD-183): the root job's row as ever, and — once anything
 * followed it up — a strip under it that folds the follow-ups away. The strip
 * is its own button beside the row's, never inside it, and says in words what
 * the newest follow-up is doing, so the state never rests on the dot's colour.
 */
export function JobGroupItem({
  group,
  index,
  open,
  onToggle,
  onOpen,
}: {
  group: JobGroup
  index: number
  open: boolean
  onToggle: () => void
  onOpen: (jobId: string) => void
}) {
  const { followUps } = group
  const latest = followUps.at(-1)
  const listId = `follow-ups-${group.id}`

  return (
    <div>
      <JobRow job={group} index={index} onOpen={() => onOpen(group.id)} />
      {latest && (
        <>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={listId}
            className="flex w-full min-w-0 items-center gap-2.5 border-b border-hairline bg-iron-900/60 px-4 py-2 text-left transition-colors hover:bg-iron-850 lg:px-6"
          >
            <ChevronRight
              aria-hidden
              className={cn('size-3 shrink-0 text-txt-faint transition-transform duration-200 ease-out', open && 'rotate-90')}
            />
            <span className="kicker shrink-0">
              {followUps.length} follow-up{followUps.length === 1 ? '' : 's'}
            </span>
            <span aria-hidden className="text-hairline">
              │
            </span>
            <span className="hidden shrink-0 font-mono text-[11px] text-txt-faint sm:inline">latest {triggerLabel(latest)}</span>
            <JobStatusChip status={latest.status} className="min-w-0" />
            <span className="ml-auto shrink-0 font-mono text-[11px] text-txt-faint">{relative(latest.createdAt)}</span>
          </button>
          <Collapse open={open}>
            <ul id={listId} aria-label={`Follow-ups of job ${shortId(group.id)}`} className="ml-4 border-l border-hairline lg:ml-9">
              {followUps.map((f) => (
                <li key={f.id}>
                  <FollowUpRow job={f} onOpen={() => onOpen(f.id)} />
                </li>
              ))}
            </ul>
          </Collapse>
        </>
      )}
    </div>
  )
}

/**
 * A follow-up, compact: repo, branch and task are its root's, so the row keeps
 * only what differs — status, trigger, id, time. At `lg` the right-hand columns
 * share the root grid's widths (84px, 100px, 24px), so durations line up.
 */
function FollowUpRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const running = job.status === 'running'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full items-center gap-3 border-b border-hairline bg-iron-950/40 py-2.5 pl-4 pr-4 text-left transition-colors hover:bg-iron-850 lg:grid lg:grid-cols-[128px_minmax(0,1fr)_84px_100px_24px] lg:gap-4 lg:pr-6"
    >
      <span
        className={cn(
          'absolute left-0 top-0 h-full w-0.5 origin-top scale-y-0 bg-ember transition-transform duration-200 group-hover:scale-y-100',
          running && 'scale-y-100',
        )}
      />
      <JobStatusChip status={job.status} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[12.5px] text-txt-dim">{triggerLabel(job)}</span>
        <span className="shrink-0 font-mono text-[11px] text-txt-faint">{shortId(job.id)}</span>
      </span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-txt-dim lg:text-right">
        {job.status === 'queued' ? '—' : duration(elapsedOf(job))}
      </span>
      <span className="hidden shrink-0 font-mono text-[11px] text-txt-faint sm:inline lg:text-right">{relative(job.createdAt)}</span>
      <ChevronRight className="hidden size-4 text-txt-faint opacity-0 transition-opacity group-hover:opacity-100 lg:block" />
    </button>
  )
}
