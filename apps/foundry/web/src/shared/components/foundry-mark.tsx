import { useId } from 'react'

/** Molten ingot mark — a poured billet cooling from the edges in. */
export function FoundryMark({ className }: { className?: string }) {
  // The mark renders in both the mobile bar and the desktop rail, so a fixed
  // gradient id would collide and `url(#…)` would resolve to the wrong node.
  const gradientId = useId()

  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#c23e0c" />
          <stop offset="55%" stopColor="#ff5c1a" />
          <stop offset="100%" stopColor="#ffb066" />
        </linearGradient>
      </defs>
      <path d="M6 19.5 L9.5 8.5 h9 L22 19.5 z" fill={`url(#${gradientId})`} />
      <path d="M6 19.5 L9.5 8.5 h9 L22 19.5 z" fill="none" stroke="#ffd9bd" strokeOpacity=".35" strokeWidth="1" />
      <rect x="4" y="21" width="20" height="2" rx="1" fill="#ff5c1a" fillOpacity=".28" />
    </svg>
  )
}
