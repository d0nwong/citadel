const HOME = '/Users/yickkiuliamleung'

export const tildePath = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p)

export function duration(ms: number): string {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function relative(ts: number, from = Date.now()): string {
  const s = Math.floor((from - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 90) return '1 min ago'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export const clockTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
