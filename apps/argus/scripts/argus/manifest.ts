/**
 * The feature manifest, read for the one thing the run needs from it: which feature a
 * file belongs to. A feature is named by its directory under `features/` (the manifest's
 * `dir`, else derived from its id the way the docs tooling does).
 */

import { manifestPath } from "./paths.ts";

export type ManifestFeature = {
  id: string;
  name: string;
  dir?: string;
  type: "feature" | "shared";
  entry_routes: string[];
  core_files: string[];
  core_files_extra?: string[];
  be_files?: string[];
  aliases: string[];
};
export type Manifest = { app: string; fe_repo: string; be_repo?: string; features: ManifestFeature[] };

export const featureDirOf = (f: ManifestFeature) =>
  f.dir ?? (f.type === "shared" ? `shared/${f.id.replace(/^shared-/, "")}` : f.id.replace(/^admin-/, "admin/"));

export async function loadManifest(app?: string): Promise<Manifest> {
  const f = Bun.file(manifestPath(app));
  if (!(await f.exists())) throw new Error(`no manifest at ${manifestPath(app)}`);
  return (await f.json()) as Manifest;
}

/** every feature as `{ dir, name, feFiles, beFiles }`, the file lists as path prefixes */
export function featureFiles(m: Manifest): { dir: string; name: string; fe: string[]; be: string[] }[] {
  return m.features.map((f) => ({
    dir: featureDirOf(f),
    name: f.name,
    fe: [...f.core_files, ...(f.core_files_extra ?? [])],
    be: f.be_files ?? [],
  }));
}

/** a changed file belongs to every feature one of whose listed paths is the file or a directory above it */
export function featuresForFiles(files: string[], table: ReturnType<typeof featureFiles>, side: "fe" | "be"): string[] {
  const hit = new Map<string, number>();
  for (const file of files)
    for (const f of table)
      if (f[side].some((p) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`))) hit.set(f.dir, (hit.get(f.dir) ?? 0) + 1);
  return [...hit].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([dir]) => dir);
}
