import { Link, useRouterState } from '@tanstack/react-router'
import { BookOpenText, CircleDot, Inbox, MessagesSquare, ScrollText } from 'lucide-react'
import { cn } from '#/lib/utils'

const NAV = [
  { to: '/', label: 'Inbox', icon: Inbox, hint: 'latest sweep' },
  { to: '/points', label: 'Points', icon: CircleDot, hint: 'send / ignore' },
  { to: '/journal', label: 'Journal', icon: ScrollText, hint: 'one entry per landing' },
  { to: '/digests', label: 'Digests', icon: MessagesSquare, hint: '#dev-team, daily' },
  { to: '/docs', label: 'Docs', icon: BookOpenText, hint: 'product + arch' },
] as const

function Basin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <circle cx="14" cy="15" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 15c3-3 9-3 12 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M14 3v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />
    </svg>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px] flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-rule lg:sticky lg:top-0 lg:h-dvh lg:w-[220px] lg:border-b-0 lg:border-r">
        <Link to="/" className="flex items-center gap-2.5 px-5 pb-4 pt-6 text-ink">
          <Basin className="size-7 text-thread" />
          <span className="display text-[22px] italic leading-none">Pensieve</span>
        </Link>
        <nav className="flex gap-0.5 overflow-x-auto px-3 pb-3 lg:flex-col lg:pb-0">
          {NAV.map(({ to, label, icon: Icon, hint }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'group relative flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-[15px] transition-colors',
                  active ? 'bg-paper-2 text-ink' : 'text-ink-dim hover:bg-paper-2/60 hover:text-ink',
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 hidden h-4 w-0.5 -translate-y-1/2 rounded-r bg-thread lg:block" />}
                <Icon className={cn('size-4', active ? 'text-thread' : 'text-ink-faint group-hover:text-ink-dim')} strokeWidth={1.75} />
                <span>{label}</span>
                <span className="ml-auto hidden font-mono text-[10px] text-ink-faint lg:block">{hint}</span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto hidden px-5 py-4 lg:block">
          <p className="kicker">read-only, but one</p>
          <p className="mt-1 text-[12px] leading-snug text-ink-faint">
            The sweep writes the blackboard; this room only reads it — except{' '}
            <span className="mono">decisions/</span>, where a verdict on a point lands.
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>
    </div>
  )
}
