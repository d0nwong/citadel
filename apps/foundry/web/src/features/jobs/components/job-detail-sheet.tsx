import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronRight, ExternalLink, GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { JobStatusChip } from './job-status-chip'
import { cancelJob } from '../api'
import { jobQueries } from '../queries'
import { forgeQueries } from '@/features/forges/queries'
import { clockTime, duration } from '@/shared/lib/format'
import { stepsSummary } from '@/features/blueprints/types'
import { repoDestination, repoLabel } from '@/features/repos/types'
import { cn } from '@/shared/lib/utils'
import { shortId } from '../types'
import type { LogLine, LogStream } from '../types'
import type { BlueprintStep } from '@/features/blueprints/types'

const STREAM_TONE: Record<LogStream, string> = {
  sys: 'text-ember-soft',
  out: 'text-txt-dim',
  tool: 'text-steel',
  err: 'text-crack',
}

/**
 * Consecutive lines from one blueprint step, or a run of unlabelled host
 * lines (`step` undefined). The runner prefixes every line a step posts with
 * `[name] `; that prefix is the grouping key here and is stripped for display.
 * Only names the job's blueprint actually has count — an agent line that
 * happens to start with brackets must not open a section.
 */
interface LogGroup {
  step?: { index: number; def: BlueprintStep }
  lines: Array<LogLine>
}

function groupLogs(logs: Array<LogLine>, steps: Array<BlueprintStep> | undefined): Array<LogGroup> {
  const byName = new Map((steps ?? []).map((def, i) => [def.name, { index: i + 1, def }]))
  const groups: Array<LogGroup> = []
  for (const line of logs) {
    const m = /^\[([^\]]+)\] /.exec(line.text)
    const step = m ? byName.get(m[1]) : undefined
    const text = step ? line.text.slice(m![0].length) : line.text
    const last = groups[groups.length - 1]
    if (last && last.step?.index === step?.index) last.lines.push({ ...line, text })
    else groups.push({ step, lines: [{ ...line, text }] })
  }
  return groups
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
  const groups = useMemo(() => (job ? groupLogs(job.logs, job.blueprint?.steps) : []), [job])
  const stepCount = job?.blueprint?.steps.length ?? 0
  // Which step sections the user has toggled, by step index. Untouched ones
  // fall back to "open while it is the step being run, folded otherwise".
  const [toggled, setToggled] = useState<Record<number, boolean>>({})
  useEffect(() => setToggled({}), [jobId])
  const lastStepIndex = [...groups].reverse().find((g) => g.step)?.step?.index
  const isOpen = (index: number) => toggled[index] ?? (job?.status === 'running' && index === lastStepIndex)
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
                <span className="font-mono text-[11px] text-txt-faint" title={job.id}>{shortId(job.id)}</span>
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
              <Meta label="Forge">
                {job.forge}
                {job.blueprint && (
                  <span className="mt-0.5 block truncate text-[10px] text-txt-faint" title={stepsSummary(job.blueprint.steps)}>
                    {job.blueprint.name} · {job.blueprint.steps.length} steps
                  </span>
                )}
              </Meta>
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
              {groups.map((g, gi) => {
                if (!g.step) {
                  return g.lines.map((l, i) => (
                    <div key={`${gi}-${i}`} className="flex gap-3">
                      <span className="hidden w-[62px] shrink-0 select-none text-txt-faint/60 sm:block">{clockTime(l.t)}</span>
                      <span className={cn('whitespace-pre-wrap break-words', STREAM_TONE[l.stream])}>{l.text}</span>
                    </div>
                  ))
                }
                const { index, def } = g.step
                const open = isOpen(index)
                const first = g.lines[0].t
                const last = g.lines[g.lines.length - 1].t
                const stepRunning = job.status === 'running' && index === lastStepIndex
                return (
                  <div key={gi} className="my-1.5 rounded-md border border-hairline bg-iron-900/70">
                    <button
                      type="button"
                      onClick={() => setToggled((t) => ({ ...t, [index]: !open }))}
                      aria-expanded={open}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-iron-850"
                    >
                      <ChevronRight className={cn('size-3.5 shrink-0 text-txt-faint transition-transform', open && 'rotate-90')} />
                      <span className="kicker shrink-0 text-ember-soft">
                        step {index}/{stepCount}
                      </span>
                      <span className="truncate text-[12px] font-medium text-txt">{def.name}</span>
                      <span className="shrink-0 text-[11px] text-txt-dim">
                        {def.model}
                        {def.effort && ` · ${def.effort}`}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-txt-faint">
                        {stepRunning && <span className="inline-block size-1.5 animate-ember-pulse rounded-full bg-ember" />}
                        <span>{g.lines.length} lines</span>
                        <span>{duration(Math.max(last - first, stepRunning ? Date.now() - first : 0))}</span>
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-hairline px-3 py-2">
                        {g.lines.map((l, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="hidden w-[62px] shrink-0 select-none text-txt-faint/60 sm:block">{clockTime(l.t)}</span>
                            <span className={cn('whitespace-pre-wrap break-words', STREAM_TONE[l.stream])}>{l.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
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
