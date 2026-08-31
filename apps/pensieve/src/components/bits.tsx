import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cn, LINEAR_ISSUE } from '#/lib/utils'
import type { JournalStatus } from '#/server/workspace'

export function PageTitle({ kicker, title, aside }: { kicker?: ReactNode; title: ReactNode; aside?: ReactNode }) {
  return (
    <header className="rise mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-rule pb-4">
      <div>
        {kicker && <p className="kicker mb-2">{kicker}</p>}
        <h1 className="display text-[34px] leading-none sm:text-[40px]">{title}</h1>
      </div>
      {aside && <div className="text-[13px] text-ink-dim">{aside}</div>}
    </header>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rise rounded-md border border-dashed border-rule px-6 py-10 text-center">
      <p className="display text-[22px] italic text-ink-dim">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[14px] text-ink-faint">{children}</div>}
    </div>
  )
}

const STATUS_CLASS: Record<JournalStatus | 'hold', string> = {
  decided: 'text-st-decided border-st-decided/40',
  implemented: 'text-st-implemented border-st-implemented/40',
  documented: 'text-st-documented border-st-documented/40',
  superseded: 'text-st-superseded border-st-superseded/40 line-through decoration-1',
  hold: 'text-st-hold border-st-hold/40',
}

export function StatusPill({ status, hold }: { status?: JournalStatus; hold?: string }) {
  const key = hold ? 'hold' : status
  if (!key) return null
  return (
    <span
      title={hold ? `hold: ${hold}` : undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]',
        STATUS_CLASS[key] ?? 'text-ink-dim border-rule',
      )}
    >
      {hold && <span className="size-1.5 rounded-full bg-st-hold" />}
      {key}
    </span>
  )
}

/** A frontmatter key/value, laid out as marginalia. */
export function Fact({ label, children }: { label: string; children?: ReactNode }) {
  if (children === undefined || children === null || children === '') return null
  return (
    <div className="flex flex-col gap-0.5 border-t border-rule-soft py-2 first:border-t-0">
      <dt className="kicker">{label}</dt>
      <dd className="text-[13.5px] leading-snug text-ink">{children}</dd>
    </div>
  )
}

export function TicketLink({ ticket }: { ticket?: string }) {
  if (!ticket || ticket === 'null') return <span className="italic text-ink-faint">unattributed</span>
  return (
    <a href={`${LINEAR_ISSUE}${ticket}`} target="_blank" rel="noreferrer" className="mono text-thread hover:underline">
      {ticket}
    </a>
  )
}

export function PrLink({ pr, url }: { pr?: string; url?: string }) {
  if (!pr || pr === 'null') return null
  const inner = <span className="mono">{pr}</span>
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="text-thread hover:underline">
      {inner}
    </a>
  ) : (
    inner
  )
}

export function FeatureLink({ feature, className }: { feature: string; className?: string }) {
  return (
    <Link to="/docs/$" params={{ _splat: feature }} className={cn('mono text-ink-dim hover:text-thread', className)}>
      {feature}
    </Link>
  )
}
