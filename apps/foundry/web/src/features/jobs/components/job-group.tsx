import { ChevronRight } from 'lucide-react'
import { Collapse } from '@/shared/components/collapse'
import { duration, relative } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import { JobRow, elapsedOf } from './job-row'
import { JobStatusChip } from './job-status-chip'
import { shortId } from '../types'
import type { FollowUp, Job, JobGroup } from '../types'

const KIND: Record<FollowUp, string> = { review: 'review', check: 'failing check' }

/** What a follow-up answered, in the ledger's words; undefined on rows from before CTD-170. */
const kindLabel = (job: Job) => (job.followUp ? KIND[job.followUp] : undefined)

/**
 * One branch of the group's tree: the rail coming down from the parent's
 * status dot, and an elbow into this branch. The last branch ends the rail at
 * its elbow; a running one lights its elbow, ember being for what is hot.
 */
function Branch({ last, hot = false }: { last: boolean; hot?: boolean }) {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-[18.5px] w-3 lg:left-[26.5px]">
      <span className={cn('absolute left-0 top-0 w-px bg-iron-700', last ? 'h-1/2' : 'h-full')} />
      <span className={cn('absolute left-0 top-1/2 h-px w-3', hot ? 'bg-ember' : 'bg-iron-700')} />
    </span>
  )
}

/**
 * One ledger entry (CTD-183). A job nobody followed up is its plain row. Once
 * something has, the job and its follow-ups are one block — one background,
 * one border at the bottom — and a rail runs from the job's status dot to a
 * strip naming them and, opened, to each follow-up, so what belongs to whom
 * reads from the shape before any label. The strip is its own button beside
 * the row's, never inside it, and says in words what the newest follow-up is
 * doing, so the state never rests on the dot's colour.
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
  if (!latest) return <JobRow job={group} index={index} onOpen={() => onOpen(group.id)} />

  const listId = `follow-ups-${group.id}`
  return (
    <div className="border-b border-hairline bg-iron-900">
      <JobRow job={group} index={index} joined onOpen={() => onOpen(group.id)} />
      <div className="relative">
        <Branch last={!open} hot={latest.status === 'running' && !open} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full min-w-0 items-center gap-2.5 py-2 pl-10 pr-4 text-left transition-colors hover:bg-iron-850 lg:pl-12 lg:pr-6"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3 shrink-0 text-txt-faint transition-transform duration-200 ease-out', open && 'rotate-90')}
          />
          <span className="kicker shrink-0">
            {followUps.length} follow-up{followUps.length === 1 ? '' : 's'}
            <span className="hidden sm:inline"> on this PR</span>
          </span>
          <span aria-hidden className="text-hairline">
            │
          </span>
          <span className="hidden shrink-0 font-mono text-[11px] text-txt-faint sm:inline">
            latest {kindLabel(latest) ?? 'follow-up'}
          </span>
          <JobStatusChip status={latest.status} className="min-w-0" />
          <span className="ml-auto shrink-0 font-mono text-[11px] text-txt-faint">{relative(latest.createdAt)}</span>
        </button>
      </div>
      <Collapse open={open}>
        <ul id={listId} aria-label={`Follow-ups of job ${shortId(group.id)}`}>
          {followUps.map((f, i) => (
            <li key={f.id} className="relative border-t border-hairline-soft">
              <Branch last={i === followUps.length - 1} hot={f.status === 'running'} />
              <FollowUpRow job={f} onOpen={() => onOpen(f.id)} />
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  )
}

/**
 * A follow-up, compact: repo, branch and task are its parent's, so the row
 * keeps what differs — status, what it answered, id, times — indented onto the
 * parent's rail. At `lg` the right-hand columns share the parent grid's widths
 * (84px, 100px, 24px), so durations and times line up down the block.
 */
function FollowUpRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const kind = kindLabel(job)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full min-w-0 items-center gap-3 py-2.5 pl-10 pr-4 text-left transition-colors hover:bg-iron-850 lg:grid lg:grid-cols-[minmax(0,1fr)_84px_100px_24px] lg:gap-4 lg:pl-12 lg:pr-6"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <JobStatusChip status={job.status} className="shrink-0" />
        <span className="truncate text-[12.5px] text-txt-dim">
          follow-up{kind && <span className="text-txt-faint"> · {kind}</span>}
        </span>
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
