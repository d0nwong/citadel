#!/usr/bin/env bun
/**
 * The decisions a person made in Pensieve, applied (LIA-160 AC4).
 *
 * Pensieve is read-only over the blackboard with one exception: it writes decision files.
 * A click on an Unsorted entry lands as `decisions/marauder/<slug>.json`, and this is the
 * other half of that contract — `marauder ingest` reads those files first, applies each
 * through the correction functions in `correct.ts`, and carries on. Nothing else applies
 * them, and nothing here writes: the command does the reading and the writing, as it does
 * for every other verb.
 *
 *   decisions/marauder/<slug>.json
 *   { id, action: "attach" | "new" | "dismiss" | "stage", slug?, name?, reason, at, by }
 *
 * `id` is the entry's own id — a Slack `ts`, `fe#417`, `split/<slug>` — carried inside the
 * file because the file's *name* cannot be: an id is not a path segment, so Pensieve folds
 * it (`lib/marauder.ts` `decisionSlug`) and the fold is not reversible. Matching is on `id`
 * alone, which is why it is in there.
 *
 * Three rules hold this together:
 *
 *   - **The file is never edited and never deleted.** It stays where it is as the history
 *     of who decided what, and the entry leaving the queue is what stops it being applied
 *     twice. Applying it again is a no-op anyway — every correction is idempotent — but a
 *     decision naming an entry that is gone is skipped without a word, not reported as a
 *     problem: that is the normal state of every file after the run that applied it.
 *   - **A malformed file is a problem, and is said out loud.** `readDecisions` in
 *     `points.ts` skips this group whole, so nothing else would ever report it.
 *   - **Oldest first.** Two decisions can name the same workstream, and the record should
 *     read in the order the person made them.
 */

import { join } from "node:path";
import { attach, dismiss, newFrom, setStage, type Result, type State, type Who } from "./correct.ts";
import { USER, type Side, type Stage } from "./record.ts";

/** the group under `decisions/` this reads; `points.ts` skips it by the same name */
export const MARAUDER_GROUP = "marauder";

export type MarauderAction = "attach" | "new" | "dismiss" | "stage";

export type MarauderDecision = {
  id: string;
  action: MarauderAction;
  /** `attach` and `stage` — the workstream it lands on */
  slug?: string;
  /** `new` — what the workstream is called */
  name?: string;
  side?: Side;
  stage?: Stage;
  reason?: string;
  at: string;
  by: string;
};

const ACTIONS: MarauderAction[] = ["attach", "new", "dismiss", "stage"];
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
  if (!ACTIONS.includes(d.action as MarauderAction)) return { error: `action "${String(d.action)}" is not one of ${ACTIONS.join(", ")}` };
  const action = d.action as MarauderAction;
  if ((action === "attach" || action === "stage") && !isStr(d.slug)) return { error: `${action} names no workstream` };
  if (action === "new" && !isStr(d.name)) return { error: "new names no workstream" };
  if (action === "dismiss" && !isStr(d.reason)) return { error: "dismiss gives no reason, and the reason is all that is left of the item" };
  if (action === "stage" && !(isStr(d.side) && isStr(d.stage))) return { error: "stage says no side or no stage" };
  return {
    decision: {
      id: d.id,
      action,
      ...(isStr(d.slug) ? { slug: d.slug } : {}),
      ...(isStr(d.name) ? { name: d.name } : {}),
      ...(isStr(d.side) ? { side: d.side as Side } : {}),
      ...(isStr(d.stage) ? { stage: d.stage as Stage } : {}),
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
      d.action === "attach" ? attach(current, d.id, d.slug!, who)
      : d.action === "new" ? newFrom(current, d.id, { ...who, name: d.name! })
      : d.action === "dismiss" ? dismiss(current, d.id, who)
      : setStage(current, d.slug!, d.side!, d.stage!, who);
    current = result.state;
    // the correction already says what it did, in the record's own words
    if (result.changed) changes.push({ decision: d, notes: result.notes });
  }
  return { state: current, changes };
}

export const formatApplied = (changes: Applied[]) =>
  changes.map((c) => `  ${c.decision.by} · ${c.notes.join("; ")}`).join("\n");
