#!/usr/bin/env bun
/**
 * accio audit — hold the docs to what the code and spec actually back.
 *
 * Hand-written prose naming an endpoint nothing calls any more is the failure mode
 * curated docs always have; this generalizes the first accio's data-flow drift check to
 * every endpoint mention OUTSIDE the machine-owned regions, plus DOC-PROTOCOL conformance
 * (frontmatter, required headings, core paths that still exist).
 *
 * Runs over every doc area `projects.json` lists (CTD-266): an area whose project's code
 * lives in two repos — alden-portal today — is checked against its built `AccioIndex`
 * (`auditDocs`, unchanged); a single-repo area is checked in the single-repo shape
 * (`auditManifestDocs`) — one stamp, core files against the area's own repo on disk, and
 * no endpoint check, since it declares no API spec. `--area <id>` limits the run to one area.
 *
 *   accio audit [--area <id>]          report; exit 1 if anything fails
 */

import { join, relative } from "node:path";
import { stat } from "node:fs/promises";
import { normPath } from "./spec.ts";
import {
  FEATURES_DIR, STATE, ROOT, DEFAULT_ALDEN_FE_REPO, DEFAULT_ALDEN_BE_REPO, expand,
  loadManifest, featureDir, allCoreFiles, manifestPathFor, featuresDirFor, type Manifest,
} from "./manifest.ts";
import { ATTR_DEPTH, type AccioIndex } from "./index-store.ts";
import { readStamp, gitIsAncestor } from "./stamps.ts";
import { loadProjects, allAreas } from "../argus/projects.ts";

const METHOD_RE = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S+?)(?=[`") \n]|$)/g;

/** prose = the doc minus machine-owned regions (those are correct by construction) */
const proseOf = (doc: string) =>
  doc.replace(/<!-- accio:begin [\s\S]*?accio:end [^>]*-->/g, "");

export async function auditDocs(index: AccioIndex, dir = FEATURES_DIR): Promise<string[]> {
  const problems: string[] = [];
  const byId = new Map(index.features.map(f => [f.id, f]));
  const specKeys = new Set(Object.keys(index.ops).map(k => normPath(k)));

  for await (const path of new Bun.Glob("**/docs/arch.md").scan({ cwd: dir, absolute: true })) {
    const name = relative(dir, path);
    const text = await Bun.file(path).text();
    const id = text.match(/^---\n[\s\S]*?^id:\s*(\S+)/m)?.[1] ?? "";
    const f = byId.get(id);

    if (!/^---\n[\s\S]*?\n---/.test(text)) problems.push(`${name}: no frontmatter`);
    else if (!id) problems.push(`${name}: frontmatter has no id`);
    for (const h of ["## Component Map", "## Interfaces & Contracts"])
      if (!text.includes(h)) problems.push(`${name}: missing required heading "${h}"`);
    if (!f) { problems.push(`${name}: no feature "${id}" in the manifest — orphaned doc`); continue; }
    const wantDir = relative(dir, path).replace(/\/docs\/arch\.md$/, "");
    if (wantDir !== f.dir) problems.push(`${name}: doc lives in \`${wantDir}\` but feature dir is \`${f.dir}\``);

    for (const c of f.core_files)
      if (!Object.keys(f.files).some(file => file === c || file.startsWith(c.replace(/\/$/, "") + "/")))
        problems.push(`${name}: core path \`${c}\` matches no analyzed file`);

    const called = new Set(f.ops.map(o => normPath(o.key.replace(/^~/, ""))));
    for (const m of proseOf(text).matchAll(METHOD_RE)) {
      const [, method = "", path = ""] = m;
      const key = normPath(`${method} ${path.replace(/[`"').,]+$/, "")}`);
      if (!specKeys.has(key)) problems.push(`${name}: prose names \`${method} ${path}\` — not in the spec`);
      else if (f.type === "feature" && !called.has(key))
        problems.push(`${name}: prose names \`${m[1]} ${m[2]}\` — nothing this feature reaches calls it`);
    }
  }
  return problems;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/**
 * The single-repo shape (CTD-266): a hand-curated manifest, no `AccioIndex` (no route tree
 * to derive one from), and no API spec — so a core path is checked against the area's own
 * repo on disk rather than an analyzed file set, and no endpoint in the prose is checked at all.
 */
export async function auditManifestDocs(m: Manifest, opts: { dir: string; repoPath: string }): Promise<string[]> {
  const problems: string[] = [];
  const byId = new Map(m.features.map(f => [f.id, f]));

  for await (const path of new Bun.Glob("**/docs/arch.md").scan({ cwd: opts.dir, absolute: true })) {
    const name = relative(opts.dir, path);
    const text = await Bun.file(path).text();
    const id = text.match(/^---\n[\s\S]*?^id:\s*(\S+)/m)?.[1] ?? "";

    if (!/^---\n[\s\S]*?\n---/.test(text)) problems.push(`${name}: no frontmatter`);
    else if (!id) problems.push(`${name}: frontmatter has no id`);
    for (const h of ["## Component Map", "## Interfaces & Contracts"])
      if (!text.includes(h)) problems.push(`${name}: missing required heading "${h}"`);

    const f = byId.get(id);
    if (!f) { problems.push(`${name}: no feature "${id}" in the manifest — orphaned doc`); continue; }
    const wantDir = name.replace(/\/docs\/arch\.md$/, "");
    const fdir = featureDir(f);
    if (wantDir !== fdir) problems.push(`${name}: doc lives in \`${wantDir}\` but feature dir is \`${fdir}\``);

    for (const c of allCoreFiles(f))
      if (!(await exists(join(opts.repoPath, c)))) problems.push(`${name}: core path \`${c}\` does not exist in ${opts.repoPath}`);

    // no index, no spec — nothing in the prose is checked against either
  }
  return problems;
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

  const problems: string[] = [];
  for (const area of areas) {
    const project = config.projects.find(p => p.id === area.project)!;
    if (project.repos.length > 1) {
      const idxFile = Bun.file(join(STATE, "accio-index.json"));
      if (!(await idxFile.exists())) { console.error(`error: no index for area "${area.id}" — run \`accio sync\` first`); process.exit(1); }
      const index = await idxFile.json();
      problems.push(...(await auditDocs(index, featuresDirFor(area.dir))).map(p => `${area.id}: ${p}`));
    } else {
      const m = await loadManifest(manifestPathFor(area.dir));
      if (!m) { console.error(`error: no manifest for area "${area.id}"`); process.exit(1); }
      const repo = project.repos.find(r => r.id === area.repo)!;
      // same repo-relative base as `accio stale` (CTD-276): a single-repo manifest's `repo`
      // field, when set, is where its core files are written relative to
      problems.push(...(await auditManifestDocs(m, { dir: featuresDirFor(area.dir), repoPath: expand(m.repo ?? repo.path) })).map(p => `${area.id}: ${p}`));
    }
  }

  const v = Bun.spawnSync(["bun", join(ROOT, "scripts/argus.ts"), "validate"], { stdout: "pipe", stderr: "pipe" });
  problems.push(...v.stderr.toString().split("\n").filter(Boolean));

  if (!problems.length) { console.log("audit: clean"); process.exit(0); }
  console.log(`audit: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
