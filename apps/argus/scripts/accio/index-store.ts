/**
 * Build and query the canonical index — `.state/accio-index.json`.
 *
 * The first accio's find command regex-parsed its own generated markdown; that was both
 * fragile and a recall ceiling. Here the index is the single queryable artifact and the
 * arch docs are RENDERED FROM it — the CLI never parses markdown back.
 *
 * Attribution model (measured in the first accio, kept):
 *   - a feature owns the ops its seed files can REACH through the import graph — a hook
 *     holds no URL; the literal lives in the src/http/* module it imports
 *   - traversal enters only data-layer dirs; seeds themselves are unrestricted
 *   - ops beyond ATTR_DEPTH hops are fan-out (auth refresh, cache invalidation), not
 *     the feature's contract — kept, but labelled indirect
 *   - a field's candidate endpoints come from its file AND the parents that render or
 *     import it (2 up) — data flows down as props, so the fetch is upstream. Candidates
 *     are candidates: they route to files, they never claim.
 */

import type { Analysis, FileInfo } from "./analyze.ts";
import type { Op } from "./spec.ts";
import { allCoreFiles, featureDir, type Manifest, type Feature } from "./manifest.ts";

export const ATTR_DEPTH = 2;   // component contract cutoff (measured: d2 == d3 for real features)
export const WALK_DEPTH = 3;   // import-graph traversal bound (measured: d3 == d4)

const DATA_LAYER = [
  /^src\/http\//, /^src\/hooks\//, /^src\/services\//, /^src\/stores\//, /^src\/lib\//,
  /^src\/(features|pages)\/[^/]+\/(hooks|lib)\//,
];
const isDataLayer = (f: string) => DATA_LAYER.some(re => re.test(f));

export type IdxOpRef = { key: string; dist: number; sites: string[] };
export type IdxComponent = {
  slug: string; does: string; files: string[]; aliases: string[];
  ops: IdxOpRef[]; curated: boolean;
};
export type IdxFeature = {
  id: string; name: string; type: "feature" | "shared";
  /** folder under features/ where this feature's docs live */
  dir: string;
  entry_routes: string[]; core_files: string[]; aliases: string[];
  /** backend handler files, curated in the manifest (see `Feature.be_files`) */
  be_files?: string[];
  /** every file attributed to the feature: seeds + data-layer reachable, with depth */
  files: Record<string, number>;
  ops: IdxOpRef[];
  components: IdxComponent[];
};
export type IdxSymbol = {
  name: string; kind: "field" | "export" | "file";
  files: string[]; candidateOps: string[]; guards: string[]; features: string[];
};
export type IdxFileVocab = { visible: string[]; fields: string[]; features: string[] };
export type AccioIndex = {
  builtAt: string; feRev: string; specVersion: string; specOps: number;
  features: IdxFeature[];
  symbols: Record<string, IdxSymbol>;
  /** file -> what a user might call it by (visible UI text, field names) */
  vocab: Record<string, IdxFileVocab>;
  /** "METHOD /path" -> summary + owning features (reverse lookup) */
  ops: Record<string, { summary: string; features: string[] }>;
  /** /api/v1 literals matching no spec path -> files (candidates, not findings) */
  unknownUrls: Record<string, string[]>;
};

/** seeds for a feature: every analyzed file at or under its core paths */
function seedsOf(f: Feature, files: Map<string, FileInfo>): string[] {
  const out: string[] = [];
  const cores = allCoreFiles(f);
  for (const file of files.keys())
    if (cores.some(c => file === c || file.startsWith(c.replace(/\/$/, "") + "/")))
      out.push(file);
  return out;
}

/** BFS from seeds over import edges; traversal enters data-layer files only. */
function reach(seeds: string[], a: Analysis, maxDepth = WALK_DEPTH): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier = seeds.filter(s => a.files.has(s));
  frontier.forEach(s => dist.set(s, 0));
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const f of frontier)
      for (const t of a.files.get(f)?.imports ?? []) {
        if (dist.has(t) || !a.files.has(t) || !isDataLayer(t)) continue;
        dist.set(t, d);
        next.push(t);
      }
    frontier = next;
  }
  return dist;
}

/** ops carried by a reach-set, each at min depth, with call sites. `~` folds when certain twin exists. */
function opsOf(dist: Map<string, number>, a: Analysis): IdxOpRef[] {
  const acc = new Map<string, { dist: number; sites: Set<string> }>();
  for (const [file, d] of dist)
    for (const op of a.files.get(file)?.ops ?? []) {
      const e = acc.get(op) ?? acc.set(op, { dist: d, sites: new Set() }).get(op)!;
      e.dist = Math.min(e.dist, d);
      e.sites.add(file);
    }
  for (const key of [...acc.keys()])
    if (key.startsWith("~") && acc.has(key.slice(1))) {
      const sure = acc.get(key.slice(1))!, un = acc.get(key)!;
      sure.dist = Math.min(sure.dist, un.dist);
      un.sites.forEach(s => sure.sites.add(s));
      acc.delete(key);
    }
  return [...acc].map(([key, v]) => ({ key, dist: v.dist, sites: [...v.sites].sort() }))
    .sort((x, y) => x.dist - y.dist || x.key.localeCompare(y.key));
}

const RESERVED = new Set(["default", "index", "types", "utils", "constants"]);

export function buildIndex(
  a: Analysis, manifest: Manifest, specOps: Op[], feRev: string, specVersion: string,
): AccioIndex {
  const opsByKey = new Map(specOps.map(o => [o.key, o]));
  const features: IdxFeature[] = [];
  const fileFeatures = new Map<string, string[]>();

  for (const f of manifest.features) {
    if (f.orphaned) continue;
    const seeds = seedsOf(f, a.files);
    const dist = reach(seeds, a);
    for (const file of dist.keys())
      (fileFeatures.get(file) ?? fileFeatures.set(file, []).get(file)!).push(f.id);
    const fops = opsOf(dist, a);

    // Curated components first; then derived rows — every attributed file that itself
    // holds call sites is a moving part worth a Component Map row.
    const components: IdxComponent[] = [];
    for (const c of f.components ?? []) {
      const cseeds = (c.files ?? []).flatMap(g =>
        [...a.files.keys()].filter(file => file === g || file.startsWith(g.replace(/\/$/, "") + "/")));
      components.push({
        slug: c.slug, does: c.does ?? "", files: c.files ?? [], aliases: c.aliases ?? [],
        ops: opsOf(reach(cseeds, a), a).filter(o => o.dist <= ATTR_DEPTH), curated: true,
      });
    }
    for (const [file, d] of dist) {
      if (d > ATTR_DEPTH) continue;
      const fi = a.files.get(file)!;
      if (!fi.ops.length) continue;
      const base = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "");
      components.push({
        slug: base, does: "", files: [file], aliases: [],
        ops: fi.ops.map(key => ({ key, dist: d, sites: [file] })), curated: false,
      });
    }

    features.push({
      id: f.id, name: f.name, type: f.type, dir: featureDir(f),
      entry_routes: f.entry_routes, core_files: allCoreFiles(f), aliases: f.aliases,
      be_files: f.be_files,
      files: Object.fromEntries(dist), ops: fops, components,
    });
  }

  // ---- symbols: the code's own vocabulary, candidates via render+import parents (2 up)
  const importParents = new Map<string, string[]>();
  const renderParents = new Map<string, string[]>();
  for (const [from, fi] of a.files) {
    for (const t of fi.imports) (importParents.get(t) ?? importParents.set(t, []).get(t)!).push(from);
    for (const t of fi.renders) (renderParents.get(t) ?? renderParents.set(t, []).get(t)!).push(from);
  }
  const ownReach = (file: string): Set<string> => {
    const acc = new Set<string>();
    for (const [f2] of reach([file], a)) for (const op of a.files.get(f2)?.ops ?? []) acc.add(op.replace(/^~/, ""));
    return acc;
  };
  const candCache = new Map<string, string[]>();
  const candidates = (file: string): string[] => {
    let c = candCache.get(file);
    if (c) return c;
    const acc = ownReach(file);
    let level = [file];
    const seen = new Set(level);
    for (let d = 0; d < 2; d++) {
      const next: string[] = [];
      for (const f2 of level)
        for (const p of [...(renderParents.get(f2) ?? []), ...(importParents.get(f2) ?? [])]) {
          if (seen.has(p)) continue;
          seen.add(p); next.push(p);
          for (const op of ownReach(p)) acc.add(op);
        }
      level = next;
    }
    c = [...acc].sort();
    candCache.set(file, c);
    return c;
  };

  const symbols = new Map<string, IdxSymbol>();
  const addSym = (name: string, kind: IdxSymbol["kind"], file: string, guards: string[]) => {
    const key = name.toLowerCase();
    if (key.length < 3 || RESERVED.has(key)) return;
    const e = symbols.get(key) ?? symbols.set(key, { name, kind, files: [], candidateOps: [], guards: [], features: [] }).get(key)!;
    if (!e.files.includes(file)) e.files.push(file);
    for (const g of guards) if (!e.guards.includes(g)) e.guards.push(g);
    if (kind === "field" && e.kind !== "field") e.kind = "field";   // stronger identity wins
    for (const fid of fileFeatures.get(file) ?? []) if (!e.features.includes(fid)) e.features.push(fid);
  };
  for (const [file, fi] of a.files) {
    for (const n of fi.fields) addSym(n, "field", file, fi.guards);
    for (const n of fi.exports) addSym(n, "export", file, []);
    const base = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "");
    addSym(base, "file", file, fi.guards);
  }
  // candidate ops resolved once per symbol (cap files considered to keep this honest & fast)
  for (const s of symbols.values()) {
    const acc = new Set<string>();
    for (const f of s.files.slice(0, 8)) for (const op of candidates(f)) acc.add(op);
    s.candidateOps = [...acc];
  }

  // ---- per-file vocab (visible strings + fields), reverse op map, unknown urls
  const vocab: Record<string, IdxFileVocab> = {};
  for (const [file, fi] of a.files)
    if (fi.visible.length || fi.fields.length)
      vocab[file] = { visible: fi.visible, fields: fi.fields, features: fileFeatures.get(file) ?? [] };

  const opsOut: AccioIndex["ops"] = {};
  for (const f of features)
    for (const o of f.ops) {
      const e = (opsOut[o.key] ??= { summary: opsByKey.get(o.key.replace(/^~/, ""))?.summary ?? "", features: [] });
      if (o.dist <= ATTR_DEPTH && !e.features.includes(f.id)) e.features.push(f.id);
    }
  for (const o of specOps) opsOut[o.key] ??= { summary: o.summary, features: [] };

  const unknownUrls: Record<string, string[]> = {};
  for (const [file, fi] of a.files)
    for (const u of fi.unknownUrls) (unknownUrls[u] ??= []).push(file);

  return {
    builtAt: new Date().toISOString().slice(0, 10), feRev, specVersion, specOps: specOps.length,
    features, symbols: Object.fromEntries(symbols), vocab, ops: opsOut, unknownUrls,
  };
}
