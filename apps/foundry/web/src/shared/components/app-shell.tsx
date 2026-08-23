import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Boxes, ListTree } from 'lucide-react'
import { FoundryMark } from './foundry-mark'
import { ForgeDot } from '@/features/forges/components/forge-dot'
import { forgeQueries } from '@/features/forges/queries'
import { cn } from '@/shared/lib/utils'

const NAV = [
  { to: '/', label: 'Jobs', icon: ListTree },
  { to: '/forges', label: 'Forges', icon: Boxes },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: forges } = useQuery(forgeQueries.list())

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-hairline bg-iron-950/60 backdrop-blur-sm">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <FoundryMark className="size-7" />
          <span className="text-[15px] font-extrabold uppercase tracking-[0.2em] text-txt">Foundry</span>
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
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
      </aside>

      <main className="grid-field ml-56 flex min-h-screen flex-1 flex-col">{children}</main>
    </div>
  )
}
