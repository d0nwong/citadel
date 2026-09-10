#!/usr/bin/env bun
/**
 * The decisions a person made in Pensieve, applied (ARG-160 AC4, over features since ARG-164).
 *
 * Pensieve is read-only over the blackboard with one exception: it writes decision files.
 * A click on an Unsorted entry lands as `decisions/marauder/<id>.json`, and this is the
 * other half of that contract — `marauder ingest` reads those files first, applies each
 * through the correction functions in `correct.ts`, and carries on. Nothing else applies
 * them, and nothing here writes: the command does the reading and the writing, as it does
 * for every other verb.
 *
 *   decisions/marauder/<id>.json
 *   { id, action: "attach" | "dismiss" | "verified", feature?, reason, at, by }
 *
 * `attach` names the feature by its directory under `features/`. A file naming a `slug`
 * instead, or carrying `new` or `stage`, is from the workstreams: it is said out loud in one
 * sentence and not applied (ARG-165). Every such file on disk was applied while workstreams
 * existed, so its entry is gone from the queue either way.
 *
 * `verified` is the odd one: its `id` names an *event* rather than a queue entry, and it
 * is the user answering what a `directed-at-person` event asked them — the go-ahead for
 * the one edit that event named. It stamps the event and nothing else (ARG-161).
 *
 * The other group Pensieve writes is `decisions/send/<ticket>.json`,
 * `{ ticket, action: "sent", job, at, by }` — a ticket handed to Foundry. Nothing here
 * applies it: `marauder.ts` `sentTickets` reads every `sent` decision with a job when it
 * builds a ticket plan, which is what holds the edits on a ticket Foundry is running.
 *
 * Three rules hold this together:
 *
 *   - **The file is never edited and never deleted.** It stays where it is as the history
 *     of who decided what, and the entry leaving the queue is what stops it being applied
 *     twice. A decision naming an entry that is gone is skipped without a word.
 *   - **A malformed file is a problem, and is said out loud.**
 *   - **Oldest first.** Two decisions can name the same feature, and the record should read
 *     in the order the person made them.
 */

import { join } from "node:path";
import { attach, confirmEvent, dismiss, type Result, type State, type Who } from "./correct.ts";
import { USER } from "./record.ts";

/** the group under `decisions/` this reads; the other groups are the old verdicts, archive */
export const MARAUDER_GROUP = "marauder";

export type MarauderAction = "attach" | "dismiss" | "verified";

export type MarauderDecision = {
  /** the queue entry this decides, or — for `verified` — the event it answers */
  id: string;
  action: MarauderAction;
  /** `attach` — the feature it lands on, as its directory under features/ */
  feature?: string;
  reason?: string;
  at: string;
  by: string;
};

const ACTIONS: MarauderAction[] = ["attach", "dismiss", "verified"];
const RETIRED = ["new", "stage", "split"];
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * One file's text as a decision, or the sentence saying why it is not one. An action
 * missing its argument is refused rather than half-applied: a `dismiss` with no reason
 * would drop an item and leave no record of why, which is the one thing the file is for.
 */
export function parseDecision(text: string): { decision: MarauderDecision } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { error: `not JSON — ${(err as Error).message}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "not a JSON object" };
  const d = value as Record<string, unknown>;
  if (!isStr(d.id)) return { error: "no id — the file must name the unsorted entry it decides" };
  if (RETIRED.includes(String(d.action))) return { error: `"${String(d.action)}" went with the workstreams — attach the entry to a feature instead` };
  if (!ACTIONS.includes(d.action as MarauderAction)) return { error: `action "${String(d.action)}" is not one of ${ACTIONS.join(", ")}` };
  const action = d.action as MarauderAction;
  const feature = isStr(d.feature) ? d.feature : undefined;
  if (action === "attach" && !feature && isStr(d.slug)) return { error: `attach names the workstream "${d.slug}", and workstreams are gone — name the feature instead` };
  if (action === "attach" && !feature) return { error: "attach names no feature" };
  if (action === "dismiss" && !isStr(d.reason)) return { error: "dismiss gives no reason, and the reason is all that is left of the item" };
  return {
    decision: {
      id: d.id,
      action,
      ...(feature ? { feature } : {}),
      ...(isStr(d.reason) ? { reason: d.reason } : {}),
      at: isStr(d.at) ? d.at : "",
      by: isStr(d.by) ? d.by : USER.name,
    },
  };
}

export type Unreadable = { file: string; error: string };

/** every decision file under `decisions/marauder/`, oldest first, with the ones that are not */
export async function readDecisions(
  root = ".",
  group = MARAUDER_GROUP,
): Promise<{ decisions: MarauderDecision[]; unreadable: Unreadable[] }> {
  const dir = join(root, "decisions", group);
  const decisions: MarauderDecision[] = [];
  const unreadable: Unreadable[] = [];
  const files: string[] = [];
  try {
    for await (const f of new Bun.Glob("*.json").scan({ cwd: dir, onlyFiles: true })) files.push(f);
  } catch {
    return { decisions, unreadable };
  }
  for (const file of files.sort()) {
    // a half-written file the writer is still renaming into place, which is never a decision
    if (file.includes(".tmp-")) continue;
    const parsed = parseDecision(await Bun.file(join(dir, file)).text());
    if ("error" in parsed) unreadable.push({ file: `${group}/${file}`, error: parsed.error });
    else decisions.push(parsed.decision);
  }
  return {
    decisions: decisions.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    unreadable,
  };
}

export type Applied = { decision: MarauderDecision; notes: string[] };

/**
 * Apply every decision to the loaded state, in the order they were made. A decision whose
 * entry is no longer in the queue applies nothing and says nothing — its run already
 * happened, and the file stays on disk as the history of it.
 */
export function apply(state: State, decisions: MarauderDecision[]): { state: State; changes: Applied[] } {
  let current = state;
  const changes: Applied[] = [];
  for (const d of decisions) {
    const who: Who = { by: d.by, reason: d.reason, at: d.at || new Date().toISOString() };
    const result: Result =
      d.action === "attach" ? attach(current, d.id, d.feature!, who)
      : d.action === "dismiss" ? dismiss(current, d.id, who)
      : confirmEvent(current, d.id, who);
    current = result.state;
    // the correction already says what it did, in the record's own words
    if (result.changed) changes.push({ decision: d, notes: result.notes });
  }
  return { state: current, changes };
}

export const formatApplied = (changes: Applied[]) =>
  changes.map((c) => `  ${c.decision.by} · ${c.notes.join("; ")}`).join("\n");
