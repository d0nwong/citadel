#!/usr/bin/env bun
/**
 * accio find — "which API backs this UI element?", answered from the index.
 *
 * Answer layers, most-curated first (first confident layer wins):
 *   curated    manifest component groupings + feature aliases — their endpoints ARE the answer
 *   screen     UI-visible text match (JSX labels, placeholders, headings) — the words the
 *              user actually sees; answers with that file's own calls
 *   symbols    the code's own vocabulary (form fields, exports, filenames) — ROUTES to the
 *              files to read; reachable endpoints are candidates, never claims
 *   endpoints  reverse lookup — who calls this path (--endpoints, or fallthrough)
 *
 *   accio "status select"              what backs this thing?
 *   accio project --in tasks           scope to one feature (the PLACE goes here, not the query)
 *   accio tasks/{taskId} --endpoints   reverse: which feature calls this?
 *   accio list [--in <feature>]        mapped features / one feature's components
 */

import { join } from "node:path";
import { STATE, FEATURES_DIR, ROOT } from "../lib/manifest.ts";
import { ATTR_DEPTH, type AccioIndex, type IdxFeature, type IdxComponent } from "../lib/index-store.ts";
import { relative } from "node:path";

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const LIST = flag("--list");
const ENDPOINTS_ONLY = flag("--endpoints");
const IN = (() => { const i = argv.indexOf("--in"); return i >= 0 ? argv[i + 1]?.toLowerCase() : undefined; })();
const query = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--in").join(" ").toLowerCase().trim();

const idxFile = Bun.file(join(STATE, "accio-index.json"));
if (!(await idxFile.exists())) { console.error("error: no index — run `accio sync` first"); process.exit(1); }
const index: AccioIndex = await idxFile.json();

let features = index.features;
if (IN) {
  features = features.filter(f => f.id.toLowerCase().includes(IN) || f.name.toLowerCase().includes(IN));
  if (!features.length) { console.error(`error: no feature matching "${IN}" — have: ${index.features.map(f => f.id).join(", ")}`); process.exit(1); }
}
const inScope = new Set(features.map(f => f.id));
const scoped = (featureIds: string[]) => !IN || featureIds.some(id => inScope.has(id));

if (LIST) {
  for (const f of features) {
    const direct = f.ops.filter(o => o.dist <= ATTR_DEPTH).length;
    console.log(`${f.id.padEnd(24)} ${String(direct).padStart(3)} ops  ${f.entry_routes[0] ?? ""}  ${f.aliases.length ? `aka: ${f.aliases.join(", ")}` : ""}`);
    if (IN) for (const c of f.components)
      console.log(`  ${c.slug.padEnd(30)} ${c.curated ? "curated" : "derived"}  ${String(c.ops.length).padStart(3)} ops  ${c.does.slice(0, 50)}`);
  }
  process.exit(0);
}
if (!query) { console.error('usage: accio "<what you are looking for>"'); process.exit(1); }

// ---------------------------------------------------------------- scoring (measured, ported)

const terms = query.split(/\s+/).filter(Boolean);

/** Substring match + the cheapest possible stemming: a trailing `s` is optional —
 *  singular/plural is the single most common way a real query misses. */
const hit = (text: string, term: string) => {
  const t = text.toLowerCase();
  if (t.includes(term)) return true;
  if (term.endsWith("s") && t.includes(term.slice(0, -1))) return true;
  if (!term.endsWith("s") && t.includes(term + "s")) return true;
  return false;
};

/** Generic widget words BOOST when they match but never veto — the questioner guessing
 *  the wrong widget word ("dropdown" vs "select") must not fail the query. */
const SOFT = new Set([
  "select", "field", "dropdown", "input", "badge", "button", "toggle", "picker",
  "control", "widget", "menu", "chip", "list", "panel", "modal", "page", "screen", "the",
]);

const score = (fields: { text: string; weight: number }[]) => {
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const f of fields) if (f.text && hit(f.text, t)) best = Math.max(best, f.weight);
    if (!best) { if (SOFT.has(t)) continue; return 0; }
    total += best;
  }
  // The whole phrase landing in ONE field ("subtask-status-select" for "status select")
  // is a far stronger signal than terms scattered across fields — reward it hard.
  if (total && terms.length >= 2)
    for (const f of fields)
      if (f.text && f.text.toLowerCase().includes(query)) { total += f.weight * 2; break; }
  return total;
};

const splitCamel = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
const fileWords = (f: string) => (f.split("/").pop() ?? "").replace(/[-_.]/g, " ");

// ---------------------------------------------------------------- layers

// 1. curated: feature aliases + curated components
type CompHit = { c: IdxComponent; f: IdxFeature; s: number };
const compHits: CompHit[] = features.flatMap(f =>
  f.components.filter(c => c.curated).map(c => ({
    c, f, s: score([
      { text: c.slug + " " + c.aliases.join(" "), weight: 4 },
      { text: c.does, weight: 3 },
      { text: c.files.join(" ") + " " + c.ops.flatMap(o => o.sites).map(fileWords).join(" "), weight: 2 },
      { text: c.ops.map(o => o.key).join(" "), weight: 1 },
    ]),
  }))).filter(h => h.s > 0).sort((a, b) => b.s - a.s);

const featHits = features.map(f => ({
  f, s: score([
    { text: f.name + " " + f.id.replace(/-/g, " ") + " " + f.aliases.join(" "), weight: 4 },
    { text: f.entry_routes.join(" "), weight: 2 },
  ]),
})).filter(h => h.s > 0).sort((a, b) => b.s - a.s);

// 2. screen: UI-visible vocabulary per file
type FileHit = { file: string; v: { visible: string[]; fields: string[]; features: string[] }; s: number };
const fileHits: FileHit[] = Object.entries(index.vocab)
  .filter(([, v]) => scoped(v.features))
  .map(([file, v]) => ({
    file, v, s: score([
      { text: v.visible.join(" · "), weight: 3 },
      { text: v.fields.map(splitCamel).join(" "), weight: 3 },
      { text: fileWords(file), weight: 2 },
    ]),
  })).filter(h => h.s > 0).sort((a, b) => b.s - a.s);

// 3. symbols
const symHits = Object.values(index.symbols)
  .filter(sy => scoped(sy.features) || !sy.features.length)
  .map(sy => ({
    sy, s: score([
      { text: sy.name + " " + splitCamel(sy.name), weight: 3 },
      { text: sy.files.map(fileWords).join(" "), weight: 2 },
    ]),
  })).filter(h => h.s > 0)
  // a form field is what someone means by "the priority select"; a colliding export is not
  .map(h => ({ ...h, s: h.s + ({ field: 4, file: 2, export: 0 }[h.sy.kind] ?? 0) }))
  .sort((a, b) => b.s - a.s || a.sy.files.length - b.sy.files.length);

// 4. endpoints (reverse)
const opHits = Object.entries(index.ops)
  .filter(([, o]) => scoped(o.features) || !o.features.length)
  .map(([key, o]) => ({ key, o, s: score([{ text: key, weight: 2 }, { text: o.summary, weight: 2 }]) }))
  .filter(h => h.s > 0).sort((a, b) => b.s - a.s);

// ---------------------------------------------------------------- output

const docPath = (f: IdxFeature) =>
  relative(process.cwd(), join(FEATURES_DIR, f.dir, "docs/arch.md"));

/** the file's own calls, from its derived component row (exact), else symbol candidates */
const opsOfFile = (file: string): { direct: string[]; candidates: string[] } => {
  for (const f of index.features)
    for (const c of f.components)
      if (!c.curated && c.files[0] === file)
        return { direct: c.ops.map(o => o.key), candidates: [] };
  const base = (file.split("/").pop() ?? "").replace(/\.(tsx?|jsx?)$/, "").toLowerCase();
  return { direct: [], candidates: index.symbols[base]?.candidateOps ?? [] };
};

const summ = (key: string) => index.ops[key.replace(/^~/, "")]?.summary ?? "";
const printOp = (key: string, pad = "  ") => {
  const k = key.replace(/^~/, "");
  console.log(`${pad}${k}${key.startsWith("~") ? "  (method inferred)" : ""}${summ(k) ? `  — ${summ(k)}` : ""}`);
};

let answered = false;

if (!ENDPOINTS_ONLY) {
  for (const { c, f } of compHits.slice(0, 2)) {
    answered = true;
    console.log(`\n## ${c.slug}  —  ${f.id}   (curated)`);
    if (c.does) console.log(c.does);
    console.log(c.files.map(x => `\`${x}\``).join(" · "));
    if (!c.ops.length) { console.log("\n  Calls nothing — no network reached from these files."); continue; }
    console.log();
    const rel2 = (o: { key: string; sites: string[] }) => terms.filter(t => hit(o.key + " " + o.sites.join(" "), t)).length;
    for (const o of [...c.ops].sort((a, b) => rel2(b) - rel2(a))) printOp(o.key);
    console.log(`\n  doc: ${docPath(f)}`);
  }

  // A curated answer makes the derived layers noise; fall through only when it missed.
  if (!answered) {
    for (const h of fileHits.slice(0, 3)) {
      answered = true;
      const matched = h.v.visible.filter(t => terms.some(x => hit(t, x))).slice(0, 3);
      console.log(`\n## ${h.file}  —  ${h.v.features.join(", ") || "unmapped"}   (screen text)`);
      if (matched.length) console.log(`  on screen: ${matched.map(t => JSON.stringify(t)).join(" · ")}`);
      const { direct, candidates } = opsOfFile(h.file);
      if (direct.length) { console.log("  this file calls:"); direct.forEach(k => printOp(k, "    ")); }
      else if (candidates.length) {
        console.log(`  calls nothing itself — ${candidates.length} reachable endpoint${candidates.length === 1 ? "" : "s"} nearby are CANDIDATES (the screen's traffic, not proof). Open the file.`);
        for (const k of candidates.filter(k => terms.some(t => !SOFT.has(t) && hit(k, t))).slice(0, 4))
          console.log(`      candidate: ${k}${summ(k) ? `  — ${summ(k)}` : ""}`);
      }
      else console.log("  calls nothing — pure UI as far as the code shows.");
    }

    const strong = symHits.filter(h => !fileHits.length || h.s >= 6);
    if (strong.length) {
      console.log(`\n## symbols (the code's own vocabulary)`);
      for (const { sy } of strong.slice(0, 3)) {
        console.log(`\n  ${sy.name}  (${sy.kind}${sy.features.length ? ` · ${sy.features.join(", ")}` : ""})`);
        console.log(`  read these:`);
        for (const f of sy.files.slice(0, 6)) console.log(`      ${f}`);
        if (sy.guards.length) { console.log(`  conditions found near it:`); sy.guards.slice(0, 4).forEach(g => console.log(`      ${g}`)); }
        if (sy.candidateOps.length) {
          console.log(`  reachable endpoints: ${sy.candidateOps.length} — candidates only, this is the\n      surrounding screen's traffic, not proof this ${sy.kind} uses them. Open the files.`);
          // candidates stay candidates — but the ones that MATCH THE QUERY are worth naming
          for (const k of sy.candidateOps.filter(k => terms.some(t => !SOFT.has(t) && hit(k, t))).slice(0, 4))
            console.log(`      candidate: ${k}${summ(k) ? `  — ${summ(k)}` : ""}`);
        }
      }
      answered = true;
    }
  }

  if (featHits.length && !compHits.length && featHits[0].s >= 4) {
    const f = featHits[0].f;
    console.log(`\n## feature: ${f.id}${f.aliases.length ? `  (aka ${f.aliases.join(", ")})` : ""}`);
    console.log(`  routes: ${f.entry_routes.join(", ") || "—"}`);
    console.log(`  ${f.ops.filter(o => o.dist <= ATTR_DEPTH).length} direct ops · doc: ${docPath(f)}`);
    answered = true;
  }
}

if (ENDPOINTS_ONLY || !answered) {
  const rows = opHits.slice(0, 12);
  if (rows.length) {
    console.log(ENDPOINTS_ONLY ? "" : `\nNo component matched. Endpoints matching instead:\n`);
    for (const { key, o } of rows)
      console.log(`  ${key}${o.summary ? `  — ${o.summary}` : ""}\n      called by: ${o.features.join(", ") || "nothing found in the frontend"}`);
  } else if (!answered) console.log(`\nNothing matched "${query}".`);
}

// Never let a confident answer hide how much is still uncurated.
const uncurated = features.filter(f => f.type === "feature" && !f.aliases.length && !f.components.some(c => c.curated));
if (uncurated.length && !ENDPOINTS_ONLY)
  console.log(`\n⚠ ${uncurated.length}/${index.features.filter(f => f.type === "feature").length} features have no curated aliases/components yet — derived layers only.`);
