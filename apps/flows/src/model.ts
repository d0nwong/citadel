/**
 * What a flow is made of. A flow is data: boxes with a position and words, and the arrows
 * between them. Each lives in `flows/<id>.ts` and is listed in `flows/index.ts`; `graph.ts`
 * turns any of them into React Flow nodes and edges, and the rest of the app draws them
 * all the same way.
 */

export type Actor = "you" | "claude" | "argus" | "pensieve" | "linear" | "foundry" | "sweep" | "data";

/** every actor's colour, and its label unless a flow names it more precisely (`Flow.labels`) */
export const ACTORS: Record<Actor, { label: string; color: string }> = {
  you: { label: "You", color: "var(--you)" },
  claude: { label: "Claude", color: "var(--claude)" },
  argus: { label: "argus", color: "var(--argus)" },
  pensieve: { label: "Pensieve", color: "var(--pensieve)" },
  linear: { label: "Linear", color: "var(--linear)" },
  foundry: { label: "Foundry", color: "var(--foundry)" },
  sweep: { label: "Sweep", color: "var(--sweep)" },
  data: { label: "citadel-data", color: "var(--muted)" },
};

/** step: someone acts; gate: the user's explicit yes; file and source: files; phase and rule: layout only */
export type Kind = "step" | "gate" | "file" | "source" | "phase" | "rule";
export const DECOR: ReadonlySet<Kind> = new Set(["phase", "rule"]);

export type Item = {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  actor: Actor;
  title: string;
  /** a step's second line, a file's contents, a phase's note */
  sub?: string;
  /** a file's path, shown in mono */
  path?: string;
  /** the detail panel */
  body?: string;
  reads?: string[];
  writes?: string[];
  rule?: string;
};

export type Side = "t" | "b" | "l" | "r";

export type Link = {
  from: string;
  to: string;
  label?: string;
  /** the side it leaves from; the bottom unless named */
  out?: Side;
  /** the side it arrives at; the top unless named */
  in?: Side;
  /** a loop, a read, or a side exit rather than the main path */
  dashed?: boolean;
  /** coloured as an actor's; grey otherwise */
  tone?: Actor;
};

export type Flow = {
  /** the URL's `#/<id>`: lower-case letters, digits and dashes */
  id: string;
  /** the tab's label */
  name: string;
  title: string;
  lede: string;
  /** what the flow draws, so a change there is a change here */
  source: string;
  /** a more precise name for an actor in this flow, e.g. Claude as "/scope skill" */
  labels?: Partial<Record<Actor, string>>;
  /** the box selected when the flow opens */
  first: string;
  items: Item[];
  links: Link[];
};
