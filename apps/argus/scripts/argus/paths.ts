/**
 * Where things are. The checkout root (`ARGUS_ROOT` overrides it, which is how a test
 * points every verb at a temp workspace), the app whose features have ledgers, and the
 * path of one feature's ledger. A feature is named by its directory under `features/`,
 * nested where the manifest nests it: `tasks`, `admin/usage`, `shared/hooks`.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
export const root = () => process.env.ARGUS_ROOT ?? REPO_ROOT;

export const DEFAULT_APP = "alden/alden-portal";
export const LEDGER_FILE = "ledger.json";

export const featuresDir = (app = DEFAULT_APP) => join(root(), app, "features");
export const featureDir = (feature: string, app = DEFAULT_APP) => join(featuresDir(app), feature);
export const ledgerPath = (feature: string, app = DEFAULT_APP) => join(featureDir(feature, app), LEDGER_FILE);
export const archDocPath = (feature: string, app = DEFAULT_APP) => join(featureDir(feature, app), "docs/arch.md");
export const manifestPath = (app = DEFAULT_APP) => join(root(), app, ".doc-workspace/feature-manifest.json");

export const specDocPath = (feature: string, app = DEFAULT_APP) => join(featureDir(feature, app), "docs/spec.md");

/** the revisions (CTD-192): one directory per revision, by slug while a draft and by its parent's key once filed */
export const revisionsDir = () => join(root(), "revisions");
export const revisionDir = (slugOrKey: string) => join(revisionsDir(), slugOrKey);
export const archiveDir = () => join(revisionsDir(), "archive");
export const archivedRevisionDir = (slugOrKey: string) => join(archiveDir(), slugOrKey);

export const stateDir = () => join(root(), "state");
export const cursorPath = () => join(stateDir(), "cursor.json");
export const cursorNextPath = () => join(stateDir(), "cursor.next.json");
export const threadsPath = () => join(stateDir(), "threads.json");
export const unplacedPath = () => join(stateDir(), "unplaced.json");
export const batchesDir = () => join(stateDir(), "batches");

const exists = (p: string) => stat(p).then(() => true, () => false);

/** a feature is a directory under features/ that holds docs/ or a ledger; nesting is one level */
export async function isFeature(feature: string, app = DEFAULT_APP): Promise<boolean> {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(feature)) return false;
  const dir = featureDir(feature, app);
  return (await exists(join(dir, "docs"))) || (await exists(join(dir, LEDGER_FILE)));
}

/**
 * Every app in the checkout: a directory one or two levels down that holds `features/`,
 * the way Pensieve discovers them — `alden/alden-portal`, `foundry`, `pensieve`, `argus`.
 */
export async function listApps(): Promise<string[]> {
  const out: string[] = [];
  const dirs = async (p: string) =>
    (await readdir(p, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
      .map((d) => d.name);
  for (const a of await dirs(root())) {
    if (await exists(join(root(), a, "features"))) out.push(a);
    else for (const b of await dirs(join(root(), a))) if (await exists(join(root(), a, b, "features"))) out.push(`${a}/${b}`);
  }
  return out.sort();
}

/**
 * A feature as Pensieve addresses it, `<app>/<dir>`, split into the app and the feature
 * under it — `foundry/jobs` → `["foundry", "jobs"]`, `alden/alden-portal/admin/usage` →
 * `["alden/alden-portal", "admin/usage"]`. Null when no such feature directory exists.
 */
export async function splitFeatureKey(key: string): Promise<[app: string, feature: string] | null> {
  const segs = key.split("/");
  for (const n of [2, 1]) {
    if (segs.length <= n) continue;
    const app = segs.slice(0, n).join("/");
    const feature = segs.slice(n).join("/");
    if ((await exists(featuresDir(app))) && (await isFeature(feature, app))) return [app, feature];
  }
  return null;
}

/** every feature directory under the app, nested ones as `parent/child`, sorted */
export async function listFeatures(app = DEFAULT_APP): Promise<string[]> {
  const out: string[] = [];
  const base = featuresDir(app);
  const dirs = async (p: string) =>
    (await readdir(p, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name);
  for (const a of await dirs(base)) {
    if (await isFeature(a, app)) out.push(a);
    for (const b of await dirs(join(base, a))) if (await isFeature(`${a}/${b}`, app)) out.push(`${a}/${b}`);
  }
  return out.sort();
}
