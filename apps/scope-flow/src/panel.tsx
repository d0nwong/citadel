/** The detail beside the map: what the selected box is, what it reads and writes, and the rule it keeps. */

import type { Item } from "./flow.ts";
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

export function Panel({ item }: { item: Item }) {
  return (
    <aside aria-live="polite" className="panel">
      <Who actor={item.actor} />
      <h2>{item.path ?? item.title}</h2>
      {item.path && <p className="also">{item.title}</p>}
      <p>{item.body}</p>
      <dl>
        <Paths items={item.reads} label="Reads" />
        <Paths items={item.writes} label="Writes" />
        {item.rule && (
          <div>
            <dt>Rule</dt>
            <dd>{item.rule}</dd>
          </div>
        )}
      </dl>
      <p className="hint">Click a box, or tab to one and press Enter. Drag to pan; pinch or scroll to zoom.</p>
    </aside>
  );
}
