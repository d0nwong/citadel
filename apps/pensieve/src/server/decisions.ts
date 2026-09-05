/**
 * The one writer. Pensieve's read-only rule has exactly one exception: `decisions/` in
 * the blackboard, where a Send or Ignore verdict on a Needs-you point lands as one JSON
 * file the sweep reads back (LIA-88) and commits with its next tick. Nothing else in this
 * app writes to disk, and nothing here writes outside `decisions/` — a point id that would
 * resolve elsewhere is refused before any path is built (LIA-94 AC9).
 *
 * The file contract, shared with argus `skills/sweep/scripts/points.ts`:
 *
 *   decisions/<group>/<slug>.json
 *   { point, action: "sent" | "ignored", reason, at, subject, job? }
 *
 * `reason` is required for `ignored`; `job: { id, url }` only for `sent`. Written to a
 * temp file in the same directory and renamed into place, so the sweep never reads half a
 * file. Never edited afterwards by either side.
 */
import { join, resolve, sep } from 'node:path'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { WORKSPACE_DIR } from './workspace'
import type { Point, PointGroup } from './workspace'

export const DECISIONS_DIR = join(WORKSPACE_DIR, 'decisions')

export interface Decision {
  /** The point id — `<group>/<slug>`, which is also the file's path under `decisions/`. */
  point: string
  action: 'sent' | 'ignored'
  reason?: string
  /** ISO timestamp of the verdict. */
  at: string
  subject: string
  job?: { id: string; url: string }
}

/** A point id as `points.ts` derives it: a known group, then a slug of `[a-z0-9-]`. */
export const POINT_ID_RE = /^(decide|verify|confirm|hold|housekeeping)\/[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isPointId = (id: unknown): id is string => typeof id === 'string' && POINT_ID_RE.test(id)

/**
 * The file a point's decision lives in. Refuses any id that is not a well-formed point
 * id, and — belt and braces — any resolved path that does not sit under `dir`. The regex
 * already rules out `..`, `/` runs and absolute paths; the prefix check is the invariant
 * stated in code so a future loosening of the regex cannot silently widen the write.
 */
export function decisionPath(pointId: string, dir = DECISIONS_DIR): string {
  if (!isPointId(pointId)) throw new Error(`refused: "${pointId}" is not a point id (<group>/<slug>)`)
  const abs = resolve(dir, `${pointId}.json`)
  if (!abs.startsWith(resolve(dir) + sep)) throw new Error(`refused: "${pointId}" resolves outside decisions/`)
  return abs
}

/** Read one point's decision, or null when none has been written. */
export async function readDecision(pointId: string, dir = DECISIONS_DIR): Promise<Decision | null> {
  const p = decisionPath(pointId, dir)
  let raw: string
  try {
    raw = await readFile(p, 'utf8')
  } catch {
    return null
  }
  return parseDecision(raw)
}

/** A file's text as a Decision, or null when it is not one the sweep would accept. */
export function parseDecision(text: string): Decision | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const d = v as Record<string, unknown>
  if (typeof d.point !== 'string' || !d.point) return null
  if (d.action !== 'sent' && d.action !== 'ignored') return null
  if (d.action === 'ignored' && (typeof d.reason !== 'string' || !d.reason.trim())) return null
  const job =
    d.job && typeof d.job === 'object' && typeof (d.job as { id?: unknown }).id === 'string'
      ? { id: (d.job as { id: string }).id, url: String((d.job as { url?: unknown }).url ?? '') }
      : undefined
  return {
    point: d.point,
    action: d.action,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    at: typeof d.at === 'string' ? d.at : '',
    subject: typeof d.subject === 'string' ? d.subject : '',
    job,
  }
}

/**
 * Every decision on disk, keyed by point. Two files for one point (which the writer never
 * produces, but a hand edit might): the later `at` wins, as the sweep resolves it.
 */
export async function readDecisions(dir = DECISIONS_DIR): Promise<Map<string, Decision>> {
  const out = new Map<string, Decision>()
  let names: string[]
  try {
    names = (await readdir(dir, { recursive: true })) as string[]
  } catch {
    return out
  }
  for (const name of names.filter((n) => n.endsWith('.json') && !n.includes('.tmp-')).sort()) {
    let d: Decision | null
    try {
      d = parseDecision(await readFile(join(dir, name), 'utf8'))
    } catch {
      continue
    }
    if (!d) continue
    const prev = out.get(d.point)
    if (!prev || d.at >= prev.at) out.set(d.point, d)
  }
  return out
}

/**
 * Write a decision atomically: temp file beside the target, fsync-free rename. The rename
 * is what makes the sweep's read all-or-nothing — a crash mid-write leaves a `.tmp-` file
 * the walker above ignores, never a truncated `.json`.
 */
export async function writeDecision(d: Decision, dir = DECISIONS_DIR): Promise<string> {
  if (d.point.split('/')[1] === undefined) throw new Error('refused: decision has no point id')
  const target = decisionPath(d.point, dir)
  const parent = resolve(target, '..')
  await mkdir(parent, { recursive: true })
  const tmp = join(parent, `.${d.point.split('/')[1]}.json.tmp-${randomBytes(4).toString('hex')}`)
  const body: Decision = {
    point: d.point,
    action: d.action,
    ...(d.reason !== undefined ? { reason: d.reason } : {}),
    at: d.at,
    subject: d.subject,
    ...(d.job ? { job: d.job } : {}),
  }
  try {
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
    await rename(tmp, target)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  return target
}

/**
 * `points.json` with the files on disk laid over it. The sweep attaches `decision` when it
 * re-emits the file, but it may lag a tick behind a verdict written here — so the page
 * trusts the file first and the sweep's copy only where no file exists (AC8).
 */
export function mergeDecisions(points: Point[], onDisk: Map<string, Decision>): Point[] {
  return points.map((p) => {
    const d = onDisk.get(p.id)
    return d ? { ...p, decision: d } : p
  })
}

export const GROUP_ORDER: PointGroup[] = ['decide', 'verify', 'confirm', 'hold', 'housekeeping']
