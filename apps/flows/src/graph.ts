/** A flow's boxes and arrows as React Flow nodes and edges, and the legend it needs. */

import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { ACTORS, type Actor, DECOR, type Flow, type Item } from "./model.ts";

/** a box, with its actor's name as this flow says it */
export type BoxData = Item & { who: string };
export type BoxNode = Node<BoxData>;

export const whoIn = (flow: Flow, actor: Actor) => flow.labels?.[actor] ?? ACTORS[actor].label;

export function nodesOf(flow: Flow): BoxNode[] {
  return flow.items.map((item) => ({
    id: item.id,
    type: item.kind,
    position: { x: item.x, y: item.y },
    data: { ...item, who: whoIn(flow, item.actor) },
    draggable: false,
    selectable: !DECOR.has(item.kind),
    focusable: !DECOR.has(item.kind),
    zIndex: DECOR.has(item.kind) ? -1 : 0,
  }));
}

export function edgesOf(flow: Flow): Edge[] {
  return flow.links.map((link, i) => {
    const color = link.tone ? ACTORS[link.tone].color : "var(--edge)";
    return {
      id: `e${i}`,
      source: link.from,
      target: link.to,
      sourceHandle: `s-${link.out ?? "b"}`,
      targetHandle: `t-${link.in ?? "t"}`,
      type: "smoothstep",
      label: link.label,
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 3,
      pathOptions: { borderRadius: 10, offset: 22 },
      focusable: false,
      style: { stroke: color, strokeWidth: link.tone ? 1.8 : 1.4, strokeDasharray: link.dashed ? "5 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    };
  });
}

/** the actors that do a step in this flow, in ACTORS order, and whether it has gates and files */
export function legendOf(flow: Flow): { actors: Actor[]; gates: boolean; files: boolean } {
  const steps = flow.items.filter((i) => i.kind === "step");
  const used = new Set(steps.map((i) => i.actor));
  return {
    actors: (Object.keys(ACTORS) as Actor[]).filter((a) => a !== "data" && used.has(a)),
    gates: flow.items.some((i) => i.kind === "gate"),
    files: flow.items.some((i) => i.kind === "file" || i.kind === "source"),
  };
}
