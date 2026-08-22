#!/usr/bin/env bun
/**
 * accio sync — fetch/diff the OpenAPI spec, analyze the frontend, rebuild the index,
 * regenerate the architecture-tier docs.
 *
 * Mechanical only — no AI, no judgment. Deciding what a spec diff *means* for a feature
 * is a session's job; this reports.
 *
 *   accio sync                 full run
 *   accio sync --offline       cached spec, no network
 *   accio sync --check         report spec drift only, write nothing (exit 1 on drift)
 *   accio sync --feature <id>  regenerate one feature's doc (index still rebuilds whole)
 */

import { join, relative, dirname } from "node:path";
import {
  SPEC_JS_URL, SPEC_UI_URL, extractSwaggerDoc, flatten, indexOps,
  fingerprintOf, diffSpec, type Op, type SpecDiff,
} from "../lib/spec.ts";
import { analyzeRepo } from "../lib/analyze.ts";
import { buildIndex, ATTR_DEPTH, type AccioIndex } from "../lib/index-store.ts";
import { renderArchDoc, readAliases, type DocMeta } from "../lib/docs.ts";
import { loadManifest, saveManifest, expand, archDocPath, STATE, FEATURES_DIR, MANIFEST_PATH, ROOT } from "../lib/manifest.ts";
import { auditDocs, auditJournal } from "./audit.ts";

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

const fail = (msg: string): never => { console.error(`error: ${msg}`); process.exit(1); };
const rel = (p: string) => relative(ROOT, p);
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

async function loadSpec(): Promise<{ doc: any; fresh: boolean }> {
  if (OFFLINE) {
    const f = Bun.file(CACHE);
    if (!(await f.exists())) fail(`--offline but no cache at ${rel(CACHE)} — run once online first`);
    return { doc: await f.json(), fresh: false };
  }
  const res = await fetch(SPEC_JS_URL, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`GET ${SPEC_JS_URL} → ${res.status}`);
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

if (import.meta.main) {
  const manifest = await loadManifest();
  if (!manifest) fail(`no manifest at ${rel(MANIFEST_PATH)} — run \`accio map\` first`);
  const m = manifest!;

  const { doc, fresh } = await loadSpec();
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

  const feRoot = expand(m.fe_repo);
  if (!(await Bun.file(join(feRoot, "package.json")).exists())) fail(`frontend repo not found at ${feRoot}`);
  const idx = indexOps(doc, ops);
  const analysis = await analyzeRepo(feRoot, idx);
  const feRev = await repoRev(feRoot);
  console.log(`frontend: ${analysis.fileCount} files analyzed · ${analysis.routes.length} routes · \`${feRev}\``);

  // aliases can be edited in either place — union doc frontmatter back into the manifest
  let manifestDirty = false;
  for (const f of m.features) {
    const existing = await Bun.file(archDocPath(f)).text().catch(() => null);
    if (!existing) continue;
    for (const a of readAliases(existing))
      if (!f.aliases.includes(a)) { f.aliases.push(a); manifestDirty = true; }
  }
  if (manifestDirty) await saveManifest(m);

  const index = buildIndex(analysis, m, ops, feRev, doc.info?.version ?? "?");
  await Bun.write(INDEX_PATH, JSON.stringify(index));

  if (fresh) {
    await Bun.write(CACHE, JSON.stringify(doc));
    const currFp: Record<string, string> = {};
    for (const o of ops) currFp[o.key] = fingerprintOf(o);
    await Bun.write(FINGERPRINT, JSON.stringify(currFp));
    await Bun.write(META, JSON.stringify({
      source: SPEC_UI_URL, title: doc.info?.title, version: doc.info?.version,
      fetchedAt, operations: ops.length, previousFetchedAt: prevMeta?.fetchedAt ?? null,
    }, null, 2));
  }

  const meta: DocMeta = { feRev, date: fetchedAt, specVersion: doc.info?.version ?? "?", specUrl: SPEC_UI_URL };
  const opsByKey = new Map(ops.map(o => [o.key, o]));
  let wrote = 0;
  for (const f of index.features) {
    if (ONLY && f.id !== ONLY) continue;
    const docPath = join(FEATURES_DIR, f.dir, "docs/arch.md");
    const existing = await Bun.file(docPath).text().catch(() => null);
    await Bun.write(docPath, renderArchDoc(f, opsByKey, meta, existing));
    wrote++;
  }
  if (ONLY && !wrote) fail(`no feature "${ONLY}" — have: ${index.features.map(f => f.id).join(", ")}`);

  if (!ONLY) await Bun.write(REPORT, renderReport(diff, index, doc, prevMeta?.fetchedAt ?? null, fetchedAt));

  const problems = [...await auditDocs(index), ...await auditJournal(index)];
  if (problems.length) {
    console.log(`\n⚠ audit — docs claim things the code or spec no longer backs:`);
    for (const p of problems.slice(0, 12)) console.log(`   ${p}`);
    if (problems.length > 12) console.log(`   …and ${problems.length - 12} more (accio audit)`);
  } else console.log("audit: docs clean");

  console.log(`\nwrote ${wrote} arch doc${wrote === 1 ? "" : "s"} → ${rel(FEATURES_DIR)}/**/docs/arch.md` +
    `${ONLY ? " (scoped — report not rewritten)" : ` · ${rel(REPORT)} · index ${rel(INDEX_PATH)}`}`);
}
