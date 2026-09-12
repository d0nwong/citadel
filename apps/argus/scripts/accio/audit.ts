#!/usr/bin/env bun
/**
 * accio audit — hold the docs to what the code and spec actually back.
 *
 * Hand-written prose naming an endpoint nothing calls any more is the failure mode
 * curated docs always have; this generalizes the first accio's data-flow drift check to
 * every endpoint mention OUTSIDE the machine-owned regions, plus DOC-PROTOCOL conformance
 * (frontmatter, required headings, core paths that still exist).
 *
 *   accio audit          report; exit 1 if anything fails
 */

import { join, relative } from "node:path";
import { normPath } from "./spec.ts";
import { FEATURES_DIR, STATE, ROOT, DEFAULT_FE_REPO, DEFAULT_BE_REPO, expand } from "./manifest.ts";
import { ATTR_DEPTH, type AccioIndex } from "./index-store.ts";
import { readStamp, gitIsAncestor } from "./stamps.ts";

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

if (import.meta.main) {
  const f = Bun.file(join(STATE, "accio-index.json"));
  if (!(await f.exists())) { console.error("error: no index — run `accio sync` first"); process.exit(1); }
  const index = await f.json();
  const v = Bun.spawnSync(["bun", join(ROOT, "scripts/argus.ts"), "validate"], { stdout: "pipe", stderr: "pipe" });
  const problems = [...await auditDocs(index), ...v.stderr.toString().split("\n").filter(Boolean)];
  if (!problems.length) { console.log("audit: clean"); process.exit(0); }
  console.log(`audit: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
