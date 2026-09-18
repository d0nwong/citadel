#!/usr/bin/env bun
/**
 * accio map — derive the feature manifest from the frontend's own route tree.
 *
 * TanStack file-based routing makes this mechanical: every src/routes/** file names its
 * URL in createFileRoute("/…"), and its imports name the page directories. Features are
 * route groups; shared modules are the top-level src dirs everything imports from.
 *
 *   accio map            propose/refresh the manifest (curated fields survive, see merge)
 *   accio map --dry      print what would change, write nothing
 */

import { flatten, indexOps } from "./spec.ts";
import { analyzeRepo, type Analysis } from "./analyze.ts";
import {
  loadManifest, saveManifest, merge, humanize, expand,
  MANIFEST_PATH, STATE, DEFAULT_ALDEN_FE_REPO, DEFAULT_ALDEN_BE_REPO, type Manifest, type Feature,
} from "./manifest.ts";
import { join, relative } from "node:path";

const DRY = process.argv.includes("--dry");

/** "/_authenticated/admin/clients_/$clientId" -> ["admin","clients"] */
function segmentsOf(routePath: string): string[] {
  return routePath.split("/")
    .map(s => s.replace(/_$/, ""))
    .filter(s => s && s !== "_authenticated" && !s.startsWith("$") && s !== "index");
}

/** Route group -> feature id. Two segments beat one ("admin-clients"), params fold in.
 *  All auth/* routes are one surface; the index route is named after its page dir later. */
const featureId = (segs: string[]) => segs[0] === "auth" ? "auth" : segs.slice(0, 2).join("-") || "home";
const cleanRoute = (routePath: string) =>
  "/" + routePath.split("/").filter(s => s && s !== "_authenticated").map(s => s.replace(/_$/, "")).join("/");

/** A route file's page seeds: its imports that live under src/pages or src/features,
 *  lifted to feature-directory granularity so new files are covered automatically. */
function seedDirs(routeFile: string, a: Analysis): string[] {
  const out = new Set<string>();
  out.add(routeFile);
  for (const imp of a.files.get(routeFile)?.imports ?? []) {
    const m = imp.match(/^(src\/(?:pages|features)\/[^/]+(?:\/[^/]+)?)\//)
      ?? imp.match(/^(src\/(?:pages|features)\/[^/]+)$/);
    if (m) {
      // lift src/pages/admin/clients/index.tsx -> src/pages/admin/clients,
      // but src/pages/dashboard/index.tsx -> src/pages/dashboard
      const head = m[1] ?? imp;
      const dir = head.split("/").length > 3 && !/^src\/(pages|features)\/(admin)\//.test(imp)
        ? head.split("/").slice(0, 3).join("/") : head;
      out.add(dir);
    } else if (/^src\//.test(imp)) out.add(imp);
  }
  return [...out];
}

/** Shared modules per DOC-PROTOCOL: cross-cutting dirs used by 2+ features. */
const SHARED_DIRS: [id: string, dir: string, name: string][] = [
  ["shared-api-client", "src/lib", "API Client & Lib"],
  ["shared-http", "src/http", "HTTP Layer"],
  ["shared-hooks", "src/hooks", "Shared Hooks"],
  ["shared-stores", "src/stores", "Shared Stores"],
  ["shared-components", "src/components", "Shared Components"],
  ["shared-context", "src/context", "App Context"],
];

export async function deriveManifest(a: Analysis, feRepo: string): Promise<Manifest> {
  const groups = new Map<string, { routes: Set<string>; files: Set<string> }>();
  for (const r of a.routes) {
    const segs = segmentsOf(r.path);
    // the pathless layout route (_authenticated/route.tsx) wraps EVERY screen — overlays
    // mounted there (task detail, draft modal) belong to the app shell, not to "home"
    const id = !segs.length && /\/route\.tsx$/.test(r.file) ? "app-shell" : featureId(segs);
    const g = groups.get(id) ?? groups.set(id, { routes: new Set(), files: new Set() }).get(id)!;
    g.routes.add(cleanRoute(r.path));
    for (const s of seedDirs(r.file, a)) g.files.add(s);
  }
  // the index route ("/") deserves its page's name, not "home"
  const home = groups.get("home");
  if (home) {
    const page = [...home.files].map(f => f.match(/^src\/pages\/([^\/]+)/)?.[1]).find(Boolean);
    if (page && !groups.has(page)) { groups.delete("home"); groups.set(page, home); }
  }
  // A feature's own modules under src/features/<x> are reached through component imports
  // the route file never names directly — walk the UI import graph to surface them as seeds.
  for (const g of groups.values()) {
    let frontier = [...a.files.keys()].filter(f =>
      [...g.files].some(c => f === c || f.startsWith(c.replace(/\/$/, "") + "/")));
    const seen = new Set(frontier);
    for (let d = 0; d < 3 && frontier.length; d++) {
      const next: string[] = [];
      for (const f of frontier)
        for (const t of a.files.get(f)?.imports ?? []) {
          if (seen.has(t)) continue;
          seen.add(t);
          const m = t.match(/^(src\/features\/[^/]+)\//);
          if (m?.[1]) g.files.add(m[1]);
          if (/^src\/(pages|features|components)\//.test(t)) next.push(t);
        }
      frontier = next;
    }
  }

  const features: Feature[] = [...groups].map(([id, g]) => ({
    id, name: humanize(id), type: "feature" as const, status: "pending" as const,
    entry_routes: [...g.routes].sort(),
    core_files: [...g.files].sort(),
    aliases: [],
  }));
  for (const [id, dir, name] of SHARED_DIRS) {
    if (![...a.files.keys()].some(f => f.startsWith(dir + "/"))) continue;
    features.push({
      id, name, type: "shared", status: "pending",
      entry_routes: [], core_files: [dir], aliases: [],
    });
  }
  return { app: "alden-portal", fe_repo: feRepo, features };
}

if (import.meta.main) {
  const existing = await loadManifest();
  const feRepo = existing?.fe_repo ?? DEFAULT_ALDEN_FE_REPO;
  const doc = await Bun.file(join(STATE, "openapi.json")).json()
    .catch(() => { console.error("error: no cached spec — run `accio sync` once first"); process.exit(1); });
  const idx = indexOps(doc, flatten(doc));
  const a = await analyzeRepo(expand(feRepo), idx);
  const derived = await deriveManifest(a, feRepo);
  derived.be_repo = existing?.be_repo ?? DEFAULT_ALDEN_BE_REPO;
  const merged = merge(existing, derived);

  const oldIds = new Set(existing?.features.map(f => f.id) ?? []);
  const added = merged.features.filter(f => !oldIds.has(f.id));
  const orphaned = merged.features.filter(f => f.orphaned);
  console.log(`routes: ${a.routes.length} → features: ${merged.features.filter(f => f.type === "feature").length}` +
    ` + ${merged.features.filter(f => f.type === "shared").length} shared`);
  for (const f of merged.features.filter(f => f.type === "feature"))
    console.log(`  ${f.id.padEnd(26)} ${String(f.entry_routes.length).padStart(2)} routes  ${f.core_files.length} seed paths${oldIds.size && !oldIds.has(f.id) ? "  (new)" : ""}`);
  if (orphaned.length) console.log(`⚠ orphaned (routes gone): ${orphaned.map(f => f.id).join(", ")}`);
  if (DRY) { console.log("\n--dry: nothing written"); process.exit(0); }
  await saveManifest(merged);
  console.log(`\nwrote ${relative(process.cwd(), MANIFEST_PATH)}${added.length ? ` (+${added.length} new)` : ""}`);
}
