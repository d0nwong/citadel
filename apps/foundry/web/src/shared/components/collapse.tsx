import { useState } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * A section that grows and folds instead of popping in and out. The height
 * comes from `grid-template-rows` interpolating between a fraction of the
 * content's own height and the collapsed `peek` — the one way to animate to a
 * height nothing has to measure first.
 *
 * Children stay unmounted until the first open, and are dropped again once the
 * fold-away finishes, so a log full of never-opened sections costs nothing.
 */
export function Collapse({
  open,
  peek,
  className,
  children,
}: {
  open: boolean
  /** Height left showing while closed, e.g. `'2.75rem'`. Omit to fold away entirely. */
  peek?: string
  /** Classes for the clipping frame around the content. */
  className?: string
  children: React.ReactNode
}) {
  const foldsAway = peek === undefined
  const [mounted, setMounted] = useState(open || !foldsAway)
  // Mounting from an effect would paint the open row while the content is
  // still missing, leaving the growth nothing to animate from.
  if (open && !mounted) setMounted(true)
  const gone = foldsAway && !open

  return (
    <div
      className="grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none"
      style={{ gridTemplateRows: `minmax(${peek ?? '0px'}, ${open ? '1fr' : '0fr'})`, opacity: gone ? 0 : 1 }}
      inert={gone}
      onTransitionEnd={(e) => {
        if (gone && e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setMounted(false)
      }}
    >
      <div className={cn('overflow-hidden', className)}>{mounted && children}</div>
    </div>
  )
}
