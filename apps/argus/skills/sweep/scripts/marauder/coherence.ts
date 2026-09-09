#!/usr/bin/env bun
/**
 * marauder check — is this still one thing? (LIA-158)
 *
 * The opposite failure to a bad attachment. Over-merging is what turned "Invoicing" into a
 * bucket: a workstream quietly absorbs a second capability, and its page stops meaning
 * anything to the person reading it. A workstream that has been busy for a fortnight is
 * where that happens, so those are the ones this prints.
 *
 * It prints and stops. No script here calls a model: `check` lays out each busy
 * workstream's name, what done means, and its recent events with the id each is named by;
 * the sweep step reads them and, where two separable pieces of work are visible, writes the
 * proposal with `marauder propose-split`. Nothing splits anything on its own.
 */

import { eventKeys, instantOf, type Workstream, type WorkstreamEvent, type UnsortedItem } from "./record.ts";

/** busy enough that two capabilities could be hiding in it */
export const BUSY_EVENTS = 6;
export const WINDOW_DAYS = 14;

export type Busy = { workstream: Workstream; recent: { id: string; event: WorkstreamEvent }[] };

const since = (now: string, days: number) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
};

/**
 * The workstreams worth a second look: enough recent events to hide a second thing, and no
 * split already waiting, because asking twice about the same workstream is noise.
 */
export function busy(workstreams: Workstream[], unsorted: UnsortedItem[], now: string, days = WINDOW_DAYS): Busy[] {
  const from = since(now, days);
  const pending = new Set(unsorted.filter((u) => u.kind === "split").map((u) => u.slug));
  return workstreams
    .filter((w) => !w.parked && !pending.has(w.slug))
    .map((w) => {
      const ids = eventKeys(w);
      return {
        workstream: w,
        recent: w.events
          .map((event, i) => ({ id: ids[i]!, event }))
          .filter((x) => instantOf(x.event.at) >= from)
          .sort((a, b) => instantOf(a.event.at).localeCompare(instantOf(b.event.at))),
      };
    })
    .filter((x) => x.recent.length >= BUSY_EVENTS)
    .sort((a, b) => b.recent.length - a.recent.length);
}

/** what a reader needs in front of them to answer "is this still one thing?" */
export function formatCheck(list: Busy[]): string {
  if (!list.length) return "marauder: nothing has been busy enough this fortnight to be worth a second look.";
  const out: string[] = [
    `${list.length} workstream${list.length === 1 ? "" : "s"} busy enough to be worth asking about.`,
    "For each: do these events describe one thing a person would ask \"is that done yet?\" about,",
    "or two? If two, group the ids and run:",
    "  marauder propose-split <slug> --groups '[{\"name\":\"…\",\"events\":[\"…\"]},{\"name\":\"…\",\"events\":[\"…\"]}]'",
    "",
  ];
  for (const { workstream: w, recent } of list) {
    out.push(`## ${w.slug} — ${w.name}`, `   done means: ${w.done}`, "");
    for (const { id, event } of recent) out.push(`   ${id.padEnd(24)} ${event.at.slice(0, 10)}  ${event.summary}`);
    out.push("");
  }
  return out.join("\n");
}
