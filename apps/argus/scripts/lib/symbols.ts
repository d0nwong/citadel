/**
 * Symbol index — the answer to "how does the priority field get populated".
 *
 * Components are the wrong unit for a UI field. The priority field's logic lives in six
 * files across four components (side card, form hook, payload builder, two lib modules),
 * and no hand-curated `files:` glob will ever track that. But the code already names the
 * thing: `taskPriority` appears in exactly those six files.
 *
 * So this indexes the code's own vocabulary — form field names, exported symbols, file
 * basenames — and joins each to the endpoints reachable from the files that mention it.
 * Nothing here is curated, so nothing here goes stale.
 */

export type Symbol = {
  name: string;
  kind: "field" | "export" | "file";
  files: string[];
  /** endpoints reachable from any file mentioning this symbol */
  ops: string[];
  /** guards found next to a call or on the field — partial, see extractGuards */
  guards: string[];
};

const RESERVED = new Set([
  "default", "props", "children", "className", "value", "onChange", "data", "index",
  "type", "name", "id", "key", "ref", "style", "error", "loading", "state",
]);

const kebabToWords = (s: string) => s.replace(/[-_]/g, " ");
const splitCamel = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/**
 * Form field names — the strings a UI field is addressed by. These are what a person
 * means when they say "the priority field": `taskPriority` in react-hook-form.
 */
function extractFields(text: string): string[] {
  const out = new Set<string>();
  const pats = [
    /\bform\.(?:watch|getValues|setValue|resetField|clearErrors)\(\s*["'`]([\w.]+)["'`]/g,
    /\b(?:watch|getValues|setValue|register)\(\s*["'`]([\w.]+)["'`]/g,
    /\bname=["'`]([\w.]+)["'`]/g,
    /\bname:\s*["'`]([\w.]+)["'`]/g,
  ];
  for (const re of pats)
    for (const m of text.matchAll(re)) {
      const n = m[1].split(".")[0];
      if (n.length >= 3 && !RESERVED.has(n)) out.add(n);
    }
  return [...out];
}

/** Exported components and hooks — `TaskPriorityField`, `useTaskDetailForm`. */
function extractExports(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm))
    if (m[1].length >= 4 && !RESERVED.has(m[1])) out.add(m[1]);
  for (const m of text.matchAll(/^export\s+default\s+function\s+([A-Za-z_$][\w$]*)/gm))
    out.add(m[1]);
  return [...out];
}

/**
 * Guards — a partial answer to "under what condition is this called".
 *
 * Deliberately narrow: react-query's `enabled:`, and readOnly/disabled on a field. Full
 * condition extraction is a dataflow problem and regex will not do it honestly, so this
 * captures only the few forms that are unambiguous and points at the file for the rest.
 */
function extractGuards(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\benabled:\s*([^,\n}]{1,60})/g)) out.add(`enabled: ${m[1].trim()}`);
  for (const m of text.matchAll(/\b(readOnly|disabled)=\{([^}\n]{1,60})\}/g)) out.add(`${m[1]}={${m[2].trim()}}`);
  return [...out];
}

type Graph = {
  fileOps: Map<string, string[]>;
  edges: Map<string, string[]>;
  allEdges: Map<string, string[]>;
};

/** Every op reachable from `file`, walking the import graph already built by collectUsage. */
function reachable(file: string, graph: { fileOps: Map<string, string[]>; edges: Map<string, string[]> }): Set<string> {
  const acc = new Set<string>(), seen = new Set<string>(), stack = [file];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const o of graph.fileOps.get(f) ?? []) acc.add(o.replace(/^~/, ""));
    for (const t of graph.edges.get(f) ?? []) stack.push(t);
  }
  return acc;
}

/** file -> files that import it, inverted once and reused. */
function invert(allEdges: Map<string, string[]>): Map<string, string[]> {
  const rev = new Map<string, string[]>();
  for (const [from, tos] of allEdges)
    for (const to of tos) (rev.get(to) ?? rev.set(to, []).get(to)!).push(from);
  return rev;
}

/**
 * A field is populated by whoever fetched the data and passed it down, so the endpoints
 * that matter are those reachable from this file OR from the parents that render it.
 * Bounded to 2 hops up: unbounded, every leaf inherits the whole app's traffic.
 */
function reachableWithParents(file: string, graph: Graph, rev: Map<string, string[]>, up = 2): Set<string> {
  const acc = reachable(file, graph);
  let level = [file];
  const seen = new Set([file]);
  for (let d = 0; d < up; d++) {
    const next: string[] = [];
    for (const f of level)
      for (const parent of rev.get(f) ?? []) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        next.push(parent);
        for (const o of reachable(parent, graph)) acc.add(o);
      }
    level = next;
  }
  return acc;
}

export async function buildSymbols(
  feRoot: string,
  graph: Graph,
): Promise<Map<string, Symbol>> {
  const rev = invert(graph.allEdges);
  const index = new Map<string, Symbol>();
  const add = (name: string, kind: Symbol["kind"], file: string, ops: Set<string>, guards: string[]) => {
    const key = name.toLowerCase();
    const e = index.get(key) ?? { name, kind, files: [], ops: [], guards: [] };
    if (!e.files.includes(file)) e.files.push(file);
    for (const o of ops) if (!e.ops.includes(o)) e.ops.push(o);
    for (const g of guards) if (!e.guards.includes(g)) e.guards.push(g);
    // a field name is a stronger identity than a filename that happens to collide
    if (kind === "field" && e.kind !== "field") e.kind = "field";
    index.set(key, e);
  };

  for (const file of graph.fileOps.keys()) {
    const text = await Bun.file(`${feRoot}/${file}`).text().catch(() => null);
    if (text === null) continue;
    const ops = reachableWithParents(file, graph, rev);
    const guards = extractGuards(text);

    for (const f of extractFields(text)) add(f, "field", file, ops, guards);
    for (const x of extractExports(text)) add(x, "export", file, ops, []);

    const base = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "").replace(/\.test$/, "");
    if (base) add(base, "file", file, ops, guards);
  }
  return index;
}

/** Searchable text for a symbol — its own name in every spelling a person might type. */
export const symbolText = (s: Symbol) =>
  [s.name, kebabToWords(s.name), splitCamel(s.name), splitCamel(s.name).replace(/\s+/g, ""),
   ...s.files.map(f => kebabToWords((f.split("/").pop() ?? "").replace(/\.\w+$/, "")))].join(" ");
