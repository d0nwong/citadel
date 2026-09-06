import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { BookOpenText, CircleDot, Inbox, MenuIcon, MessageCircleQuestion, MessagesSquare, ScrollText, XIcon } from 'lucide-react'
import { cn } from '#/lib/utils'

// ── pull to refresh ────────────────────────────────────────────────────────────
//
// The blackboard changes under the app (the sweep writes a report, a digest lands), and
// every page reads it in its route loader. Dragging the page down from the top — a touch
// or a mouse — past the threshold re-runs the loaders (`router.invalidate()`), the same
// as a reload without losing the scroll position or the shell. Off on the chat page: its
// conversation has its own scroll container and a run in flight.

const PULL_THRESHOLD = 72
const PULL_MAX = 110
/** Finger travel is damped so a long drag reads as resistance, not as the page leaving. */
const damp = (dy: number) => Math.min(PULL_MAX, dy * 0.45)

function PullToRefresh({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const router = useRouter()
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const pullRef = useRef(0)
  const setPullBoth = (v: number) => {
    pullRef.current = v
    setPull(v)
  }

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setPullBoth(PULL_THRESHOLD * 0.6)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
      setPullBoth(0)
    }
  }, [router])

  useEffect(() => {
    if (!enabled) return
    const atTop = () => window.scrollY <= 0
    const begin = (y: number) => {
      if (!atTop() || refreshing) return
      startY.current = y
    }
    const move = (y: number, ev: Event) => {
      if (startY.current === null) return
      const dy = y - startY.current
      if (dy <= 0 || !atTop()) {
        if (pullRef.current !== 0) setPullBoth(0)
        return
      }
      // We own the gesture from here: no text selection, no native overscroll.
      if (ev.cancelable) ev.preventDefault()
      setPullBoth(damp(dy))
    }
    const end = () => {
      if (startY.current === null) return
      startY.current = null
      if (pullRef.current >= PULL_THRESHOLD) void refresh()
      else setPullBoth(0)
    }
    const onTouchStart = (e: TouchEvent) => begin(e.touches[0].clientY)
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientY, e)
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      begin(e.clientY)
    }
    const onMouseMove = (e: MouseEvent) => move(e.clientY, e)
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', end)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', end)
    }
  }, [enabled, refreshing, refresh])

  // The browser's own pull-to-refresh (Android Chrome) would fire alongside ours.
  useEffect(() => {
    if (!enabled) return
    const prev = document.documentElement.style.overscrollBehaviorY
    document.documentElement.style.overscrollBehaviorY = 'contain'
    return () => {
      document.documentElement.style.overscrollBehaviorY = prev
    }
  }, [enabled])

  const armed = pull >= PULL_THRESHOLD
  const label = refreshing ? 'Refreshing…' : armed ? 'Release to refresh' : 'Pull to refresh'
  const visible = enabled && (pull > 0 || refreshing)
  return (
    <div className="relative min-w-0 flex-1">
      <div
        aria-live="polite"
        className={cn('pointer-events-none absolute inset-x-0 top-0 flex justify-center transition-opacity duration-150', visible ? 'opacity-100' : 'opacity-0')}
        style={{ transform: `translateY(${Math.max(0, pull - 40)}px)` }}
      >
        <span className="kicker inline-flex items-center gap-2 rounded-full border border-rule bg-paper px-3 py-1.5 shadow-sm">
          <Basin className={cn('size-3.5 text-thread transition-transform', refreshing && 'animate-spin', armed && !refreshing && 'rotate-180')} />
          {label}
        </span>
      </div>
      <div
        className={cn(startY.current === null && 'transition-transform duration-200 ease-out')}
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined }}
      >
        {children}
      </div>
    </div>
  )
}

const NAV = [
  { to: '/', label: 'Inbox', icon: Inbox, hint: 'latest sweep' },
  { to: '/points', label: 'Points', icon: CircleDot, hint: 'send / ignore' },
  { to: '/journal', label: 'Journal', icon: ScrollText, hint: 'one entry per landing' },
  { to: '/digests', label: 'Digests', icon: MessagesSquare, hint: '#dev-team, daily' },
  { to: '/docs', label: 'Docs', icon: BookOpenText, hint: 'product + arch' },
  { to: '/ask', label: 'Ask', icon: MessageCircleQuestion, hint: 'argus, read-only' },
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

/** The chat detail page (`/ask/<id>`) keeps its own scroll and may have a run in flight. */
const isChatDetail = (pathname: string) => /^\/ask\/[^/]+\/?$/.test(pathname)

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Below `lg` the sidebar is a drawer behind a menu button; it closes on navigation and Escape.
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const wordmark = (
    <Link to="/" className="flex items-center gap-2.5 text-ink">
      <Basin className="size-7 text-thread" />
      <span className="display text-[22px] italic leading-none">Pensieve</span>
    </Link>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px] flex-col lg:flex-row">
      <div className="flex items-center justify-between border-b border-rule px-4 py-2.5 lg:hidden">
        {wordmark}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          aria-controls="app-nav"
          className="rounded-md p-1.5 text-ink-dim hover:bg-paper-2 hover:text-ink"
        >
          <MenuIcon className="size-5" strokeWidth={1.75} />
        </button>
      </div>
      {open && <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-ink/30 lg:hidden" />}
      <aside
        id="app-nav"
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[250px] shrink-0 flex-col border-r border-rule bg-paper shadow-xl transition-transform duration-200 ease-out',
          'lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[220px] lg:translate-x-0 lg:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-6">
          {wordmark}
          <button type="button" onClick={() => setOpen(false)} aria-label="Close navigation" className="rounded-md p-1 text-ink-faint hover:text-ink lg:hidden">
            <XIcon className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, hint }) => {
            const active = to === '/' ? pathname === '/' : pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'group relative flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active ? 'bg-paper-2 text-ink' : 'text-ink-dim hover:bg-paper-2/60 hover:text-ink',
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-thread" />}
                <Icon className={cn('size-4', active ? 'text-thread' : 'text-ink-faint group-hover:text-ink-dim')} strokeWidth={1.75} />
                <span>{label}</span>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">{hint}</span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto px-5 py-4">
          <p className="kicker">read-only, but one</p>
          <p className="mt-1 text-sm leading-snug text-ink-faint">
            The sweep writes the blackboard; this room only reads it — except{' '}
            <span className="mono">decisions/</span>, where a verdict on a point lands.
          </p>
        </div>
      </aside>
      <PullToRefresh enabled={!isChatDetail(pathname)}>
        <main className="min-w-0 px-5 py-6 sm:px-8 lg:px-12 lg:py-10">{children}</main>
      </PullToRefresh>
    </div>
  )
}
