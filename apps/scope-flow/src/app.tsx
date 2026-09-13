/**
 * The page: a title and legend, the map, and the panel for the selected box. Selection is
 * the one piece of state: React Flow reports a click or an Enter as a `select` change, and
 * the nodes are rebuilt with that one marked.
 */

import { Background, Controls, type NodeChange, ReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTORS, type Actor, FIRST, ITEMS } from "./flow.ts";
import { EDGES, type ItemNode, NODES } from "./graph.ts";
import { nodeTypes, tint } from "./nodes.tsx";
import { Panel } from "./panel.tsx";

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const LEGEND: Actor[] = ["you", "scope", "argus", "linear", "foundry", "sweep"];

type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("scope-flow:theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem("scope-flow:theme", theme);
    } catch {
      // private window or blocked storage: the choice lasts this visit only
    }
  }, [theme]);
  return [theme, setTheme];
}

export function App() {
  const [selected, setSelected] = useState(FIRST);
  const [theme, setTheme] = useTheme();
  const nodes = useMemo(() => NODES.map((n) => ({ ...n, selected: n.id === selected })), [selected]);
  const onNodesChange = useCallback((changes: NodeChange<ItemNode>[]) => {
    for (const c of changes) if (c.type === "select" && c.selected) setSelected(c.id);
  }, []);
  const item = BY_ID.get(selected) ?? ITEMS[0];

  return (
    <div className="wrap">
      <header>
        <div>
          <p className="eyebrow">citadel · /scope</p>
          <h1>From a ramble to a live spec</h1>
          <p className="lede">
            Your notes become a filed revision, its sub-issues run through Foundry, and the sweep folds its specs in as the
            new baseline once the parent is Done.
          </p>
        </div>
        <div className="aside-head">
          <fieldset className="theme">
            <legend className="sr">Theme</legend>
            {THEMES.map((t) => (
              <label key={t}>
                <input checked={theme === t} id={`theme-${t}`} name="theme" onChange={() => setTheme(t)} type="radio" />
                {t}
              </label>
            ))}
          </fieldset>
          <ul aria-label="Who does each step" className="legend">
            <li>
              <span className="swatch swatch-gate" />
              Your yes
            </li>
            {LEGEND.map((a) => (
              <li key={a}>
                <span className="swatch" style={tint(a)} />
                {ACTORS[a].label}
              </li>
            ))}
            <li>
              <span className="swatch swatch-file" />
              File in citadel-data
            </li>
          </ul>
        </div>
      </header>
      <main className="stage">
        <div className="canvas">
          <ReactFlow
            edges={EDGES}
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
        <Panel item={item} />
      </main>
    </div>
  );
}
