/**
 * Resolve which API operations a feature's code actually calls.
 *
 * Two call styles exist in alden-portal-fe and both are followed:
 *   1. the orval-generated client — `getApiV1CatalogueApps(...)` / `useGetApiV1...`
 *   2. a hand-written layer — `api.get('/api/v1/dashboard/myTeamLeadDashboard')`
 *
 * Feature files rarely call either directly; they import a hook, which imports an http
 * module, which makes the call. So this walks the import graph — but only into the data
 * layer (`http/`, `hooks/`, `services/`, `stores/`, `lib/`) and never into the generated
 * client itself. Traversing the generated client would pull its barrel and make every
 * feature look like it calls all 448 operations; instead its symbols resolve by name,
 * which is exact because orval's naming is a pure function of method + path.
 */

import { dirname, resolve as rp, relative } from "node:path";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** orval's name for an operation: method + PascalCase of each path segment. */
export const orvalName = (method: string, path: string) =>
  method.toLowerCase() + path.split("/").filter(Boolean)
    .map(s => s.replace(/[{}]/g, ""))
    .map(s => s.split("-").map(w => (w[0] ?? "").toUpperCase() + w.slice(1)).join(""))
    .join("");

/** `${taskId}` and `{taskId}` both collapse, so code URLs match spec paths. */
const normPath = (u: string) =>
  u.replace(/\$\{[^}]*\}/g, "{p}").replace(/\{[^}]*\}/g, "{p}").replace(/\?.*$/, "").replace(/\/+$/, "");

export type OpIndex = {
  byName: Map<string, string>;              // orvalName -> "METHOD /path"
  byPath: Map<string, { methods: string[]; path: string }>; // normalised path -> spec path
};

export function indexOps(doc: any): OpIndex {
  const byName = new Map<string, string>();
  const byPath = new Map<string, { methods: string[]; path: string }>();
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    const methods = Object.keys(item).filter(m => (METHODS as readonly string[]).includes(m));
    if (!methods.length) continue;
    byPath.set(normPath(path), { methods, path });
    for (const m of methods) byName.set(orvalName(m, path), `${m.toUpperCase()} ${path}`);
  }
  return { byName, byPath };
}

export type Usage = {
  /** "METHOD /path" -> repo-relative files where the call literal appears */
  ops: Map<string, Set<string>>;
  /**
   * Seed file -> every op REACHABLE from it through the import graph.
   *
   * This is the one attribution that answers "what does this component call?". A hook
   * like `use-task-inline-saves.ts` contains no URL of its own — it imports an
   * `src/http/*` module that holds the literal. Attributing to the call site would file
   * every such op under shared data-layer code and make the hook look pure.
   *
   * The value is the import distance at which the op was found. Distance matters because
   * unbounded reachability over-attributes: everything eventually reaches the shared axios
   * client (`POST /auth/refresh`) and the dashboard invalidation helpers. Callers filter.
   */
  opsBySeed: Map<string, Map<string, number>>;
  /** URL literals in the code that match no spec path -> files */
  undocumented: Map<string, Set<string>>;
  filesScanned: number;
  seeds: number;
  maxDepthReached: number;
  /**
   * The raw graph, kept so callers can index at a finer grain than the component.
   * A UI field's logic is routinely spread across files in several components — the
   * priority field touches the side card, the form hook, the payload builder and two
   * lib modules — so anything field-shaped has to be answered per file, not per component.
   */
  graph: {
    fileOps: Map<string, string[]>;
    /** data-layer edges only — what the op-reachability BFS walks */
    edges: Map<string, string[]>;
    /**
     * EVERY resolved local import, data layer or not. Needed because data flows down as
     * props while imports point up: a field rendered in `task-detail-side-card.tsx` is
     * populated by a fetch its *parent* made, which forward reachability can never see.
     */
    allEdges: Map<string, string[]>;
  };
};

const DATA_LAYER = [
  /\/src\/http\//, /\/src\/hooks\//, /\/src\/services\//, /\/src\/stores\//, /\/src\/lib\//,
  // A feature's own hooks/ and lib/ are its data layer too. Without these, the hook that
  // actually fetches (`features/tasks/hooks/use-task-detail-view.ts`) is not a hop the
  // walk will take, and every field rendered from its data looks like it calls nothing.
  /\/src\/features\/[^/]+\/(hooks|lib)\//,
];
const isGenerated = (f: string) => f.includes("/src/http/generated/");

async function resolveImport(spec: string, from: string, src: string): Promise<string | null> {
  let base: string;
  if (spec.startsWith("@/")) base = rp(src, spec.slice(2));
  else if (spec.startsWith(".")) base = rp(dirname(from), spec);
  else return null; // package import — not ours
  for (const c of [base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"])
    if (await Bun.file(c).exists()) return c;
  return null;
}

/** Every API reference in one file, with the method recovered where the code makes it knowable. */
function scanFile(text: string, idx: OpIndex): { ops: string[]; unknown: string[] } {
  const ops: string[] = [], unknown: string[] = [];

  // 1. generated-client symbols — both the base function (`getApiV1Tasks`) and the React
  //    hook (`useGetApiV1Tasks`). The hook capitalises the method after `use`, so the
  //    method alternation must accept both cases or every hook call goes unseen — which
  //    is most of them, since components consume hooks, not the base functions.
  for (const m of text.matchAll(/\b(?:use)?((?:[gG]et|[pP]ost|[pP]ut|[pP]atch|[dD]elete)ApiV1[A-Za-z0-9]*)\b/g)) {
    const n = m[1][0].toLowerCase() + m[1].slice(1);
    const hit = idx.byName.get(n);
    if (hit) ops.push(hit);
  }

  // 2. inline `api.get('/api/v1/...')` — method is right there
  const inline = /\bapi\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*["'`](\/api\/v1\/[^"'`]*)["'`]/g;
  const claimed = new Set<string>();
  for (const m of text.matchAll(inline)) {
    claimed.add(m[2]);
    const e = idx.byPath.get(normPath(m[2]));
    if (e) ops.push(`${m[1].toUpperCase()} ${e.path}`); else unknown.push(m[2]);
  }

  // 3. `const url = '/api/v1/...'` then `api.get(url)` — the dominant hand-written shape
  const vars = new Map<string, string>();
  for (const m of text.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`](\/api\/v1\/[^"'`]*)["'`]/g))
    vars.set(m[1], m[2]);
  for (const m of text.matchAll(/\bapi\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([A-Za-z_$][\w$]*)\b/g)) {
    const url = vars.get(m[2]);
    if (!url) continue;
    claimed.add(url);
    const e = idx.byPath.get(normPath(url));
    if (e) ops.push(`${m[1].toUpperCase()} ${e.path}`); else unknown.push(url);
  }

  // 4. anything left over — path known, method not. Record every method the spec defines
  //    for it rather than guessing, and mark it so the renderer can flag the uncertainty.
  for (const m of text.matchAll(/["'`](\/api\/v1\/[^"'`\s]*)["'`]/g)) {
    if (claimed.has(m[1])) continue;
    const e = idx.byPath.get(normPath(m[1]));
    if (e) e.methods.forEach(mm => ops.push(`~${mm.toUpperCase()} ${e.path}`));
    else unknown.push(m[1]);
  }
  return { ops, unknown };
}

export async function collectUsage(
  feRoot: string, seedGlobs: string[], idx: OpIndex, maxDepth = 3,
): Promise<Usage> {
  const src = rp(feRoot, "src");
  const seeds: string[] = [];
  for (const g of seedGlobs) {
    const pattern = /[*.]/.test(g.split("/").pop() ?? "") ? g : g.replace(/\/$/, "") + "/**/*.{ts,tsx}";
    for await (const f of new Bun.Glob(pattern).scan({ cwd: feRoot, absolute: true }))
      if (/\.tsx?$/.test(f)) seeds.push(f);
  }

  const ops = new Map<string, Set<string>>(), undocumented = new Map<string, Set<string>>();
  const seen = new Set<string>();
  // Phase A — walk the graph once, recording each file's own calls and its edges.
  const fileOps = new Map<string, string[]>(), edges = new Map<string, string[]>();
  const allEdges = new Map<string, string[]>();
  let frontier = seeds.map(f => [f, 0] as [string, number]);
  let deepest = 0;

  while (frontier.length) {
    const next: [string, number][] = [];
    for (const [file, depth] of frontier) {
      if (seen.has(file)) continue;
      seen.add(file);
      deepest = Math.max(deepest, depth);
      const text = await Bun.file(file).text().catch(() => null);
      if (text === null) continue;

      const where = relative(feRoot, file);
      const { ops: found, unknown } = scanFile(text, idx);
      fileOps.set(file, found);
      for (const o of found) (ops.get(o) ?? ops.set(o, new Set()).get(o)!).add(where);
      for (const u of unknown) (undocumented.get(u) ?? undocumented.set(u, new Set()).get(u)!).add(where);

      // Structural edges are recorded even at the depth limit and even for files the op
      // walk will not enter — they are what makes the upward lookup possible.
      const structural: string[] = [];
      for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?[^'"]*?\bfrom\s*["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const t = await resolveImport(m[2], file, src);
        if (t) structural.push(t);
      }
      allEdges.set(file, structural);

      if (depth >= maxDepth) continue;
      const out: string[] = [];
      // `import type {...} from "..."` erases at compile time and causes no request.
      // Following it would attribute the target's calls to a pure module — which is
      // exactly how `lib/` first appeared to hit the network.
      for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?[^'"]*?\bfrom\s*["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const target = await resolveImport(m[2], file, src);
        if (target && !isGenerated(target) && DATA_LAYER.some(re => re.test(target))) {
          out.push(target);
          next.push([target, depth + 1]);
        }
      }
      edges.set(file, out);
    }
    frontier = next;
  }

  // Phase B — per seed, union the calls of everything it can reach. The graph is already
  // bounded by phase A, so this walk needs no depth limit of its own.
  const opsBySeed = new Map<string, Map<string, number>>();
  for (const seed of seeds) {
    const acc = new Map<string, number>(), walked = new Set<string>();
    let level = [seed], dist = 0;
    while (level.length) {
      const nextLevel: string[] = [];
      for (const f of level) {
        if (walked.has(f)) continue;
        walked.add(f);
        for (const o of fileOps.get(f) ?? []) if (!acc.has(o)) acc.set(o, dist);
        for (const t of edges.get(f) ?? []) nextLevel.push(t);
      }
      level = nextLevel; dist++;
    }
    opsBySeed.set(relative(feRoot, seed), acc);
  }

  // A "~METHOD path" entry is redundant once the same op is known with certainty.
  for (const key of [...ops.keys()]) {
    if (!key.startsWith("~")) continue;
    const certain = key.slice(1);
    if (ops.has(certain)) {
      for (const f of ops.get(key)!) ops.get(certain)!.add(f);
      ops.delete(key);
    }
  }

  for (const acc of opsBySeed.values())
    for (const key of [...acc.keys()]) if (key.startsWith("~") && acc.has(key.slice(1))) acc.delete(key);

  const relKey = <T,>(m: Map<string, T>) =>
    new Map([...m].map(([k, v]) => [relative(feRoot, k), v] as [string, T]));

  return {
    ops, opsBySeed, undocumented,
    filesScanned: seen.size, seeds: seeds.length, maxDepthReached: deepest,
    graph: {
      fileOps: relKey(fileOps),
      edges: new Map([...edges].map(([k, v]) => [relative(feRoot, k), v.map(t => relative(feRoot, t))])),
      allEdges: new Map([...allEdges].map(([k, v]) => [relative(feRoot, k), v.map(t => relative(feRoot, t))])),
    },
  };
}
