import { cn } from '@/shared/lib/utils'
import type { JobStatus } from '../types'

const TONE: Record<JobStatus, { dot: string; text: string; label: string }> = {
  queued: { dot: 'bg-steel', text: 'text-steel', label: 'queued' },
  running: { dot: 'bg-slag animate-ember-pulse', text: 'text-slag', label: 'forging' },
  pr_ready: { dot: 'bg-ember', text: 'text-ember', label: 'pr ready' },
  succeeded: { dot: 'bg-quench', text: 'text-quench', label: 'succeeded' },
  failed: { dot: 'bg-crack', text: 'text-crack', label: 'failed' },
  cancelled: { dot: 'bg-txt-faint', text: 'text-txt-faint', label: 'cancelled' },
}

export function JobStatusChip({ status, className }: { status: JobStatus; className?: string }) {
  const tone = TONE[status]
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} />
      <span className={cn('font-mono text-[11px] font-medium tracking-wide', tone.text)}>{tone.label}</span>
    </span>
  )
}
