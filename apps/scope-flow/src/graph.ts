/** `flow.ts`'s boxes and arrows as React Flow nodes and edges. */

import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { ACTORS, DECOR, ITEMS, type Item, LINKS } from "./flow.ts";

export type ItemNode = Node<Item>;

export const NODES: ItemNode[] = ITEMS.map((item) => ({
  id: item.id,
  type: item.kind,
  position: { x: item.x, y: item.y },
  data: item,
  draggable: false,
  selectable: !DECOR.has(item.kind),
  focusable: !DECOR.has(item.kind),
  zIndex: DECOR.has(item.kind) ? -1 : 0,
}));

export const EDGES: Edge[] = LINKS.map((link, i) => {
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
