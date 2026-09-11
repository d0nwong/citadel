import { cn } from '@/shared/lib/utils'
import type { ForgeStatus } from '../types'

const TONE: Record<ForgeStatus, string> = {
  idle: 'bg-quench',
  busy: 'bg-ember animate-ember-pulse',
  stopped: 'bg-txt-faint',
}

export function ForgeDot({ status, className }: { status: ForgeStatus; className?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', TONE[status], className)} />
}
