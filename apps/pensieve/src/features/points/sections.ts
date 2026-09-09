/**
 * The queue's three sections, by who moves a point — the reader's view of the sweep's five
 * groups. The groups stay what argus emits (`Point.group`): Verify has to remain distinct
 * in the data, since a `verified` decision licenses the sweep to make the edit the point
 * names. Only the presentation folds them.
 */

import type { Point, PointGroup } from "#/server/workspace";

export type Section = "act" | "waiting" | "housekeeping";

export const SECTIONS: ReadonlyArray<{
  key: Section;
  label: string;
  hint: string;
}> = [
  { hint: "only you can settle these", key: "act", label: "Your call" },
  {
    hint: "a teammate, or something outside the loop",
    key: "waiting",
    label: "Waiting on others",
  },
  {
    hint: "the blackboard tidying itself",
    key: "housekeeping",
    label: "Housekeeping",
  },
];

const SECTION_OF: Record<PointGroup, Section> = {
  confirm: "waiting",
  decide: "act",
  hold: "waiting",
  housekeeping: "housekeeping",
  verify: "act",
};

export const sectionOf = (point: Pick<Point, "group">): Section =>
  SECTION_OF[point.group];

/**
 * What a waiting row wears instead of its ask. For a Confirm point the ask *is* the name
 * (the sweep writes "Sam", "Foong"), so the tag reads `with Sam`; a hold's ask is already
 * the `waits on …` clause and is shown as it is.
 */
export function waitingTag(
  point: Pick<Point, "group" | "ask">
): string | undefined {
  const ask = point.ask.trim();
  if (point.group === "confirm") {
    return ask ? `with ${ask}` : "with someone";
  }
  if (point.group === "hold") {
    return ask || "on hold";
  }
  return undefined;
}

/**
 * The one verdict a row leads with. Approve exists only for a Verify point — it is the
 * user's confirmation of the sweep's inference. Send leads a Decide point that names a
 * ticket while Foundry is configured; a waiting row (Confirm, On hold) still offers Send
 * when it has a ticket, but never leads with it — the person it waits on comes first.
 * Everything else leads with nothing, and Dismiss is always there.
 */
export function primaryAction(
  point: Pick<Point, "group" | "ticket">,
  foundryOk: boolean
): "approve" | "send" | undefined {
  if (point.group === "verify") {
    return "approve";
  }
  if (point.group === "decide" && point.ticket && foundryOk) {
    return "send";
  }
  return undefined;
}
