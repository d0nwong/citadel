import type { QueueProps } from '@tanstack/ai-react/ui'
import { XIcon } from 'lucide-react'
import type { Opts } from '../model/chat-options'

/** A question sent while an answer streams waits here until the run ends (AC6). */
export function AskQueue({ item }: QueueProps<Opts>) {
  const c = item.content
  const text = typeof c === 'string' ? c : typeof c.content === 'string' ? c.content : '…'
  return (
    <div className="ml-auto flex max-w-[95%] items-center gap-2 text-sm text-ink-faint">
      <span className="kicker">queued</span>
      <span className="truncate">{text}</span>
      <button type="button" onClick={item.cancelQueued} title="Cancel" className="rounded p-0.5 hover:bg-paper-2 hover:text-ink" aria-label="Cancel queued message">
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
