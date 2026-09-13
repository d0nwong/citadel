/** One component per kind of box. Every box carries a source and a target handle on each side, so an arrow can leave or arrive anywhere. */

import { Handle, type NodeProps, type NodeTypes, Position } from "@xyflow/react";
import type { CSSProperties } from "react";
import { type Actor, ACTORS } from "./flow.ts";
import type { ItemNode } from "./graph.ts";

const SIDES = [
  ["t", Position.Top],
  ["b", Position.Bottom],
  ["l", Position.Left],
  ["r", Position.Right],
] as const;

function Handles() {
  return SIDES.flatMap(([side, position]) => [
    <Handle id={`s-${side}`} key={`s-${side}`} position={position} type="source" />,
    <Handle id={`t-${side}`} key={`t-${side}`} position={position} type="target" />,
  ]);
}

export const tint = (actor: Actor) => ({ "--a": ACTORS[actor].color }) as CSSProperties;

export function Who({ actor }: { actor: Actor }) {
  return (
    <div className="who" style={tint(actor)}>
      <i />
      {ACTORS[actor].label}
    </div>
  );
}

function Step({ data }: NodeProps<ItemNode>) {
  return (
    <div className="box step" style={tint(data.actor)}>
      <Who actor={data.actor} />
      <b>{data.title}</b>
      <span className="sub">{data.sub}</span>
      <Handles />
    </div>
  );
}

function Gate({ data }: NodeProps<ItemNode>) {
  return (
    <div className="box gate">
      <b>{data.title}</b>
      <span>{data.sub}</span>
      <Handles />
    </div>
  );
}

function File({ data }: NodeProps<ItemNode>) {
  return (
    <div className={data.kind === "source" ? "box file source" : "box file"}>
      <div className="path">{data.path}</div>
      <span className="sub">{data.sub}</span>
      <Handles />
    </div>
  );
}

function Phase({ data }: NodeProps<ItemNode>) {
  return (
    <div className="phase">
      <b>{data.title}</b>
      <span>{data.sub}</span>
    </div>
  );
}

function Rule() {
  return <div className="rule" />;
}

export const nodeTypes: NodeTypes = { step: Step, gate: Gate, file: File, source: File, phase: Phase, rule: Rule };
