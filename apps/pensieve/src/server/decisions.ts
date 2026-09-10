/**
 * The one writer. Pensieve's read-only rule has exactly one exception: `decisions/` in the
 * blackboard, where a click lands as one JSON file the sweep reads back and commits with
 * its next tick. Nothing else in this app writes to disk, and nothing here writes outside
 * `decisions/` — an id that would resolve elsewhere is refused before any path is built.
 *
 * Two groups, since the wave that replaced points with workstreams (LIA-161/162):
 *
 *   decisions/marauder/<slug>.json
 *   { id, action: "attach" | "new" | "dismiss" | "stage" | "verified", slug?, name?, reason, at, by }
 *
 * A verdict on an Unsorted entry — what ingest could not attach on its own — or, for
 * `verified`, on an *event*: the user answering what a `directed-at-person` event asked
 * them. `id` is the entry's or the event's own name and `<slug>` is that id folded to a
 * file name (`lib/marauder` `decisionSlug`), since a Slack `ts` is not a path segment. The
 * next `marauder ingest` applies each file through its correction functions and leaves the
 * file where it is as history.
 *
 *   decisions/send/<ticket>.json
 *   { ticket, action: "sent", job, at, by }
 *
 * A ticket handed to Foundry (LIA-162 AC2). Nothing applies it: `marauder.ts`
 * `sentTickets` scans every group under `decisions/` for a `sent` decision carrying a job,
 * and that is what holds the ticket pass off a ticket Foundry is running.
 *
 * Every file is written to a temp file in the same directory and renamed into place, so
 * the sweep never reads half a file, and none is ever edited afterwards by either side.
 * The groups the old point-keyed verdicts wrote — `decide/`, `verify/`, `confirm/`,
 * `hold/`, `housekeeping/`, `arc/` — stay on disk as committed history and are read by
 * nothing here any more.
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
import type { MarauderDecision } from "../lib/marauder";
import {
  isMarauderId,
  MARAUDER_ACTIONS,
  MARAUDER_GROUP,
  marauderId,
} from "../lib/marauder";
import { isSendId, isTicketKey, SEND_GROUP, sendId } from "../lib/send";
import { WORKSPACE_DIR } from "./workspace";

export const DECISIONS_DIR = join(WORKSPACE_DIR, "decisions");

/**
 * The file a decision lives in. Refuses any id that is not one of the two well-formed
 * shapes, and — belt and braces — any resolved path that does not sit under `dir`. The
 * regexes already rule out `..`, `/` runs and absolute paths; the prefix check is the
 * invariant stated in code so a future loosening of a regex cannot silently widen the
 * write.
 */
export function decisionPath(id: string, dir = DECISIONS_DIR): string {
  if (!(isMarauderId(id) || isSendId(id))) {
    throw new Error(`refused: "${id}" is not a decision id (<group>/<slug>)`);
  }
  const abs = resolve(dir, `${id}.json`);
  if (!abs.startsWith(resolve(dir) + sep)) {
    throw new Error(`refused: "${id}" resolves outside decisions/`);
  }
  return abs;
}

/** The text of one decision file, or null when there is none there to read. */
async function decisionText(id: string, dir: string): Promise<string | null> {
  try {
    return await readFile(decisionPath(id, dir), "utf8");
  } catch {
    return null;
  }
}

/**
 * The write itself: temp file beside the target, rename into place. Shared by both groups,
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

// ── the marauder group: a correction, or a confirmed event (LIA-160, LIA-162) ───

/**
 * A file's text as a decision, or null when it is not one ingest would apply. `id` and
 * `action` are the whole of it: everything else is what that action needs, and an action
 * missing its argument is refused here rather than half-applied by the sweep — `dismiss`
 * without a reason leaves no record of why, which is the one thing that file exists to
 * carry. `verified` needs nothing but the id.
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
 * Every decision in the group that is on disk, keyed by the entry's or event's own id —
 * what a page lays over the queue and over a workstream's events, so a row that has been
 * decided says so whether or not the sweep has run since.
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
 * Write one `decisions/marauder/<slug>.json`, atomically. Nothing under `workstreams/` is
 * touched: `marauder ingest` applies this file on its next run and commits what it changed.
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

// ── the send group: a ticket handed to Foundry (LIA-162) ───────────────────────

/** One `decisions/send/<ticket>.json`, as both sides read it. */
export interface SendDecision {
  action: "sent";
  /** ISO timestamp of the click. */
  at: string;
  by: string;
  job: { id: string; url: string };
  /** The Linear key, verbatim — what argus matches on, since the file name is folded. */
  ticket: string;
}

/**
 * A file's text as a send, or null when it is not one. The job is required: a `sent` file
 * with no job is what argus's `sentTickets` already ignores, and writing one would hold a
 * ticket's edits for a job that does not exist.
 */
export function parseSendDecision(text: string): SendDecision | null {
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
  const job = d.job as { id?: unknown; url?: unknown } | null | undefined;
  if (!(isTicketKey(d.ticket) && d.action === "sent")) {
    return null;
  }
  if (!(job && typeof job === "object" && typeof job.id === "string")) {
    return null;
  }
  return {
    action: "sent",
    at: str("at"),
    by: str("by"),
    job: { id: job.id, url: typeof job.url === "string" ? job.url : "" },
    ticket: d.ticket,
  };
}

/** The send already written for this ticket, or null — what makes a second click a replay. */
export async function readSendDecision(
  ticket: string,
  dir = DECISIONS_DIR
): Promise<SendDecision | null> {
  if (!isTicketKey(ticket)) {
    return null;
  }
  const raw = await decisionText(sendId(ticket), dir);
  return raw === null ? null : parseSendDecision(raw);
}

/** Every ticket already handed to Foundry from here, keyed by its Linear key. */
export async function readSendDecisions(
  dir = DECISIONS_DIR
): Promise<Map<string, SendDecision>> {
  const out = new Map<string, SendDecision>();
  let names: string[];
  try {
    names = await readdir(join(dir, SEND_GROUP));
  } catch {
    return out;
  }
  for (const name of names
    .filter((n) => n.endsWith(".json") && !n.includes(".tmp-"))
    .sort()) {
    let d: SendDecision | null;
    try {
      d = parseSendDecision(
        await readFile(join(dir, SEND_GROUP, name), "utf8")
      );
    } catch {
      continue;
    }
    if (!d) {
      continue;
    }
    const prev = out.get(d.ticket);
    if (!prev || d.at >= prev.at) {
      out.set(d.ticket, d);
    }
  }
  return out;
}

/** Write one `decisions/send/<ticket>.json`, atomically, through the same rename. */
export function writeSendDecision(
  d: SendDecision,
  dir = DECISIONS_DIR
): Promise<string> {
  return writeAtomically(sendId(d.ticket), dir, {
    action: d.action,
    at: d.at,
    by: d.by,
    job: d.job,
    ticket: d.ticket,
  });
}
