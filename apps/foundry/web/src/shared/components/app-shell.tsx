import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Boxes, FolderGit2, Layers, ListTree, Menu } from 'lucide-react'
import { FoundryMark } from './foundry-mark'
import { ForgeDot } from '@/features/forges/components/forge-dot'
import { forgeQueries } from '@/features/forges/queries'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/shared/ui/sheet'
import { cn } from '@/shared/lib/utils'

const NAV = [
  { to: '/', label: 'Jobs', icon: ListTree },
  { to: '/forges', label: 'Forges', icon: Boxes },
  { to: '/repos', label: 'Repos', icon: FolderGit2 },
  { to: '/blueprints', label: 'Blueprints', icon: Layers },
] as const

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <FoundryMark className="size-7" />
      <span className="text-[15px] font-extrabold uppercase tracking-[0.2em] text-txt">Foundry</span>
    </span>
  )
}

/** Rail contents, shared by the fixed desktop rail and the mobile drawer. */
function RailBody({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { data: forges } = useQuery(forgeQueries.list())

  return (
    <>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = pathname === to
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13px] font-medium transition-colors lg:py-2',
                active ? 'bg-iron-800 text-txt' : 'text-txt-dim hover:bg-iron-850 hover:text-txt',
              )}
            >
              {active && <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-ember" />}
              <Icon className={cn('size-4', active ? 'text-ember' : 'text-txt-faint group-hover:text-txt-dim')} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="mt-8 px-5">
        <div className="kicker">Forges</div>
      </div>
      <div className="mt-2.5 flex flex-col gap-px px-3">
        {forges?.map((f) => (
          <div key={f.name} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
            <ForgeDot status={f.status} />
            <span className="font-mono text-[12px] text-txt-dim">{f.name}</span>
            <span className="ml-auto font-mono text-[10px] text-txt-faint">{f.runtimeSummary}</span>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-hairline px-5 py-3.5">
        <div className="font-mono text-[10px] leading-relaxed text-txt-faint">
          adapter · orbstack
          <br />
          foundry/forge:latest
        </div>
      </div>
    </>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [drawerOpen, setDrawerOpen] = useState(false)

  // A route change from anywhere (including browser back) should close the drawer.
  useEffect(() => setDrawerOpen(false), [pathname])

  return (
    <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
      {/* Mobile: a top bar with the drawer trigger. */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-hairline bg-iron-950/85 px-4 py-3 backdrop-blur-md lg:hidden">
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger
            aria-label="Open navigation"
            className="-ml-1 rounded-md p-1.5 text-txt-dim transition-colors hover:bg-iron-850 hover:text-txt"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="flex w-64 flex-col gap-0 border-r border-hairline bg-iron-950 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="px-5 py-5">
              <Wordmark />
            </div>
            <RailBody pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>
        <Wordmark />
      </header>

      {/* Desktop: the fixed rail. */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-hairline bg-iron-950/60 backdrop-blur-sm lg:flex">
        <div className="px-5 py-5">
          <Wordmark />
        </div>
        <RailBody pathname={pathname} />
      </aside>

      <main className="grid-field flex min-h-0 flex-1 flex-col lg:ml-56">{children}</main>
    </div>
  )
}
