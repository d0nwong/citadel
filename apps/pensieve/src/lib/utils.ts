import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** "2026-08-28" → "Thu 28 Aug 2026" — the reading-room date. */
export function prettyDay(day: string, opts: { weekday?: boolean } = { weekday: true }) {
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString('en-GB', {
    weekday: opts.weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function daysSince(day?: string): number | null {
  if (!day) return null
  const d = new Date(`${day}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

export const LINEAR_ISSUE = 'https://linear.app/liamai/issue/'
