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
import { normPath } from "../lib/spec.ts";
import { FEATURES_DIR, STATE, ROOT } from "../lib/manifest.ts";
import { ATTR_DEPTH, type AccioIndex } from "../lib/index-store.ts";

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
      const key = normPath(`${m[1]} ${m[2].replace(/[`"').,]+$/, "")}`);
      if (!specKeys.has(key)) problems.push(`${name}: prose names \`${m[1]} ${m[2]}\` — not in the spec`);
      else if (f.type === "feature" && !called.has(key))
        problems.push(`${name}: prose names \`${m[1]} ${m[2]}\` — nothing this feature reaches calls it`);
    }
  }
  return problems;
}

/**
 * Journal checks (protocol Phase 5): entries route by frontmatter, so a typo'd feature id
 * or a dead status silently orphans a change record — and an `implemented` entry whose
 * feature has since been re-verified means the refresh loop missed it.
 */
export async function auditJournal(index: AccioIndex, dir = FEATURES_DIR): Promise<string[]> {
  const problems: string[] = [];
  const ids = new Set(index.features.map(f => f.id));
  const STATUSES = new Set(["decided", "implemented", "documented"]);
  const TICKET = /^([A-Z][A-Z0-9]{1,9}-\d+|https:\/\/trello\.com\/\S+)$/;

  // product docs move only on real re-verification (arch docs regen every sync)
  const verifiedAt = new Map<string, string>();
  for (const f of index.features) {
    const t = await Bun.file(join(FEATURES_DIR, f.dir, "docs/product.md")).text().catch(() => null);
    const d = t?.match(/^last_verified_date:\s*(\S+)/m)?.[1];
    if (d) verifiedAt.set(f.id, d);
  }

  const idByDir = new Map(index.features.map(f => [f.dir, f.id]));

  for await (const path of new Bun.Glob("**/journal/*.md").scan({ cwd: dir, absolute: true })) {
    const name = relative(dir, path);
    const owner = idByDir.get(name.replace(/\/journal\/[^/]+$/, ""));
    const text = await Bun.file(path).text();
    const field = (k: string) => text.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
    const date = field("date"), status = field("status")?.split(/\s/)[0], ticket = field("ticket");
    const feats = (text.match(/^features:\s*\[([^\]]*)\]/m)?.[1] ?? "")
      .split(",").map(x => x.trim()).filter(Boolean);

    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) problems.push(`${name}: missing or malformed date`);
    if (!status || !STATUSES.has(status)) problems.push(`${name}: status must be decided|implemented|documented`);
    if (!feats.length) problems.push(`${name}: features: [] is empty — entry routes nowhere`);
    for (const f of feats) if (!ids.has(f)) problems.push(`${name}: unknown feature id \`${f}\``);
    // the folder is where a human looks; `features:` is what routes the refresh. If the
    // folder's own feature is missing from the list, the entry is invisible to the very
    // feature it was filed under.
    if (!owner) problems.push(`${name}: journal folder matches no feature dir in the manifest`);
    else if (feats.length && !feats.includes(owner))
      problems.push(`${name}: filed under \`${owner}\` but features: [${feats.join(", ")}] does not name it`);
    if (ticket && ticket !== "null" && !TICKET.test(ticket.replace(/^["']|["']$/g, "")))
      problems.push(`${name}: ticket \`${ticket}\` is neither a KEY-123 nor a trello.com link`);

    // implemented + docs re-verified after the entry ⇒ the refresh ran but didn't close it
    if (status === "implemented" && date)
      for (const f of feats) {
        const v = verifiedAt.get(f);
        if (v && v >= date.slice(0, 10))
          problems.push(`${name}: implemented, but ${f} docs were re-verified ${v} — refresh missed this entry or it should be documented`);
      }
  }
  return problems;
}

if (import.meta.main) {
  const f = Bun.file(join(STATE, "accio-index.json"));
  if (!(await f.exists())) { console.error("error: no index — run `accio sync` first"); process.exit(1); }
  const index = await f.json();
  const problems = [...await auditDocs(index), ...await auditJournal(index)];
  if (!problems.length) { console.log("audit: clean"); process.exit(0); }
  console.log(`audit: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
