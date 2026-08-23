import { ForgeDot } from './forge-dot'
import { relative } from '@/shared/lib/format'
import type { Forge } from '../types'

export function ForgeCard({ forge, currentTask }: { forge: Forge; currentTask?: string }) {
  return (
    <div className="bg-iron-900 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <ForgeDot status={forge.status} />
        <span className="font-mono text-[14px] font-medium text-txt">{forge.name}</span>
        {forge.host && <span className="font-mono text-[11px] text-txt-faint">{forge.host}</span>}
        <span className="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-wider text-txt-faint">{forge.status}</span>
      </div>

      {/* Runtime facts are adapter-scoped, so they are rendered as-is rather than
          assumed to be cpus/memory. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-txt-dim">
        {Object.entries(forge.runtime).map(([key, value]) => (
          <span key={key}>
            <span className="text-txt-faint">{key}</span> {value}
          </span>
        ))}
        <span>
          {forge.jobsRun} job{forge.jobsRun === 1 ? '' : 's'} run
        </span>
        <span className="ml-auto text-txt-faint">created {relative(forge.createdAt)}</span>
      </div>

      <div className="mt-4 border-t border-hairline pt-3">
        {currentTask ? (
          <p className="truncate text-[12.5px] text-txt-dim">
            <span className="text-ember">▸ </span>
            {currentTask}
          </p>
        ) : (
          <p className="font-mono text-[12px] text-txt-faint">idle — no job assigned</p>
        )}
      </div>
    </div>
  )
}
