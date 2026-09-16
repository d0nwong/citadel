import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronRight, ExternalLink, GitBranch, MessageSquare, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { JobStatusChip } from './job-status-chip'
import { Collapse } from '@/shared/components/collapse'
import { cancelJob, followUpJob, rerunJob } from '../api'
import { jobQueries } from '../queries'
import { forgeQueries } from '@/features/forges/queries'
import { clockTime, duration } from '@/shared/lib/format'
import { blueprintLabel, stepsSummary } from '@/features/blueprints/types'
import { repoDestination, repoLabel } from '@/features/repos/types'
import { cn } from '@/shared/lib/utils'
import { shortId } from '../types'
import type { FollowUp, LogLine, LogStream } from '../types'
import type { BlueprintStep } from '@/features/blueprints/types'

/** What a follow-up answers, as the header says it. */
const FOLLOW_UP_WORD: Record<FollowUp, string> = { review: 'review', check: 'failing check', merge: 'base merge' }

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

/** The receiver's host only — the full URL (which may carry a secret path) stays in the title attribute. */
function callbackHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="kicker">{label}</div>
      <div className="font-mono text-[12px] text-txt">{children}</div>
    </div>
  )
}

export function JobDetailSheet({
  jobId,
  onClose,
  onOpenJob,
}: {
  jobId: string | null
  onClose: () => void
  onOpenJob?: (newJobId: string) => void
}) {
  const qc = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const { data: job, isFetched } = useQuery({
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

  const rerun = useMutation({
    mutationFn: (id: string) => rerunJob({ data: id }),
    onSuccess: (newJob, sourceId) => {
      qc.invalidateQueries({ queryKey: jobQueries.all })
      qc.invalidateQueries({ queryKey: forgeQueries.all })
      toast.success(`Job ${shortId(newJob.id)} queued`, {
        description: `rerun of ${shortId(sourceId)}`,
      })
      onOpenJob?.(newJob.id)
    },
  })

  const followUp = useMutation({
    mutationFn: (id: string) => followUpJob({ data: id }),
    onSuccess: (newJob, sourceId) => {
      qc.invalidateQueries({ queryKey: jobQueries.all })
      qc.invalidateQueries({ queryKey: forgeQueries.all })
      toast.success(`Job ${shortId(newJob.id)} queued`, {
        description: `addressing PR comments of ${shortId(sourceId)}`,
      })
      onOpenJob?.(newJob.id)
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

  // Long tasks fold away by default so the log keeps its room, most of all on mobile.
  const [taskOpen, setTaskOpen] = useState(false)
  useEffect(() => setTaskOpen(false), [jobId])
  const taskCollapsible = job ? job.task.length > 140 || job.task.includes('\n') : false

  // Same idea for the metadata grid: folded until asked for, so the log leads.
  const [metaOpen, setMetaOpen] = useState(false)
  useEffect(() => setMetaOpen(false), [jobId])

  const live = job?.status === 'running' || job?.status === 'queued'
  const elapsed = job ? (job.finishedAt ?? Date.now()) - (job.startedAt ?? job.createdAt) : 0

  return (
    <Sheet open={jobId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-hairline bg-iron-850 p-0 sm:max-w-[min(880px,92vw)]"
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
                {job.sourceJobId && (
                  // The way back up to the group's root (CTD-183), in the same sheet.
                  <button
                    type="button"
                    onClick={() => onOpenJob?.(job.sourceJobId!)}
                    title={`Open job ${job.sourceJobId}`}
                    className="font-mono text-[11px] text-txt-faint underline-offset-2 transition-colors hover:text-ember-soft hover:underline"
                  >
                    follow-up of {shortId(job.sourceJobId)}
                    {job.followUp && ` · ${FOLLOW_UP_WORD[job.followUp]}`}
                  </button>
                )}
                {job.callbackUrl && (
                  <span className="font-mono text-[11px] text-txt-faint" title={job.callbackUrl}>
                    notifies {callbackHost(job.callbackUrl)}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-txt-dim">{duration(elapsed)}</span>
              </div>
              <div className="space-y-1.5">
                {/* Two lines stay showing while folded, so the full task grows
                    out of the title instead of replacing it. */}
                <Collapse
                  open={taskOpen || !taskCollapsible}
                  peek={taskCollapsible ? '2.75rem' : undefined}
                  className={cn(
                    taskCollapsible &&
                      (taskOpen
                        ? 'scrollbar-thin max-h-[30dvh] overflow-y-auto'
                        : '[mask-image:linear-gradient(to_bottom,#000_80%,transparent)]'),
                  )}
                >
                  <SheetTitle className="whitespace-pre-wrap break-words text-[16px] font-semibold leading-snug tracking-tight">
                    {job.task}
                  </SheetTitle>
                </Collapse>
                {taskCollapsible && (
                  <button
                    type="button"
                    onClick={() => setTaskOpen((v) => !v)}
                    aria-expanded={taskOpen}
                    className="kicker flex items-center gap-1 text-txt-faint transition-colors hover:text-ember-soft"
                  >
                    <ChevronRight className={cn('size-3 transition-transform duration-200 ease-out', taskOpen && 'rotate-90')} />
                    {taskOpen ? 'Hide task' : 'Show full task'}
                  </button>
                )}
              </div>
              <SheetDescription className="sr-only">Job detail and live log output</SheetDescription>
            </SheetHeader>

            <button
              type="button"
              onClick={() => setMetaOpen((v) => !v)}
              aria-expanded={metaOpen}
              className="flex w-full items-center gap-2 border-y border-hairline bg-iron-900/50 px-5 py-2.5 text-left transition-colors hover:bg-iron-900 sm:px-6"
            >
              <ChevronRight className={cn('size-3 shrink-0 text-txt-faint transition-transform duration-200 ease-out', metaOpen && 'rotate-90')} />
              <span className="kicker shrink-0">Details</span>
              <span className="ml-auto truncate font-mono text-[11px] text-txt-dim">{repoLabel(job.repo)}</span>
            </button>
            <Collapse open={metaOpen}>
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 border-b border-hairline bg-iron-900/50 px-5 py-4 sm:gap-x-6 sm:px-6">
                <Meta label="Repo">
                  <span className="block truncate">{repoLabel(job.repo)}</span>
                  <span className="mt-0.5 block text-[10px] text-txt-faint">{repoDestination(job.repo)}</span>
                </Meta>
                <Meta label="Forge">
                  {job.forge}
                  {job.blueprint && (
                    <span className="mt-0.5 block truncate text-[10px] text-txt-faint" title={stepsSummary(job.blueprint.steps)}>
                      {blueprintLabel(job.blueprint)} · {job.blueprint.steps.length} steps
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
            </Collapse>

            <div className="flex items-center justify-between px-5 py-3 sm:px-6">
              <div className="kicker">Output</div>
              {live ? (
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
              ) : (
                <div className="flex items-center gap-1">
                  {job.prUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => followUp.mutate(job.id)}
                      disabled={followUp.isPending}
                      className="h-7 gap-1.5 text-[12px] text-txt-dim hover:bg-ember/10 hover:text-ember"
                    >
                      <MessageSquare className="size-3" />
                      Address PR comments
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => rerun.mutate(job.id)}
                    disabled={rerun.isPending}
                    className="h-7 gap-1.5 text-[12px] text-txt-dim hover:bg-ember/10 hover:text-ember"
                  >
                    <RotateCcw className="size-3" />
                    Rerun as new job
                  </Button>
                </div>
              )}
            </div>

            <div
              ref={logRef}
              className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t border-hairline bg-iron-950/60 px-5 font-mono text-[11.5px] leading-[1.7] sm:px-6 sm:text-[12px]"
            >
              {/* Padding lives here, not on the scroller: a sticky header pins
                  below the scroll container's own padding-top, which would leave
                  a band of log lines scrolling past above it. */}
              <div className="py-4">
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
                    <div key={gi} className="my-2">
                      {/* No card around a step, just a bar its lines sit under. It is
                          sticky within this group, so it stays put exactly as long as
                          that step's lines are on screen, and bleeds into the pane's
                          own px-5/sm:px-6 gutters to span the full width. */}
                      <button
                        type="button"
                        onClick={() => setToggled((t) => ({ ...t, [index]: !open }))}
                        aria-expanded={open}
                        className="sticky top-0 z-10 -mx-5 flex w-[calc(100%+2.5rem)] items-center gap-2.5 border-y border-hairline bg-iron-900 px-5 py-2 text-left transition-colors hover:bg-iron-850 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6"
                      >
                        <ChevronRight className={cn('size-3.5 shrink-0 text-txt-faint transition-transform duration-200 ease-out', open && 'rotate-90')} />
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
                      {/* No horizontal padding: a step's lines keep the same
                          gutter and left edge as the unlabelled host lines. */}
                      <Collapse open={open}>
                        <div className="py-2">
                          {g.lines.map((l, i) => (
                            <div key={i} className="flex gap-3">
                              <span className="hidden w-[62px] shrink-0 select-none text-txt-faint/60 sm:block">{clockTime(l.t)}</span>
                              <span className={cn('whitespace-pre-wrap break-words', STREAM_TONE[l.stream])}>{l.text}</span>
                            </div>
                          ))}
                        </div>
                      </Collapse>
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
            </div>
          </>
        )}
        {/* A parent can be purged while its follow-ups stay, so "follow-up of …" may lead nowhere. */}
        {jobId !== null && isFetched && !job && (
          <SheetHeader className="space-y-2 px-5 pt-6 text-left sm:px-6">
            <SheetTitle className="text-[16px] font-semibold tracking-tight">Job not found</SheetTitle>
            <SheetDescription className="font-mono text-[12px] text-txt-faint">
              {shortId(jobId)} is no longer in the ledger — it was purged.
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
