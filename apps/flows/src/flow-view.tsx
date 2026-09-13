/**
 * One flow: its title and legend, the map, and the panel for the selected box. Selection
 * is the one piece of state: React Flow reports a click or an Enter as a `select` change,
 * and the nodes are rebuilt with that one marked. The app keys this by the flow's id, so
 * opening another flow starts fresh and fits the view again.
 */

import { Background, Controls, type NodeChange, ReactFlow } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { type BoxNode, edgesOf, legendOf, nodesOf, whoIn } from "./graph.ts";
import type { Flow } from "./model.ts";
import { nodeTypes, tint } from "./nodes.tsx";
import { Panel } from "./panel.tsx";

export function FlowView({ flow }: { flow: Flow }) {
  const [selected, setSelected] = useState(flow.first);
  const base = useMemo(() => nodesOf(flow), [flow]);
  const edges = useMemo(() => edgesOf(flow), [flow]);
  const legend = useMemo(() => legendOf(flow), [flow]);
  const nodes = useMemo(() => base.map((n) => ({ ...n, selected: n.id === selected })), [base, selected]);
  const onNodesChange = useCallback((changes: NodeChange<BoxNode>[]) => {
    for (const c of changes) if (c.type === "select" && c.selected) setSelected(c.id);
  }, []);
  const box = (base.find((n) => n.id === selected) ?? base[0]).data;

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">citadel · {flow.name}</p>
          <h1>{flow.title}</h1>
          <p className="lede">{flow.lede}</p>
        </div>
        <ul aria-label="Who does each step" className="legend">
          {legend.gates && (
            <li>
              <span className="swatch swatch-gate" />
              Your yes
            </li>
          )}
          {legend.actors.map((a) => (
            <li key={a}>
              <span className="swatch" style={tint(a)} />
              {whoIn(flow, a)}
            </li>
          ))}
          {legend.files && (
            <li>
              <span className="swatch swatch-file" />
              File in citadel-data
            </li>
          )}
        </ul>
      </header>
      <main className="stage">
        <div className="canvas">
          <ReactFlow
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.04 }}
            maxZoom={1.6}
            minZoom={0.25}
            nodes={nodes}
            nodesConnectable={false}
            nodesDraggable={false}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Panel box={box} />
      </main>
    </>
  );
}
