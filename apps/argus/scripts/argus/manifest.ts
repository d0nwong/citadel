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

/** a listed path claimed by this many features or more is shared plumbing, not a feature's own */
export const SHARED_FROM = 4;

const matches = (file: string, p: string) => file === p || file.startsWith(p.endsWith("/") ? p : `${p}/`);

/**
 * A changed file belongs to every feature one of whose listed paths is the file or a
 * directory above it. Paths listed by many features (a swagger schema, a controller every
 * page calls) only count when nothing a feature owns alone matched: a landing that touches
 * both lands on the owners of its specific files, and one that touches only shared files
 * lands on everyone who lists them.
 */
export function featuresForFiles(files: string[], table: ReturnType<typeof featureFiles>, side: "fe" | "be"): string[] {
  const claims = new Map<string, number>();
  for (const f of table) for (const p of f[side]) claims.set(p, (claims.get(p) ?? 0) + 1);
  const specific = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const file of files)
    for (const f of table)
      for (const p of f[side])
        if (matches(file, p)) {
          const bucket = (claims.get(p) ?? 1) >= SHARED_FROM ? shared : specific;
          bucket.set(f.dir, (bucket.get(f.dir) ?? 0) + 1);
        }
  const pick = specific.size ? specific : shared;
  return [...pick].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([dir]) => dir);
}
