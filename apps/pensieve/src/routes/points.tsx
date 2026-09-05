/**
 * /points — the sweep's Needs-you queue as a list you can act on (LIA-94). Every point
 * without a decision is listed in the report's own order; each can be ignored with a
 * reason, or — when it names a ticket — sent to Foundry. Both write one file under
 * `decisions/` and the point moves to the collapsed Decided list below, where a sent
 * point shows its Foundry job live until it settles.
 */
import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ChevronRight, EyeOff, LoaderCircle, Send } from 'lucide-react'
import { decidePoint, jobStatus, listPoints, sendPoint } from '#/lib/api'
import type { Verdict } from '#/lib/api'
import { Empty, PageTitle, TicketLink } from '#/components/bits'
import { cn, daysSince } from '#/lib/utils'
import type { Point, PointGroup } from '#/server/workspace'

export const Route = createFileRoute('/points')({
  loader: () => listPoints(),
  component: PointsPage,
})

const GROUPS: Array<{ key: PointGroup; label: string; hint: string }> = [
  { key: 'decide', label: 'Decide', hint: 'a call only you can make' },
  { key: 'verify', label: 'Verify', hint: 'the sweep thinks, you confirm' },
  { key: 'confirm', label: 'Confirm', hint: 'with someone' },
  { key: 'hold', label: 'On hold', hint: 'waiting on something outside' },
  { key: 'housekeeping', label: 'Housekeeping', hint: 'the blackboard itself' },
]

const shortId = (id: string) => id.slice(0, 8)

function age(firstSeen: string) {
  const n = daysSince(firstSeen)
  if (n === null) return ''
  return n <= 0 ? 'new' : `${n}d`
}

function when(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function PointsPage() {
  const { file, foundry } = Route.useLoaderData()
  if (!file) {
    return (
      <>
        <PageTitle kicker="Needs you" title="Points" />
        <Empty title="No points on file">
          The sweep writes <span className="mono">reports/points.json</span> each tick, one record per Needs-you item. Run{' '}
          <span className="mono">/sweep</span> in argus and this page fills in.
        </Empty>
      </>
    )
  }
  const open = file.points.filter((p) => !p.decision)
  const decided = file.points.filter((p) => p.decision).sort((a, b) => (a.decision!.at < b.decision!.at ? 1 : -1))
  const groups = GROUPS.map((g) => ({ ...g, points: open.filter((p) => p.group === g.key) })).filter((g) => g.points.length > 0)

  return (
    <>
      <PageTitle
        kicker="Needs you"
        title={open.length === 0 ? 'Nothing to decide' : `${open.length} point${open.length === 1 ? '' : 's'}`}
        aside={
          <span className="mono text-ink-faint" title={`tick ${file.tick}`}>
            {file.date}
            {decided.length > 0 && ` · ${decided.length} decided`}
          </span>
        }
      />

      {!foundry.configured && (
        <p className="rise mb-6 border-l-2 border-st-hold/50 pl-3 text-[13px] leading-snug text-ink-dim" style={{ animationDelay: '40ms' }}>
          <span className="font-semibold">Send is off.</span> {foundry.reason}. Ignore still works.
        </p>
      )}

      {open.length === 0 && (
        <Empty title="The queue is clear">
          Every point in the last tick has a decision. The next sweep will pick the files up from <span className="mono">decisions/</span>.
        </Empty>
      )}

      {groups.map((g, gi) => (
        <section key={g.key} className="rise mb-10" style={{ animationDelay: `${60 + gi * 40}ms` }}>
          <div className="mb-1 flex items-baseline justify-between border-b border-rule pb-1.5">
            <h2 className="display text-[22px] text-ink">
              {g.label}
              <span className="mono ml-2 text-ink-faint">{g.points.length}</span>
            </h2>
            <span className="hidden text-[12px] italic text-ink-faint sm:block">{g.hint}</span>
          </div>
          <ul className="divide-y divide-rule-soft">
            {g.points.map((p) => (
              <PointRow key={p.id} point={p} foundryOk={foundry.configured} foundryReason={foundry.reason} />
            ))}
          </ul>
        </section>
      ))}

      {decided.length > 0 && (
        <details className="rise group mt-4 border-t border-rule pt-4" style={{ animationDelay: '200ms' }}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-dim hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" strokeWidth={1.75} />
            <span className="display text-[19px]">Decided</span>
            <span className="mono text-ink-faint">{decided.length}</span>
            <span className="ml-auto hidden text-[12px] italic text-ink-faint sm:block">
              leaves the report on the next tick
            </span>
          </summary>
          <ul className="mt-3 divide-y divide-rule-soft">
            {decided.map((p) => (
              <DecidedRow key={p.id} point={p} foundryUrl={foundry.url} />
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

// ── an open point ──────────────────────────────────────────────────────────────

type Mode = 'idle' | 'ignore' | 'send'

function PointRow({ point, foundryOk, foundryReason }: { point: Point; foundryOk: boolean; foundryReason?: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [reason, setReason] = useState('')
  const [repo, setRepo] = useState(point.repo ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Verdict | null>(null)

  const open = (m: Mode) => {
    setMode(mode === m ? 'idle' : m)
    setError(null)
  }

  async function commit(run: () => Promise<Verdict>) {
    if (busy) return // a second click while the first is in flight is the same click
    setBusy(true)
    setError(null)
    try {
      const v = await run()
      if (v.ok) {
        // The loader re-reads points.json + decisions/, so the point lands in Decided.
        await router.invalidate()
        setMode('idle')
      } else setError(v)
    } finally {
      setBusy(false)
    }
  }

  const ignore = () => {
    if (!reason.trim()) return setError({ ok: false, error: 'say why — the reason is what the sweep records' })
    return commit(() => decidePoint({ data: { point: point.id, reason } }))
  }
  const send = () => {
    if (!repo.trim()) return setError({ ok: false, error: 'which repo? Foundry needs a tracked path or name' })
    return commit(() => sendPoint({ data: { point: point.id, repo } }))
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="display text-[19px] leading-tight text-ink">{point.subject}</span>
        {point.ticket && <TicketLink ticket={point.ticket} />}
        <span className="mono text-ink-faint">{age(point.firstSeen)}</span>
      </div>
      <p className="mt-1 text-[15px] leading-snug text-ink-dim">{point.ask}</p>
      {point.detail && <p className="mt-1 max-w-[72ch] text-[13.5px] leading-snug text-ink-faint">{point.detail}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <ActionButton active={mode === 'ignore'} onClick={() => open('ignore')} icon={EyeOff}>
          Ignore
        </ActionButton>
        {point.ticket &&
          (foundryOk ? (
            <ActionButton active={mode === 'send'} onClick={() => open('send')} icon={Send}>
              Send to Foundry
            </ActionButton>
          ) : (
            <span className="inline-flex cursor-not-allowed items-center gap-1.5 text-[13px] text-ink-faint" title={foundryReason}>
              <Send className="size-3.5" strokeWidth={1.75} />
              Send to Foundry
              <span className="italic">— {foundryReason?.split(' — ')[0] ?? 'off'}</span>
            </span>
          ))}
      </div>

      {mode === 'ignore' && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-l-2 border-thread-soft pl-3"
          onSubmit={(e) => {
            e.preventDefault()
            void ignore()
          }}
        >
          <label className="kicker" htmlFor={`reason-${point.id}`}>
            Why ignore it
          </label>
          <textarea
            id={`reason-${point.id}`}
            autoFocus
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="not worth a ticket / already handled in … / decided otherwise on …"
            className="w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-thread focus:outline-none"
          />
          <Confirm busy={busy} label="Ignore this point" onCancel={() => open('idle')} />
          <VerdictError v={error} />
        </form>
      )}

      {mode === 'send' && (
        <form
          className="mt-3 flex max-w-[60ch] flex-col gap-2 border-l-2 border-thread-soft pl-3"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label className="kicker" htmlFor={`repo-${point.id}`}>
            Repo the work lands in
          </label>
          <input
            id={`repo-${point.id}`}
            autoFocus
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="a repo Foundry tracks — its path, or its name"
            className="mono w-full rounded-md border border-rule bg-paper-2/60 px-3 py-1.5 text-ink placeholder:text-ink-faint focus:border-thread focus:outline-none"
          />
          <p className="text-[12.5px] leading-snug text-ink-faint">
            Foundry composes the brief from <span className="mono">{point.ticket}</span> and claims it in Linear. The idempotency key is the
            point id, so this cannot queue twice.
          </p>
          <Confirm busy={busy} label={`Send ${point.ticket}`} onCancel={() => open('idle')} />
          <VerdictError v={error} />
        </form>
      )}
    </li>
  )
}

function ActionButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Send
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 text-[13px] transition-colors', active ? 'text-ink underline underline-offset-4' : 'text-thread hover:underline')}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {children}
    </button>
  )
}

function Confirm({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1 text-[13px] text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy && <LoaderCircle className="size-3.5 animate-spin" />}
        {label}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="text-[13px] text-ink-faint hover:text-ink disabled:opacity-50">
        cancel
      </button>
    </div>
  )
}

function VerdictError({ v }: { v: Verdict | null }) {
  if (!v || v.ok) return null
  return (
    <p className="text-[13px] leading-snug text-st-hold">
      {v.status ? <span className="mono mr-1.5">{v.status}</span> : null}
      {v.error}
      {v.job && (
        <>
          {' '}
          — held by job <span className="mono">{shortId(v.job.id)}</span> ({v.job.status})
        </>
      )}
    </p>
  )
}

// ── a decided point ────────────────────────────────────────────────────────────

function DecidedRow({ point, foundryUrl }: { point: Point; foundryUrl: string }) {
  const d = point.decision!
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]',
            d.action === 'sent' ? 'border-st-implemented/40 text-st-implemented' : 'border-st-superseded/40 text-st-superseded',
          )}
        >
          {d.action}
        </span>
        <span className={cn('display text-[17px] leading-tight', d.action === 'ignored' ? 'text-ink-dim' : 'text-ink')}>{point.subject}</span>
        {point.ticket && <TicketLink ticket={point.ticket} />}
        <span className="mono ml-auto text-ink-faint">{when(d.at)}</span>
      </div>
      {d.reason && <p className="mt-1 text-[13.5px] italic leading-snug text-ink-dim">{d.reason}</p>}
      {d.action === 'sent' && d.job && <JobLine id={d.job.id} url={d.job.url || `${foundryUrl}/`} />}
    </li>
  )
}

/** The job's status from Foundry, refreshed every few seconds until it settles. */
function JobLine({ id, url }: { id: string; url: string }) {
  const q = useQuery({
    queryKey: ['job', id],
    queryFn: () => jobStatus({ data: id }),
    refetchInterval: (query) => {
      const d = query.state.data
      return d?.ok && (d.job.status === 'queued' || d.job.status === 'running') ? 5_000 : false
    },
  })
  const d = q.data
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-dim">
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-thread hover:underline">
        job <span className="mono">{shortId(id)}</span>
        <ArrowUpRight className="size-3" />
      </a>
      {!d && <span className="text-ink-faint">{q.isError ? 'status unavailable' : 'looking…'}</span>}
      {d && !d.ok && (
        <span className="text-st-hold">
          {d.status ? <span className="mono mr-1">{d.status}</span> : null}
          {d.error}
        </span>
      )}
      {d?.ok && (
        <>
          <JobStatusPill status={d.job.status} live={d.job.status === 'queued' || d.job.status === 'running'} />
          {d.job.step && (d.job.status === 'queued' || d.job.status === 'running') && <span className="mono text-ink-faint">{d.job.step}</span>}
          {d.job.prUrl && (
            <a href={d.job.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-thread hover:underline">
              PR <ArrowUpRight className="size-3" />
            </a>
          )}
          {d.job.status === 'failed' && d.job.exitCode !== undefined && <span className="mono text-ink-faint">exit {d.job.exitCode}</span>}
        </>
      )}
    </p>
  )
}

const JOB_CLASS: Record<string, string> = {
  queued: 'text-ink-faint border-rule',
  running: 'text-st-implemented border-st-implemented/40',
  succeeded: 'text-st-documented border-st-documented/40',
  failed: 'text-st-hold border-st-hold/40',
  cancelled: 'text-st-superseded border-st-superseded/40',
}

function JobStatusPill({ status, live }: { status: string; live: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]', JOB_CLASS[status] ?? 'text-ink-dim border-rule')}>
      {live && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  )
}

