#!/usr/bin/env bun
/**
 * accio sync — fetch/diff the OpenAPI spec, analyze the frontend, rebuild the index,
 * regenerate the architecture-tier docs.
 *
 * Mechanical only — no AI, no judgment. Deciding what a spec diff *means* for a feature
 * is a session's job; this reports.
 *
 * Runs over every doc area `projects.json` lists whose project declares a route tree and
 * an API spec (CTD-267, S-10) — alden-portal today, the only project shaped for it. An
 * area declaring neither is skipped and named as such; `--area <id>` limits the run to
 * one area (still skipped if it lacks either). The OpenAPI cache, fingerprint and index
 * stay one shared set under `.state/` until a second such area exists.
 *
 *   accio sync                 full run
 *   accio sync --offline       cached spec, no network
 *   accio sync --check         report spec drift only, write nothing (exit 1 on drift)
 *   accio sync --feature <id>  regenerate one feature's doc (index still rebuilds whole)
 *   accio sync --area <id>     limit the run to one configured area
 */

import { join, relative } from "node:path";
import {
  extractSwaggerDoc, flatten, indexOps,
  fingerprintOf, diffSpec, type Op, type SpecDiff,
} from "./spec.ts";
import { analyzeRepo } from "./analyze.ts";
import { buildIndex, ATTR_DEPTH, type AccioIndex } from "./index-store.ts";
import { renderArchDoc, readAliases, type DocMeta } from "./docs.ts";
import { loadManifest, saveManifest, expand, manifestPathFor, featuresDirFor, featureDir, STATE, DATA_ROOT, DEFAULT_ALDEN_FE_REPO } from "./manifest.ts";
import { readStamp, restamp, decideArchStamp, gitDiffNames, gitIsAncestor, gitShortSha, type StampReason } from "./stamps.ts";
import { auditDocs } from "./audit.ts";
import { loadProjects, allAreas, missingForGenerate, type DocArea, type Project } from "../argus/projects.ts";

const CACHE = join(STATE, "openapi.json");
const FINGERPRINT = join(STATE, "openapi-fingerprint.json");
const META = join(STATE, "openapi-meta.json");
const REPORT = join(STATE, "last-api-sync.md");
export const INDEX_PATH = join(STATE, "accio-index.json");

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const OFFLINE = has("--offline");
const CHECK = has("--check");
const ONLY = opt("--feature");
const AREA = opt("--area");

const fail = (msg: string): never => { console.error(`error: ${msg}`); process.exit(1); };
const rel = (p: string) => relative(DATA_ROOT, p);
const today = () => new Date().toISOString().slice(0, 10);

/** Which frontend revision the analysis ran against — branch-dependent, so always named. */
async function repoRev(repo: string): Promise<string> {
  try {
    const at = (cmd: string[]) =>
      new Response(Bun.spawn(cmd, { cwd: repo, stderr: "ignore" }).stdout).text();
    const [branch, sha] = await Promise.all([
      at(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
      at(["git", "rev-parse", "--short", "HEAD"]),
    ]);
    return `${branch.trim()}@${sha.trim()}`;
  } catch { return "unknown"; }
}

async function loadSpec(specJsUrl: string): Promise<{ doc: any; fresh: boolean }> {
  if (OFFLINE) {
    const f = Bun.file(CACHE);
    if (!(await f.exists())) fail(`--offline but no cache at ${rel(CACHE)} — run once online first`);
    return { doc: await f.json(), fresh: false };
  }
  const res = await fetch(specJsUrl, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${specJsUrl} → ${res.status}`);
  return { doc: extractSwaggerDoc(await res.text()), fresh: true };
}

function renderReport(d: SpecDiff, index: AccioIndex, doc: any, prevAt: string | null, fetchedAt: string): string {
  const L: string[] = [];
  L.push(`# API sync — ${fetchedAt}`, "");
  L.push(`Spec: ${doc.info?.title} v${doc.info?.version} · ${index.specOps} operations · FE \`${index.feRev}\``);
  L.push(prevAt ? `Previous sync: ${prevAt}` : "First sync — no baseline to diff against.");
  L.push("");
  const owner = (key: string) => index.ops[key]?.features.join(", ") || "_unclaimed_";
  if (!prevAt) L.push("## Changes", "", "_baseline established; diffs start next sync_", "");
  else if (!d.added.length && !d.removed.length && !d.changed.length)
    L.push("## Changes", "", "None. The backend spec is unchanged since the last sync.", "");
  else {
    L.push("## Changes", "");
    const section = (title: string, rows: string[]) => {
      if (!rows.length) return;
      L.push(`### ${title}`, "");
      rows.forEach(r => L.push(`- ${r}`));
      L.push("");
    };
    section("Added", d.added.map(o => `\`${o.key}\` — ${o.summary || "—"} → **${owner(o.key)}**`));
    section("Removed", d.removed.map(k => `\`${k}\` → **${owner(k)}**`));
    section("Changed", d.changed.map(o => `\`${o.key}\` — params/body/responses/auth differ → **${owner(o.key)}**`));
  }
  L.push("## Coverage", "", "| Feature | Direct ops | Files |", "| --- | ---: | ---: |");
  for (const f of index.features.filter(f => f.type === "feature"))
    L.push(`| ${f.id} | ${f.ops.filter(o => o.dist <= ATTR_DEPTH).length} | ${Object.keys(f.files).length} |`);
  L.push("");
  return L.join("\n");
}

/** The whole sync pipeline for one gated area (CTD-267) — unchanged behaviour, parameterized by area/project instead of the hardcoded alden-portal paths. */
async function syncArea(area: DocArea & { project: string }, project: Project): Promise<void> {
  const manifestPath = manifestPathFor(area.dir);
  const featuresDir = featuresDirFor(area.dir);
  const specUiUrl = area.apiSpec!;
  const specJsUrl = specUiUrl + "swagger-ui-init.js";

  const manifest = await loadManifest(manifestPath);
  if (!manifest) fail(`no manifest for area "${area.id}" at ${rel(manifestPath)} — run \`accio map\` first`);
  const m = manifest!;

  const { doc, fresh } = await loadSpec(specJsUrl);
  const ops = flatten(doc);
  const fetchedAt = today();
  const prevFp: Record<string, string> | null = await Bun.file(FINGERPRINT).exists()
    ? await Bun.file(FINGERPRINT).json() : null;
  const prevMeta: any = await Bun.file(META).exists() ? await Bun.file(META).json() : null;
  const diff = diffSpec(ops, prevFp);
  const drifted = diff.added.length + diff.removed.length + diff.changed.length;

  console.log(`spec: ${ops.length} operations${fresh ? " (fetched)" : " (cached)"}`);
  if (prevFp) console.log(`diff: +${diff.added.length} added · -${diff.removed.length} removed · ~${diff.changed.length} changed`);

  if (CHECK) { console.log("\n--check: nothing written"); process.exit(drifted ? 1 : 0); }

  const feRoot = expand(m.fe_repo ?? DEFAULT_ALDEN_FE_REPO);
  if (!(await Bun.file(join(feRoot, "package.json")).exists())) fail(`frontend repo not found at ${feRoot}`);
  const idx = indexOps(doc, ops);
  // The FE repo is a SHARED working tree — other sessions switch its branch. An analysis
  // that straddles a switch is a silent mix of two revisions, so bracket it and refuse.
  const revBefore = await repoRev(feRoot);
  const analysis = await analyzeRepo(feRoot, idx);
  const feRev = await repoRev(feRoot);
  if (feRev !== revBefore)
    fail(`frontend working tree changed mid-analysis (${revBefore} → ${feRev}) — another session is using the repo; re-run when it settles`);
  console.log(`frontend: ${analysis.fileCount} files analyzed · ${analysis.routes.length} routes · \`${feRev}\``);

  // aliases can be edited in either place — union doc frontmatter back into the manifest
  let manifestDirty = false;
  for (const f of m.features) {
    const existing = await Bun.file(join(featuresDir, featureDir(f), "docs/arch.md")).text().catch(() => null);
    if (!existing) continue;
    for (const a of readAliases(existing))
      if (!f.aliases.includes(a)) { f.aliases.push(a); manifestDirty = true; }
  }
  if (manifestDirty) await saveManifest(m, manifestPath);

  const index = buildIndex(analysis, m, ops, feRev, doc.info?.version ?? "?");
  await Bun.write(INDEX_PATH, JSON.stringify(index));

  if (fresh) {
    await Bun.write(CACHE, JSON.stringify(doc));
    const currFp: Record<string, string> = {};
    for (const o of ops) currFp[o.key] = fingerprintOf(o);
    await Bun.write(FINGERPRINT, JSON.stringify(currFp));
    await Bun.write(META, JSON.stringify({
      source: specUiUrl, title: doc.info?.title, version: doc.info?.version,
      fetchedAt, operations: ops.length, previousFetchedAt: prevMeta?.fetchedAt ?? null,
    }, null, 2));
  }

  const meta: DocMeta = { feRev, date: fetchedAt, specVersion: doc.info?.version ?? "?", specUrl: specUiUrl };
  const opsByKey = new Map(ops.map(o => [o.key, o]));

  // Which features own an operation the spec changed this sync — their arch surface moved
  // even if no FE file did, so their stamp advances and the product tier reads as stale.
  const specChangedFeatures = new Set<string>();
  for (const key of [...diff.added.map(o => o.key), ...diff.changed.map(o => o.key), ...diff.removed])
    for (const id of index.ops[key]?.features ?? []) specChangedFeatures.add(id);

  const feHead = await gitShortSha(feRoot);
  const byReason: Record<StampReason, string[]> = {
    new: [], "no-product": [], "tree-behind": [], undecidable: [], "core-changed": [], "spec-changed": [], aligned: [],
  };
  let wrote = 0, matched = 0;
  for (const f of index.features) {
    if (ONLY && f.id !== ONLY) continue;
    matched++;
    const docPath = join(featuresDir, f.dir, "docs/arch.md");
    const productPath = join(featuresDir, f.dir, "docs/product.md");
    const existing = await Bun.file(docPath).text().catch(() => null);
    const product = await Bun.file(productPath).text().catch(() => null);

    // The arch stamp follows the product stamp unless the feature changed since the
    // product tier was verified (lib/stamps.ts). A shared FE checkout older than the docs
    // can teach us nothing, so it never moves a stamp — backwards or forwards.
    const archSha = readStamp(existing)?.sha;
    const productSha = readStamp(product)?.sha;
    const anchor = archSha ?? productSha;
    const treeBehind = !!anchor && !!feHead && feHead !== anchor && (await gitIsAncestor(feRoot, "HEAD", anchor)) === true;
    // newest rev we can honestly compare against: HEAD, or the doc's own stamp when the
    // checkout is older than the docs (two commits diff without a checkout)
    const newest = treeBehind ? (archSha ?? "HEAD") : "HEAD";
    const anchorSha = productSha ?? archSha;
    const coreDiff = anchorSha ? await gitDiffNames(feRoot, anchorSha, newest, f.core_files) : null;
    const productAhead = !!archSha && !!productSha && archSha !== productSha
      && (await gitIsAncestor(feRoot, archSha, productSha)) === true;
    const decision = decideArchStamp({
      existingArch: existing, product, current: { rev: feRev, date: fetchedAt },
      coreChangedSinceProduct: coreDiff === null ? null : coreDiff.length > 0,
      specChanged: specChangedFeatures.has(f.id), treeBehind, productAhead,
    });
    byReason[decision.reason].push(f.id);

    // A behind checkout must not rewrite regions either — they would describe older code
    // under a newer stamp. Frontmatter alignment is the only write it may make.
    const rendered = treeBehind && existing
      ? restamp(existing, decision.rev, decision.date)
      : renderArchDoc(f, opsByKey, { ...meta, feRev: decision.rev, date: decision.date }, existing);
    if (rendered !== existing) { await Bun.write(docPath, rendered); wrote++; }

  }
  if (ONLY && !matched) fail(`no feature "${ONLY}" — have: ${index.features.map(f => f.id).join(", ")}`);

  const moved = [...byReason["core-changed"], ...byReason["spec-changed"]];
  console.log(
    `stamps: ${byReason.aligned.length} arch docs kept their stamp` +
    (moved.length ? ` · ${moved.length} advanced to \`${feRev}\` (product tier now stale): ${moved.join(", ")}` : "") +
    (byReason.new.length ? ` · ${byReason.new.length} new` : "") +
    (byReason["no-product"].length ? ` · ${byReason["no-product"].length} without a product tier` : ""),
  );
  if (byReason["tree-behind"].length)
    console.log(`⚠ FE checkout \`${feRev}\` is OLDER than the docs — ${byReason["tree-behind"].length} changed feature(s) kept their newer stamp and regions: ${byReason["tree-behind"].join(", ")}`);
  if (byReason.undecidable.length)
    console.log(`⚠ could not diff ${byReason.undecidable.length} feature(s) against their product stamp (unknown sha?) — stamps left alone: ${byReason.undecidable.join(", ")}`);

  if (!ONLY) await Bun.write(REPORT, renderReport(diff, index, doc, prevMeta?.fetchedAt ?? null, fetchedAt));

  const problems = await auditDocs(index, featuresDir);
  if (problems.length) {
    console.log(`\n⚠ audit — docs claim things the code or spec no longer backs:`);
    for (const p of problems.slice(0, 12)) console.log(`   ${p}`);
    if (problems.length > 12) console.log(`   …and ${problems.length - 12} more (accio audit)`);
  } else console.log("audit: docs clean");

  console.log(`\nrewrote ${wrote} of ${matched} arch doc${matched === 1 ? "" : "s"} → ${rel(featuresDir)}/**/docs/arch.md` +
    `${ONLY ? " (scoped — report not rewritten)" : ` · ${rel(REPORT)} · index ${rel(INDEX_PATH)}`}`);
}

if (import.meta.main) {
  const config = await loadProjects();
  const areas = allAreas(config);
  const targets = AREA ? areas.filter(a => a.id === AREA) : areas;
  if (AREA && !targets.length) fail(`no area "${AREA}" in projects.json`);

  let ran = 0;
  for (const area of targets) {
    const missing = missingForGenerate(area);
    if (missing.length) {
      console.log(`skip ${area.id}: declares no ${missing.join(" or ")} — nothing to sync`);
      continue;
    }
    const project = config.projects.find(p => p.id === area.project)!;
    ran++;
    await syncArea(area, project);
  }
  if (!ran) console.log("sync: no configured area declares a route tree and an API spec — nothing to do");
}
