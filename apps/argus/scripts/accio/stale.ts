#!/usr/bin/env bun
/**
 * accio stale — which features' docs no longer describe the code, and why.
 *
 * DOC-PROTOCOL Phase 4 used to ask one question: did the FE core files move since the
 * product tier was verified? Behaviour also changes through the backend (a handler
 * rewritten with no FE file touched), through the spec, and through decisions journaled
 * ahead of code — so this asks all of them, per feature, and says which fired:
 *
 *   fe-core      core files differ between the product stamp and the FE ref
 *   be-handlers  `be_files` (manifest) differ between `last_verified_be` and the BE ref
 *
 * Read-only. Exit 0 always — this is a report, `accio audit` is the gate.
 *
 * Runs over every doc area `projects.json` lists (CTD-266), each against its own
 * configured repo(s) and base branch; `--area <id>` limits the run to one. A single-repo
 * area (one repo, no second to diff `be_files` against) only ever reports `fe-core`.
 *
 * `--json` names, per feature, its area, FE checkout, base branch and doc stamp (CTD-267,
 * S-9) — enough for a doc to be refreshed from that one entry, with no other lookup.
 *
 *   accio stale [--json] [--all] [--area <id>] [--fe-ref origin/staging] [--be-ref origin/dev]
 */

import { join } from "node:path";
import {
  loadManifest, expand, featureDir, allCoreFiles, manifestPathFor, featuresDirFor, type Manifest,
} from "./manifest.ts";
import { readStamp, gitDiffNames, type Stamp } from "./stamps.ts";
import { loadProjects, allAreas, type DocArea, type Project } from "../argus/projects.ts";

export type StaleReason = { kind: "fe-core" | "be-handlers"; detail: string };
/**
 * `checkout`, `baseBranch` and `stamp` (CTD-267, S-9) are the FE repo's own — enough to
 * refresh this feature's doc from this entry alone, with no other lookup.
 */
export type StaleReport = {
  area: string; id: string; dir: string; checkout: string; baseBranch: string; stamp: Stamp;
  reasons: StaleReason[];
};
export type RepoRef = { path: string; ref: string; baseBranch: string };

export async function computeStale(m: Manifest, opts: {
  area: string; featuresDir: string; fe: RepoRef; be?: RepoRef;
}): Promise<StaleReport[]> {
  const out: StaleReport[] = [];

  for (const f of m.features) {
    const fdir = featureDir(f);
    const arch = await Bun.file(join(opts.featuresDir, fdir, "docs/arch.md")).text().catch(() => null);
    const ps = readStamp(arch);
    if (!arch || !ps) continue;                          // nothing verified yet — not stale, undocumented
    const reasons: StaleReason[] = [];

    const fe = await gitDiffNames(opts.fe.path, ps.sha, opts.fe.ref, allCoreFiles(f));
    if (fe === null) reasons.push({ kind: "fe-core", detail: `could not diff ${ps.sha}..${opts.fe.ref} (unknown sha?)` });
    else if (fe.length) reasons.push({ kind: "fe-core", detail: `${fe.length} core file${fe.length === 1 ? "" : "s"} changed ${ps.sha}..${opts.fe.ref}` });

    if (opts.be) {
      const bs = readStamp(arch, "last_verified_be");
      if (bs && f.be_files?.length) {
        const be = await gitDiffNames(opts.be.path, bs.sha, opts.be.ref, f.be_files);
        if (be === null) reasons.push({ kind: "be-handlers", detail: `could not diff ${bs.sha}..${opts.be.ref} (unknown sha? fetch first)` });
        else if (be.length) reasons.push({ kind: "be-handlers", detail: `${be.length} handler file${be.length === 1 ? "" : "s"} changed ${bs.sha}..${opts.be.ref}` });
      }
    }

    out.push({
      area: opts.area, id: f.id, dir: fdir,
      checkout: opts.fe.path, baseBranch: opts.fe.baseBranch, stamp: ps,
      reasons,
    });
  }
  return out;
}

/** the project's other repo, when it has exactly one besides the area's own — alden-portal's `be` today */
function otherRepo(project: Project, area: DocArea) {
  const rest = project.repos.filter(r => r.id !== area.repo);
  return rest.length === 1 ? rest[0] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const areaId = opt("--area");

  const config = await loadProjects();
  let areas = allAreas(config);
  if (areaId) {
    areas = areas.filter(a => a.id === areaId);
    if (!areas.length) { console.error(`error: no area "${areaId}" in projects.json`); process.exit(1); }
  }

  const reports: StaleReport[] = [];
  for (const area of areas) {
    const project = config.projects.find(p => p.id === area.project)!;
    const m = await loadManifest(manifestPathFor(area.dir));
    if (!m) { console.error(`error: no manifest for area "${area.id}" — run \`accio map\` first`); process.exit(1); }

    const feRepo = project.repos.find(r => r.id === area.repo)!;
    const be = otherRepo(project, area);

    reports.push(...await computeStale(m, {
      area: area.id,
      featuresDir: featuresDirFor(area.dir),
      // a single-repo manifest's core files are relative to its own hand-curated `repo`
      // (e.g. `~/git/citadel/apps/pensieve`), not the project repo's checkout root — that's
      // what lets a manifest-relative path like `../../justfile` resolve at all (CTD-276)
      fe: { path: expand(m.repo ?? feRepo.path), ref: opt("--fe-ref") ?? `origin/${feRepo.baseBranch}`, baseBranch: feRepo.baseBranch },
      be: be ? { path: expand(be.path), ref: opt("--be-ref") ?? `origin/${be.baseBranch}`, baseBranch: be.baseBranch } : undefined,
    }));
  }

  const stale = reports.filter(r => r.reasons.length);
  if (args.includes("--json")) { console.log(JSON.stringify(args.includes("--all") ? reports : stale, null, 2)); process.exit(0); }
  if (!stale.length) { console.log(`stale: none (${reports.length} features with an arch doc)`); process.exit(0); }
  console.log(`stale: ${stale.length} of ${reports.length} features\n`);
  for (const r of stale) {
    console.log(`  ${r.area}/${r.id}`);
    for (const x of r.reasons) console.log(`      ${x.kind.padEnd(12)} ${x.detail}`);
  }
  if (args.includes("--all"))
    for (const r of reports.filter(r => !r.reasons.length)) console.log(`  ${r.area}/${r.id}  fresh`);
  process.exit(0);
}
