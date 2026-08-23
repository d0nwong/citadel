import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ExternalLink, GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { JobStatusChip } from './job-status-chip'
import { cancelJob } from '../api'
import { jobQueries } from '../queries'
import { forgeQueries } from '@/features/forges/queries'
import { clockTime, duration } from '@/shared/lib/format'
import { repoDestination, repoLabel } from '@/features/repos/types'
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
    mutationFn: (id: string) => cancelJob({ data: id }),
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
            <SheetHeader className="space-y-3 px-5 pb-5 pt-5 text-left sm:px-6">
              <div className="flex items-center gap-3 pr-8">
                <JobStatusChip status={job.status} />
                {job.status === 'running' && job.step && (
                  <span className="font-mono text-[11px] text-txt-dim">{job.step}</span>
                )}
                <span className="font-mono text-[11px] text-txt-faint">{job.id}</span>
                <span className="ml-auto font-mono text-[11px] text-txt-dim">{duration(elapsed)}</span>
              </div>
              <SheetTitle className="text-[16px] font-semibold leading-snug tracking-tight">{job.task}</SheetTitle>
              <SheetDescription className="sr-only">Job detail and live log output</SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-y border-hairline bg-iron-900/50 px-5 py-4 sm:gap-x-6 sm:px-6">
              <Meta label="Repo">
                <span className="block truncate">{repoLabel(job.repo)}</span>
                <span className="mt-0.5 block text-[10px] text-txt-faint">{repoDestination(job.repo)}</span>
              </Meta>
              <Meta label="Forge">{job.forge}</Meta>
              <Meta label="Branch">
                <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <GitBranch className="size-3 shrink-0 text-txt-faint" />
                    <span className="truncate">{job.branch}</span>
                  </span>
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
              {job.prUrl && (
                <div className="col-span-2">
                  <Meta label="Pull request">
                    <a
                      href={job.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-1.5 text-ember hover:underline"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      <span className="truncate">{job.prUrl.replace(/^https:\/\//, '')}</span>
                    </a>
                  </Meta>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 sm:px-6">
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
              className="flex-1 overflow-y-auto border-t border-hairline bg-iron-950/60 px-5 py-4 font-mono text-[11.5px] leading-[1.7] sm:px-6 sm:text-[12px]"
            >
              {job.logs.map((l, i) => (
                <div key={i} className="flex gap-3">
                  <span className="hidden w-[62px] shrink-0 select-none text-txt-faint/60 sm:block">{clockTime(l.t)}</span>
                  <span className={cn('whitespace-pre-wrap break-words', STREAM_TONE[l.stream])}>{l.text}</span>
                </div>
              ))}
              {job.status === 'running' && (
                <div className="mt-1 flex gap-3">
                  <span className="hidden w-[62px] shrink-0 sm:block" />
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
