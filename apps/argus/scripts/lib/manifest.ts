/**
 * The feature manifest — the ONE curated file (DOC-PROTOCOL `.doc-workspace/feature-manifest.json`).
 *
 * `accio map` writes the mechanical fields (entry_routes, core_files) from the route tree;
 * humans and agent sessions own the rest (name, aliases, components, status). merge() is
 * the contract that makes that safe: regeneration never clobbers a curated field.
 *
 * This replaces the first accio's per-feature project.yaml `api:` blocks — one file,
 * mostly machine-written, instead of eight hand-tuned selector sets.
 */

import { join } from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const APP_DIR = join(ROOT, "alden/alden-portal");
export const MANIFEST_PATH = join(APP_DIR, ".doc-workspace/feature-manifest.json");
export const FEATURES_DIR = join(APP_DIR, "features");
export const STATE = join(ROOT, ".state");
export const DEFAULT_FE_REPO = "~/git/alden/alden-portal-fe";
export const expand = (p: string) => p.replace(/^~/, process.env.HOME ?? "~");

export type Component = { slug: string; does?: string; files?: string[]; aliases?: string[] };
export type Feature = {
  id: string;
  name: string;
  /** curated folder override under features/ — defaults from the id (see featureDir) */
  dir?: string;
  type: "feature" | "shared";
  status: "pending" | "in_progress" | "done" | "stale";
  entry_routes: string[];
  /** machine-owned: refreshed wholesale by `accio map` */
  core_files: string[];
  /** curated additions that survive every map run (e.g. a feature dir the routes never import) */
  core_files_extra?: string[];
  /** every word a person might use asking about this — curated + seeded */
  aliases: string[];
  /** curated component groupings; optional, coverage grows from real questions */
  components?: Component[];
  /** set by `accio map` when every entry_route vanished from the route tree */
  orphaned?: boolean;
  docs_sha?: string;
};
export type Manifest = { app: string; fe_repo: string; features: Feature[] };

export async function loadManifest(): Promise<Manifest | null> {
  const f = Bun.file(MANIFEST_PATH);
  return (await f.exists()) ? await f.json() : null;
}

export async function saveManifest(m: Manifest): Promise<void> {
  m.features.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  await Bun.write(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
}

/** Machine fields refresh; curated fields survive. New features append; gone ones flag. */
export function merge(existing: Manifest | null, derived: Manifest): Manifest {
  if (!existing) return derived;
  const out: Manifest = { ...existing, features: [] };
  const derivedById = new Map(derived.features.map(f => [f.id, f]));
  for (const old of existing.features) {
    const d = derivedById.get(old.id);
    if (!d) { out.features.push({ ...old, orphaned: old.type === "feature" ? true : old.orphaned }); continue; }
    derivedById.delete(old.id);
    out.features.push({
      ...old,
      entry_routes: d.entry_routes,
      // core_files is machine-owned and refreshed wholesale; hand additions go in
      // core_files_extra, which map never touches
      core_files: d.core_files,
      orphaned: undefined,
    });
  }
  out.features.push(...derivedById.values());
  return out;
}

/** where a feature's docs live under features/ — curated `dir` wins, else derived from id */
export const featureDir = (f: Feature) =>
  f.dir ?? (f.type === "shared" ? `shared/${f.id.replace(/^shared-/, "")}` : f.id.replace(/^admin-/, "admin/"));
/**
 * Where a feature's change-journal entries live (protocol Phase 5) — one folder per
 * feature, beside its docs, so a feature's history is in the folder you already opened.
 * A change touching several features is still ONE entry: it is filed under the feature it
 * is mostly about and names the rest in `features:`, which stays the routing key.
 */
export const journalDir = (f: Feature) => join(FEATURES_DIR, featureDir(f), "journal");
export const archDocPath = (f: Feature) => join(FEATURES_DIR, featureDir(f), "docs/arch.md");
export const productDocPath = (f: Feature) => join(FEATURES_DIR, featureDir(f), "docs/product.md");

/** all seed paths: machine-derived + curated extras */
export const allCoreFiles = (f: Feature) => [...f.core_files, ...(f.core_files_extra ?? [])];

export const humanize = (id: string) =>
  id.split("-").map(w => w[0]?.toUpperCase() + w.slice(1)).join(" ");
