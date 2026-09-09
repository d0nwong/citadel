/**
 * The one writer. Pensieve's read-only rule has exactly one exception: `decisions/` in
 * the blackboard, where a Send, Ignore or Verify verdict on a Needs-you point lands as one
 * JSON file the sweep reads back (LIA-88) and commits with its next tick. Nothing else in
 * this app writes to disk, and nothing here writes outside `decisions/` — a point id that
 * would resolve elsewhere is refused before any path is built (LIA-94 AC9).
 *
 * The file contract, shared with argus `skills/sweep/scripts/points.ts`:
 *
 *   decisions/<group>/<slug>.json
 *   { point, action: "sent" | "ignored" | "verified", reason, at, subject, job? }
 *
 * `reason` is required for `ignored` and optional for `verified` — a confirmation of the
 * sweep's own inference needs no argument (LIA-115); `job: { id, url }` only for `sent`.
 * Written to a temp file in the same directory and renamed into place, so the sweep never
 * reads half a file. Never edited afterwards by either side.
 *
 * One group in that tree is not a verdict on a point, and travels the same path anyway
 * (LIA-147):
 *
 *   decisions/arc/<slug>.json
 *   { point: "arc/<slug>", action: "opened" | "closed", subject, seeds, at }
 *
 * It opens or closes an arc — the running story of an initiative the sweep keeps at
 * `arcs/<slug>.md` (LIA-145) — and `seeds` is required on `opened`, since an arc with no
 * keys files nothing. Same writer, same atomic rename, same "never edited afterwards": one
 * exception to read-only, one code path, one audit line if a file is ever malformed. It
 * joins no point, so `readDecisions` leaves the group alone and `readArcDecision` reads it,
 * exactly as `parseArcDecision` / `readArcDecisions` do on the sweep's side.
 *
 * A third group is a verdict on an Unsorted entry — what ingest could not attach on its own
 * (LIA-160):
 *
 *   decisions/marauder/<slug>.json
 *   { id, action: "attach" | "new" | "dismiss" | "stage", slug?, name?, reason, at, by }
 *
 * `id` is the entry's own id and `<slug>` is that id folded to a file name (`lib/marauder`
 * `decisionSlug`), since a Slack `ts` is not a path segment. The next `marauder ingest`
 * applies each file through its correction functions, drops the entry from the queue, and
 * leaves the file where it is as history. It joins no point either, so `readDecisions`
 * skips this group exactly as it skips `arc/`.
 */

import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ArcSeeds } from "../lib/arcs";
import { ARC_GROUP, allSeeds, arcId, isArcId, toSeeds } from "../lib/arcs";
import type { MarauderDecision } from "../lib/marauder";
import {
  isMarauderId,
  MARAUDER_ACTIONS,
  MARAUDER_GROUP,
  marauderId,
} from "../lib/marauder";
import { isPointId } from "../lib/points";
import type { Point, PointGroup } from "./workspace";
import { WORKSPACE_DIR } from "./workspace";

export const DECISIONS_DIR = join(WORKSPACE_DIR, "decisions");

export interface Decision {
  action: "sent" | "ignored" | "verified";
  /** ISO timestamp of the verdict. */
  at: string;
  job?: { id: string; url: string };
  /** The point id — `<group>/<slug>`, which is also the file's path under `decisions/`. */
  point: string;
  reason?: string;
  subject: string;
}

/**
 * The arc group's file: the user's verdict that an initiative is worth a running story, or
 * that its story is over. `subject` is the arc's title and `slug` is its file name under
 * `arcs/` — derived from `point` rather than carried on the wire, as the sweep derives it.
 */
export interface ArcDecision {
  action: "opened" | "closed";
  at: string;
  /** `arc/<slug>`. */
  point: string;
  reason?: string;
  seeds: ArcSeeds;
  slug: string;
  subject: string;
}

/** Either file, as it comes off disk. */
export type AnyDecision = Decision | ArcDecision;

export const isArcDecision = (d: AnyDecision): d is ArcDecision =>
  d.action === "opened" || d.action === "closed";

/**
 * The file a point's decision lives in. Refuses any id that is not a well-formed point
 * id, and — belt and braces — any resolved path that does not sit under `dir`. The regex
 * already rules out `..`, `/` runs and absolute paths; the prefix check is the invariant
 * stated in code so a future loosening of the regex cannot silently widen the write.
 */
export function decisionPath(pointId: string, dir = DECISIONS_DIR): string {
  if (!(isPointId(pointId) || isArcId(pointId) || isMarauderId(pointId))) {
    throw new Error(`refused: "${pointId}" is not a point id (<group>/<slug>)`);
  }
  const abs = resolve(dir, `${pointId}.json`);
  if (!abs.startsWith(resolve(dir) + sep)) {
    throw new Error(`refused: "${pointId}" resolves outside decisions/`);
  }
  return abs;
}

/** The text of one decision file, or null when there is none there to read. */
async function decisionText(
  pointId: string,
  dir: string
): Promise<string | null> {
  try {
    return await readFile(decisionPath(pointId, dir), "utf8");
  } catch {
    return null;
  }
}

/** Read one point's decision, or null when none has been written. */
export async function readDecision(
  pointId: string,
  dir = DECISIONS_DIR
): Promise<Decision | null> {
  const raw = await decisionText(pointId, dir);
  if (raw === null) {
    return null;
  }
  const d = parseDecision(raw);
  return d && !isArcDecision(d) ? d : null;
}

/**
 * Read one arc's file — `decisions/arc/<slug>.json` — or null when the arc has never been
 * opened. The `closed` verdict is written to that same path, so this answers the last
 * verdict given on the arc rather than only its opening (LIA-147 AC2, AC4).
 */
export async function readArcDecision(
  slug: string,
  dir = DECISIONS_DIR
): Promise<ArcDecision | null> {
  const raw = await decisionText(arcId(slug), dir);
  if (raw === null) {
    return null;
  }
  const d = parseDecision(raw);
  return d && isArcDecision(d) ? d : null;
}

/**
 * A file's text as an arc's verdict, or null when it is not one the sweep would accept —
 * `parseArcDecision` in `skills/sweep/scripts/points.ts`, field for field. `seeds` is
 * required on `opened` (an arc with no keys files nothing) and ignored on `closed`, which
 * only flips the status of an arc that already exists.
 */
function parseArcDecision(d: Record<string, unknown>): ArcDecision | null {
  if (!isArcId(d.point)) {
    return null;
  }
  if (d.action !== "opened" && d.action !== "closed") {
    return null;
  }
  const seeds = toSeeds(d.seeds);
  if (d.action === "opened" && allSeeds(seeds).length === 0) {
    return null;
  }
  return {
    action: d.action,
    at: typeof d.at === "string" ? d.at : "",
    point: d.point,
    reason: typeof d.reason === "string" ? d.reason : undefined,
    seeds,
    slug: d.point.slice(ARC_GROUP.length + 1),
    subject: typeof d.subject === "string" ? d.subject : "",
  };
}

/**
 * A file's text as the verdict it carries, or null when it is not one the sweep would
 * accept. The `arc/` group is a verdict on an initiative rather than on a point, so it
 * parses to an `ArcDecision` — `isArcDecision` tells the two apart, and every caller that
 * wants one and not the other says so.
 */
export function parseDecision(text: string): AnyDecision | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const d = v as Record<string, unknown>;
  if (typeof d.point !== "string" || !d.point) {
    return null;
  }
  if (d.point.startsWith(`${ARC_GROUP}/`)) {
    return parseArcDecision(d);
  }
  if (
    d.action !== "sent" &&
    d.action !== "ignored" &&
    d.action !== "verified"
  ) {
    return null;
  }
  if (
    d.action === "ignored" &&
    (typeof d.reason !== "string" || !d.reason.trim())
  ) {
    return null;
  }
  const job =
    d.job &&
    typeof d.job === "object" &&
    typeof (d.job as { id?: unknown }).id === "string"
      ? {
          id: (d.job as { id: string }).id,
          url: String((d.job as { url?: unknown }).url ?? ""),
        }
      : undefined;
  return {
    action: d.action,
    at: typeof d.at === "string" ? d.at : "",
    job,
    point: d.point,
    reason: typeof d.reason === "string" ? d.reason : undefined,
    subject: typeof d.subject === "string" ? d.subject : "",
  };
}

/**
 * Every verdict on a point that is on disk, keyed by point. Two files for one point (which
 * the writer never produces, but a hand edit might): the later `at` wins, as the sweep
 * resolves it. The `arc/` group is skipped whole — an arc is not a verdict on a point, so
 * it must never land on one, nor be reported as a file that could not be read (AC5);
 * `readArcDecision` is its reader, as `readArcDecisions` is the sweep's.
 */
export async function readDecisions(
  dir = DECISIONS_DIR
): Promise<Map<string, Decision>> {
  const out = new Map<string, Decision>();
  let names: string[];
  try {
    names = (await readdir(dir, { recursive: true })) as string[];
  } catch {
    return out;
  }
  for (const name of names
    .filter(
      (n) =>
        n.endsWith(".json") &&
        !n.includes(".tmp-") &&
        !n.startsWith(`${ARC_GROUP}/`) &&
        !n.startsWith(`${MARAUDER_GROUP}/`)
    )
    .sort()) {
    let d: AnyDecision | null;
    try {
      d = parseDecision(await readFile(join(dir, name), "utf8"));
    } catch {
      continue;
    }
    if (!d || isArcDecision(d)) {
      continue;
    }
    const prev = out.get(d.point);
    if (!prev || d.at >= prev.at) {
      out.set(d.point, d);
    }
  }
  return out;
}

/**
 * Write a decision atomically: temp file beside the target, fsync-free rename. The rename
 * is what makes the sweep's read all-or-nothing — a crash mid-write leaves a `.tmp-` file
 * the walker above ignores, never a truncated `.json`.
 */
export function writeDecision(
  d: AnyDecision,
  dir = DECISIONS_DIR
): Promise<string> {
  if (d.point.split("/")[1] === undefined) {
    throw new Error("refused: decision has no point id");
  }
  // `slug` is derived from `point` by every reader, so it never goes on the wire; `seeds`
  // does, since it is the arc's whole substance and nothing else carries it.
  return writeAtomically(d.point, dir, {
    action: d.action,
    point: d.point,
    ...(d.reason === undefined ? {} : { reason: d.reason }),
    at: d.at,
    subject: d.subject,
    ...(isArcDecision(d) ? { seeds: d.seeds } : {}),
    ...(!isArcDecision(d) && d.job ? { job: d.job } : {}),
  });
}

/**
 * The write itself: temp file beside the target, rename into place. Shared by every group,
 * so a file the sweep reads is whole whatever wrote it.
 */
async function writeAtomically(
  id: string,
  dir: string,
  body: unknown
): Promise<string> {
  const target = decisionPath(id, dir);
  const parent = resolve(target, "..");
  await mkdir(parent, { recursive: true });
  const tmp = join(
    parent,
    `.${id.split("/")[1]}.json.tmp-${randomBytes(4).toString("hex")}`
  );
  try {
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
  return target;
}

// ── the marauder group: a verdict on an Unsorted entry (LIA-160) ───────────────

/**
 * A file's text as a decision on an Unsorted entry, or null when it is not one ingest
 * would apply. `id` and `action` are the whole of it: everything else is what that action
 * needs, and an action missing its argument is refused here rather than half-applied by
 * the sweep — `dismiss` without a reason leaves no record of why, which is the one thing
 * that file exists to carry.
 */
export function parseMarauderDecision(text: string): MarauderDecision | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const d = v as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  const id = str("id");
  const action = str("action") as MarauderDecision["action"];
  if (!(id && (MARAUDER_ACTIONS as readonly string[]).includes(action))) {
    return null;
  }
  if (action === "attach" && !str("slug")) {
    return null;
  }
  if (action === "new" && !str("name")) {
    return null;
  }
  if (action === "dismiss" && !str("reason").trim()) {
    return null;
  }
  return {
    action,
    at: str("at"),
    by: str("by"),
    id,
    ...(str("name") ? { name: str("name") } : {}),
    ...(str("reason") ? { reason: str("reason") } : {}),
    ...(str("side") ? { side: str("side") as MarauderDecision["side"] } : {}),
    ...(str("slug") ? { slug: str("slug") } : {}),
    ...(str("stage")
      ? { stage: str("stage") as MarauderDecision["stage"] }
      : {}),
  };
}

/** The decision already written on this entry, or null — what makes a second click a no-op. */
export async function readMarauderDecision(
  id: string,
  dir = DECISIONS_DIR
): Promise<MarauderDecision | null> {
  const raw = await decisionText(marauderId(id), dir);
  return raw === null ? null : parseMarauderDecision(raw);
}

/**
 * Every decision on an Unsorted entry that is on disk, keyed by the entry's own id — what
 * the page lays over the queue so a row that has been decided says so, whether or not the
 * sweep has run since.
 */
export async function readMarauderDecisions(
  dir = DECISIONS_DIR
): Promise<Map<string, MarauderDecision>> {
  const out = new Map<string, MarauderDecision>();
  let names: string[];
  try {
    names = await readdir(join(dir, MARAUDER_GROUP));
  } catch {
    return out;
  }
  for (const name of names
    .filter((n) => n.endsWith(".json") && !n.includes(".tmp-"))
    .sort()) {
    let d: MarauderDecision | null;
    try {
      d = parseMarauderDecision(
        await readFile(join(dir, MARAUDER_GROUP, name), "utf8")
      );
    } catch {
      continue;
    }
    if (!d) {
      continue;
    }
    const prev = out.get(d.id);
    if (!prev || d.at >= prev.at) {
      out.set(d.id, d);
    }
  }
  return out;
}

/**
 * Write one `decisions/marauder/<slug>.json`, atomically, through the same rename every
 * other verdict uses. Nothing under `workstreams/` is touched: `marauder ingest` applies
 * this file on its next run and commits what it changed.
 */
export function writeMarauderDecision(
  d: MarauderDecision,
  dir = DECISIONS_DIR
): Promise<string> {
  return writeAtomically(marauderId(d.id), dir, {
    action: d.action,
    id: d.id,
    ...(d.slug === undefined ? {} : { slug: d.slug }),
    ...(d.name === undefined ? {} : { name: d.name }),
    ...(d.side === undefined ? {} : { side: d.side }),
    ...(d.stage === undefined ? {} : { stage: d.stage }),
    ...(d.reason === undefined ? {} : { reason: d.reason }),
    at: d.at,
    by: d.by,
  });
}

/**
 * `points.json` with the files on disk laid over it. The sweep attaches `decision` when it
 * re-emits the file, but it may lag a tick behind a verdict written here — so the page
 * trusts the file first and the sweep's copy only where no file exists (AC8).
 */
export function mergeDecisions(
  points: Point[],
  onDisk: Map<string, Decision>
): Point[] {
  return points.map((p) => {
    const d = onDisk.get(p.id);
    return d ? { ...p, decision: d } : p;
  });
}

export const GROUP_ORDER: PointGroup[] = [
  "decide",
  "verify",
  "confirm",
  "hold",
  "housekeeping",
];
