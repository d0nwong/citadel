/** The detail beside the map: what the selected box is, what it reads and writes, and the rule it keeps. */

import type { BoxData } from "./graph.ts";
import { Who } from "./nodes.tsx";

function Paths({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  );
}

export function Panel({ box }: { box: BoxData }) {
  return (
    <aside aria-live="polite" className="panel">
      <Who actor={box.actor} label={box.who} />
      <h2>{box.path ?? box.title}</h2>
      {box.path && <p className="also">{box.title}</p>}
      <p>{box.body}</p>
      <dl>
        <Paths items={box.reads} label="Reads" />
        <Paths items={box.writes} label="Writes" />
        {box.rule && (
          <div>
            <dt>Rule</dt>
            <dd>{box.rule}</dd>
          </div>
        )}
      </dl>
      <p className="hint">Click a box, or tab to one and press Enter. Drag to pan; pinch or scroll to zoom.</p>
    </aside>
  );
}
