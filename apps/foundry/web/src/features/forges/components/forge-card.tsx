import { Cpu, HardDrive } from 'lucide-react'
import { ForgeDot } from './forge-dot'
import { relative } from '@/shared/lib/format'
import type { Forge } from '../types'

export function ForgeCard({ forge, currentTask }: { forge: Forge; currentTask?: string }) {
  return (
    <div className="bg-iron-900 p-5">
      <div className="flex items-center gap-2.5">
        <ForgeDot status={forge.status} />
        <span className="font-mono text-[14px] font-medium text-txt">{forge.name}</span>
        <span className="font-mono text-[11px] text-txt-faint">{forge.name}.foundry.local</span>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wider text-txt-faint">{forge.status}</span>
      </div>

      <div className="mt-4 flex items-center gap-5 font-mono text-[11px] text-txt-dim">
        <span className="flex items-center gap-1.5">
          <Cpu className="size-3 text-txt-faint" />
          {forge.cpus} cores
        </span>
        <span className="flex items-center gap-1.5">
          <HardDrive className="size-3 text-txt-faint" />
          {forge.memory}
        </span>
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
