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
