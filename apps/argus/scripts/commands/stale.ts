#!/usr/bin/env bun
/**
 * accio stale — which features' docs no longer describe the code, and why.
 *
 * DOC-PROTOCOL Phase 4 used to ask one question: did the FE core files move since the
 * product tier was verified? Behaviour also changes through the backend (a handler
 * rewritten with no FE file touched), through the spec, and through decisions journaled
 * ahead of code — so this asks all of them, per feature, and says which fired:
 *
 *   tiers        product.md and arch.md stamps disagree — sync advanced the arch stamp
 *                because core files or owned endpoints changed (lib/stamps.ts)
 *   fe-core      core files differ between the product stamp and the FE ref
 *   be-handlers  `be_files` (manifest) differ between `last_verified_be` and the BE ref
 *   journal      `implemented` entries naming the feature that no refresh has consumed
 *
 * Read-only. Exit 0 always — this is a report, `accio audit` is the gate.
 *
 *   accio stale [--json] [--all] [--fe-ref origin/staging] [--be-ref origin/dev]
 */

import { join } from "node:path";
import {
  loadManifest, expand, featureDir, allCoreFiles, FEATURES_DIR, DEFAULT_BE_REPO, type Manifest,
} from "../lib/manifest.ts";
import { readStamp, gitDiffNames } from "../lib/stamps.ts";
import { loadJournal } from "../lib/journal.ts";

export type StaleReason = { kind: "tiers" | "fe-core" | "be-handlers" | "journal"; detail: string };
export type StaleReport = { id: string; dir: string; reasons: StaleReason[] };

export async function computeStale(m: Manifest, opts: {
  featuresDir?: string; feRef?: string; beRef?: string;
} = {}): Promise<StaleReport[]> {
  const dir = opts.featuresDir ?? FEATURES_DIR;
  const feRepo = expand(m.fe_repo);
  const beRepo = expand(m.be_repo ?? DEFAULT_BE_REPO);
  const feRef = opts.feRef ?? "origin/staging";
  const beRef = opts.beRef ?? "origin/dev";
  const journal = await loadJournal(dir);
  const out: StaleReport[] = [];

  for (const f of m.features) {
    const fdir = featureDir(f);
    const product = await Bun.file(join(dir, fdir, "docs/product.md")).text().catch(() => null);
    const arch = await Bun.file(join(dir, fdir, "docs/arch.md")).text().catch(() => null);
    const ps = readStamp(product);
    if (!product || !ps) continue;                       // nothing verified yet — not stale, undocumented
    const reasons: StaleReason[] = [];

    const as = readStamp(arch);
    if (as && as.sha !== ps.sha) reasons.push({ kind: "tiers", detail: `product ${ps.rev} · arch ${as.rev}` });

    const fe = await gitDiffNames(feRepo, ps.sha, feRef, allCoreFiles(f));
    if (fe === null) reasons.push({ kind: "fe-core", detail: `could not diff ${ps.sha}..${feRef} (unknown sha?)` });
    else if (fe.length) reasons.push({ kind: "fe-core", detail: `${fe.length} core file${fe.length === 1 ? "" : "s"} changed ${ps.sha}..${feRef}` });

    const bs = readStamp(product, "last_verified_be");
    if (bs && f.be_files?.length) {
      const be = await gitDiffNames(beRepo, bs.sha, beRef, f.be_files);
      if (be === null) reasons.push({ kind: "be-handlers", detail: `could not diff ${bs.sha}..${beRef} (unknown sha? fetch first)` });
      else if (be.length) reasons.push({ kind: "be-handlers", detail: `${be.length} handler file${be.length === 1 ? "" : "s"} changed ${bs.sha}..${beRef}` });
    }

    const open = journal.filter(e => e.status === "implemented" && !e.hold && e.features.includes(f.id));
    if (open.length) reasons.push({ kind: "journal", detail: `${open.length} implemented entr${open.length === 1 ? "y" : "ies"} not yet documented: ${open.map(e => e.name.split("/").pop()).join(", ")}` });

    out.push({ id: f.id, dir: fdir, reasons });
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const m = await loadManifest();
  if (!m) { console.error("error: no manifest — run `accio map` first"); process.exit(1); }
  const reports = await computeStale(m, { feRef: opt("--fe-ref"), beRef: opt("--be-ref") });
  const stale = reports.filter(r => r.reasons.length);
  if (args.includes("--json")) { console.log(JSON.stringify(args.includes("--all") ? reports : stale, null, 2)); process.exit(0); }
  if (!stale.length) { console.log(`stale: none (${reports.length} features with a product tier)`); process.exit(0); }
  console.log(`stale: ${stale.length} of ${reports.length} features\n`);
  for (const r of stale) {
    console.log(`  ${r.id}`);
    for (const x of r.reasons) console.log(`      ${x.kind.padEnd(12)} ${x.detail}`);
  }
  if (args.includes("--all"))
    for (const r of reports.filter(r => !r.reasons.length)) console.log(`  ${r.id}  fresh`);
  process.exit(0);
}
