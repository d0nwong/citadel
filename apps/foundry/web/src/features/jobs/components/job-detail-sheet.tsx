import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { JobStatusChip } from './job-status-chip'
import { cancelJob } from '../api'
import { jobQueries } from '../queries'
import { forgeQueries } from '@/features/forges/queries'
import { clockTime, duration, tildePath } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'
import type { LogStream } from '../types'

const STREAM_TONE: Record<LogStream, string> = {
  sys: 'text-ember-soft',
  out: 'text-txt-dim',
  tool: 'text-steel',
  err: 'text-crack',
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="kicker">{label}</div>
      <div className="font-mono text-[12px] text-txt">{children}</div>
    </div>
  )
}

export function JobDetailSheet({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const { data: job } = useQuery({
    ...jobQueries.detail(jobId!),
    enabled: jobId !== null,
  })

  const cancel = useMutation({
    mutationFn: cancelJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: jobQueries.all })
      qc.invalidateQueries({ queryKey: forgeQueries.all })
    },
  })

  const lineCount = job?.logs.length ?? 0
  useEffect(() => {
    if (job?.status === 'running') logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lineCount, job?.status])

  const live = job?.status === 'running' || job?.status === 'queued'
  const elapsed = job ? (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt) : 0

  return (
    <Sheet open={jobId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-hairline bg-iron-850 p-0 sm:max-w-[620px]"
      >
        {job && (
          <>
            <div className="h-px w-full bg-gradient-to-r from-ember via-ember-deep to-transparent" />
            <SheetHeader className="space-y-3 px-6 pb-5 pt-5 text-left">
              <div className="flex items-center gap-3 pr-8">
                <JobStatusChip status={job.status} />
                <span className="font-mono text-[11px] text-txt-faint">{job.id}</span>
                <span className="ml-auto font-mono text-[11px] text-txt-dim">{duration(elapsed)}</span>
              </div>
              <SheetTitle className="text-[16px] font-semibold leading-snug tracking-tight">{job.task}</SheetTitle>
              <SheetDescription className="sr-only">Job detail and live log output</SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-hairline bg-iron-900/50 px-6 py-4">
              <Meta label="Repo">{tildePath(job.repoPath)}</Meta>
              <Meta label="Forge">{job.forge}</Meta>
              <Meta label="Branch">
                <span className="flex items-center gap-1.5">
                  <GitBranch className="size-3 text-txt-faint" />
                  {job.branch}
                  <span className="text-txt-faint">← {job.baseBranch}</span>
                </span>
              </Meta>
              <Meta label="Diff">
                {job.diff ? (
                  <span>
                    {job.diff.files} files <span className="text-quench">+{job.diff.additions}</span>{' '}
                    <span className="text-crack">−{job.diff.deletions}</span>
                  </span>
                ) : (
                  <span className="text-txt-faint">—</span>
                )}
              </Meta>
            </div>

            <div className="flex items-center justify-between px-6 py-3">
              <div className="kicker">Output</div>
              {live && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancel.mutate(job.id)}
                  disabled={cancel.isPending}
                  className="h-7 gap-1.5 text-[12px] text-txt-dim hover:bg-crack/10 hover:text-crack"
                >
                  <Ban className="size-3" />
                  Cancel job
                </Button>
              )}
            </div>

            <div
              ref={logRef}
              className="flex-1 overflow-y-auto border-t border-hairline bg-iron-950/60 px-6 py-4 font-mono text-[12px] leading-[1.7]"
            >
              {job.logs.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-[62px] shrink-0 select-none text-txt-faint/60">{clockTime(l.t)}</span>
                  <span className={cn('whitespace-pre-wrap break-words', STREAM_TONE[l.stream])}>{l.text}</span>
                </div>
              ))}
              {job.status === 'running' && (
                <div className="mt-1 flex gap-3">
                  <span className="w-[62px] shrink-0" />
                  <span className="inline-block h-3.5 w-2 animate-ember-pulse bg-ember" />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
