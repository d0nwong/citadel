#!/usr/bin/env bun
/**
 * api-find — "which API provides data for X?" in one call.
 *
 * Reads the generated `api.md` files and answers by component. Ranks component matches
 * above endpoint matches, because the question is almost always "what does this UI thing
 * talk to", not "who calls this endpoint" — but answers both, since the reverse lookup
 * is how you find the owner of an endpoint you already have.
 *
 *   bun scripts/api-find.ts "status select"
 *   bun scripts/api-find.ts projects --endpoints   # reverse: who calls /projects?
 *   bun scripts/api-find.ts --list                 # every mapped component
 */

import { relative, dirname, basename } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const FEATURES = `${ROOT}/alden/alden-portal/features`;

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const LIST = flag("--list");
const ENDPOINTS_ONLY = flag("--endpoints");
/** Scope to one feature so the query names only the SUBJECT ("project"), not the place
 *  ("task detail") — mixing both makes the location words outrank the thing asked about. */
const IN = (() => { const i = argv.indexOf("--in"); return i >= 0 ? argv[i + 1]?.toLowerCase() : undefined; })();
const query = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--in")
  .join(" ").toLowerCase().trim();

if (!query && !LIST) {
  console.error('usage: bun scripts/api-find.ts "<what you are looking for>"');
  process.exit(1);
}

type Op = { key: string; summary: string; tag: string; sites: string };
type Comp = {
  slug: string; project: string; doc: string;
  does: string; files: string; ops: Op[];
};
type Doc = { project: string; path: string; mode: "calls" | "tags"; comps: Comp[]; ops: Op[] };

/** The generated api.md is the index; parsing it keeps one source of truth. */
function parseDoc(project: string, path: string, text: string): Doc {
  const mode = /\*\*Mode:\*\* calls/.test(text) ? "calls" : "tags";
  const comps: Comp[] = [];
  const ops: Op[] = [];

  if (mode === "tags") {
    // tags mode has only the Index table
    for (const m of text.matchAll(/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/gm))
      ops.push({ key: `${m[1]} ${m[2]}`, summary: m[3].trim(), tag: "", sites: "" });
    return { project, path, mode, comps, ops };
  }

  const sections = text.split(/^## /m).slice(1);
  for (const sec of sections) {
    const nl = sec.indexOf("\n");
    const slug = sec.slice(0, nl).trim();
    if (/^(Components with no code mapping|Unattributed calls|Available but unused|Unmatched URL literals)$/.test(slug)) {
      // still worth indexing the endpoints these carry, minus the component
      for (const m of sec.matchAll(/^- `((?:GET|POST|PUT|PATCH|DELETE) [^`]+)`(?: — ([^\n_]*))?/gm))
        ops.push({ key: m[1], summary: (m[2] ?? "").trim(), tag: slug, sites: "" });
      continue;
    }
    const body = sec.slice(nl + 1);
    const lines = body.split("\n");
    const does = (lines.find(l => l.trim() && !l.startsWith("`") && !l.startsWith("-")) ?? "").trim();
    const files = (lines.find(l => l.trim().startsWith("`")) ?? "").trim();
    const cops: Op[] = [];
    for (const m of body.matchAll(/^- `((?:GET|POST|PUT|PATCH|DELETE) [^`]+)`(?: — ([^\n_]*))?(_\(([^)]*)\)_)?[\s\S]*?(?:\n {4}← ([^\n]*))?$/gm))
      cops.push({ key: m[1], summary: (m[2] ?? "").trim(), tag: m[4] ?? "", sites: (m[5] ?? "").trim() });
    comps.push({ slug, project, doc: path, does, files, ops: cops });
    ops.push(...cops);
  }
  return { project, path, mode, comps, ops };
}

import { parseDataFlow, entryText, type Entry } from "../lib/dataflow.ts";

type Sym = { name: string; kind: string; files: string[]; ops: string[]; guards: string[]; projects: string[] };
const symbolsPath = `${ROOT}/.state/symbols.json`;
const symbols: Sym[] = await Bun.file(symbolsPath).exists()
  ? Object.values((await Bun.file(symbolsPath).json()).symbols) : [];

const flows: Entry[] = [];
for await (const f of new Bun.Glob("**/data-flow.md").scan({ cwd: FEATURES, absolute: true })) {
  const project = basename(dirname(f));
  if (IN && !project.toLowerCase().includes(IN)) continue;
  flows.push(...parseDataFlow(project, await Bun.file(f).text()));
}

const docs: Doc[] = [];
for await (const f of new Bun.Glob("**/api.md").scan({ cwd: FEATURES, absolute: true })) {
  const project = basename(dirname(f));
  if (IN && !project.toLowerCase().includes(IN)) continue;
  docs.push(parseDoc(project, relative(ROOT, f), await Bun.file(f).text()));
}
if (IN && !docs.length) {
  console.error(`error: no feature matching "${IN}"`);
  process.exit(1);
}

if (LIST) {
  for (const d of docs) {
    if (d.mode === "tags") { console.log(`${d.project.padEnd(24)} (tags mode — not mapped)`); continue; }
    for (const c of d.comps)
      console.log(`${c.slug.padEnd(24)} ${d.project.padEnd(14)} ${String(c.ops.length).padStart(3)} ops  ${c.does.slice(0, 60)}`);
  }
  process.exit(0);
}

const terms = query.split(/\s+/).filter(Boolean);

/**
 * Substring match, plus the cheapest possible stemming: a trailing `s` is optional.
 * "projects select" must find a `does:` line that says "project", and vice versa —
 * singular/plural is the single most common way a real query misses.
 */
const hit = (text: string, term: string) => {
  const t = text.toLowerCase();
  if (t.includes(term)) return true;
  if (term.endsWith("s") && t.includes(term.slice(0, -1))) return true;
  if (!term.endsWith("s") && t.includes(term + "s")) return true;
  return false;
};

/**
 * Generic UI nouns people use interchangeably. The code calls it `taskPriority`, a user
 * calls it "the priority select", "the priority field", "the priority dropdown" — all the
 * same thing. These still BOOST when they match, but they never veto a result, or the
 * query fails purely on the questioner having guessed the wrong widget word.
 */
const SOFT = new Set([
  "select", "field", "dropdown", "input", "badge", "button", "toggle", "picker",
  "control", "widget", "menu", "chip", "list", "panel", "modal", "page", "screen",
]);

/** Hard terms must all land somewhere; soft terms only add score. */
const score = (fields: { text: string; weight: number }[]) => {
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const f of fields) if (hit(f.text, t)) best = Math.max(best, f.weight);
    if (!best) {
      if (SOFT.has(t)) continue;    // wrong widget word — not a reason to fail
      return 0;
    }
    total += best;
  }
  return total;
};

const compHits = docs.flatMap(d => d.comps.map(c => ({
  c, d, s: score([
    { text: c.does, weight: 3 },
    { text: c.slug, weight: 3 },
    // A call site named `project-select.tsx` is the user's own vocabulary, and it is
    // often the ONLY place a UI word like "select" appears anywhere in the docs.
    { text: c.ops.map(o => o.sites).join(" "), weight: 2 },
    { text: c.files, weight: 1 },
    { text: c.ops.map(o => o.key + o.summary).join(" "), weight: 1 },
  ]),
}))).filter(h => h.s > 0).sort((a, b) => b.s - a.s);

const opHits = docs.flatMap(d => d.ops.map(o => ({
  o, d, s: score([{ text: o.key, weight: 2 }, { text: o.summary, weight: 2 }, { text: o.sites, weight: 1 }]),
}))).filter(h => h.s > 0).sort((a, b) => b.s - a.s);

/**
 * Curated data-flow entries outrank everything: they are the only layer that can say how a
 * value is passed down and what was done to it. Components answer "which endpoint", symbols
 * only route to files.
 */
const flowHits = ENDPOINTS_ONLY ? [] : flows
  .map(e => ({ e, s: score([{ text: entryText(e), weight: 4 }]) }))
  .filter(h => h.s > 0)
  .sort((a, b) => b.s - a.s);

for (const { e } of flowHits.slice(0, 2)) {
  console.log(`\n## ${e.symbol}  —  ${e.project}   (documented)`);
  if (e.aka.length) console.log(`aka: ${e.aka.join(", ")}`);
  for (const [k, v] of e.meta) console.log(`${k}: ${v}`);
  for (const l of e.readLines) console.log(`  reads:  ${l}`);
  for (const l of e.writeLines) console.log(`  writes: ${l}`);
  if (e.prose) console.log(`\n${e.prose}`);
}

// A documented answer makes the routing layers noise; only fall through when it missed.
if (!ENDPOINTS_ONLY && !flowHits.length && compHits.length) {
  for (const { c, d } of compHits.slice(0, 3)) {
    console.log(`\n## ${c.slug}  —  ${d.project}   (${d.path})`);
    if (c.does) console.log(c.does);
    if (c.files) console.log(c.files);
    if (!c.ops.length) {
      console.log("\n  Calls nothing — no network reached from these files.");
      continue;
    }
    console.log();
    // Within a component, put the endpoints the query actually named first — otherwise
    // the answer to "where does the project value come from" sits ninth in a list of 20.
    const rel = (o: Op) => terms.filter(t => hit(o.key + " " + o.summary + " " + o.sites, t)).length;
    const byRel = (a: Op, b: Op) => rel(b) - rel(a);
    const direct = c.ops.filter(o => !/indirect/.test(o.tag)).sort(byRel);
    const indirect = c.ops.filter(o => /indirect/.test(o.tag)).sort(byRel);
    const hot = direct.filter(o => rel(o) > 0).length;
    direct.forEach((o, i) => {
      if (hot && i === hot) console.log(`  — rest of this component's calls —`);
      console.log(`  ${o.key}${o.summary ? `  — ${o.summary}` : ""}${o.sites ? `\n      ← ${o.sites}` : ""}`);
    });
    if (indirect.length) {
      console.log(`\n  indirect (fan-out, probably not this component's own contract):`);
      for (const o of indirect) console.log(`  ${o.key}${o.summary ? `  — ${o.summary}` : ""}`);
    }
  }
}

/**
 * Symbols are the field-grain layer. They ROUTE — files and guards — rather than claim an
 * endpoint: a field is populated by data its parent fetched and passed down, and neither
 * import reachability nor the response schemas can pin that to one endpoint honestly.
 */
const symHits = (ENDPOINTS_ONLY || flowHits.length) ? [] : symbols
  .map(sy => ({
    sy,
    s: score([
      { text: sy.name, weight: 3 },
      { text: sy.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2"), weight: 3 },
      { text: sy.files.map(f => (f.split("/").pop() ?? "").replace(/[-_.]/g, " ")).join(" "), weight: 2 },
    ]),
  }))
  .filter(h => h.s > 0)
  // A form field is what someone means by "the priority select"; an exported constant that
  // happens to share the word is not. Rank by kind before anything else.
  .map(h => ({ ...h, s: h.s + ({ field: 4, file: 2, export: 0 }[h.sy.kind] ?? 0) }))
  .sort((a, b) => b.s - a.s || a.sy.files.length - b.sy.files.length);

if (symHits.length && (!compHits.length || symHits[0].s >= 6)) {
  console.log(compHits.length ? "\n## symbols (field-level)" : "\n## symbols");
  for (const { sy } of symHits.slice(0, 3)) {
    console.log(`\n  ${sy.name}  (${sy.kind}${sy.projects?.length ? ` · ${sy.projects.join(", ")}` : ""})`);
    console.log(`  read these:`);
    for (const f of sy.files.slice(0, 6)) console.log(`      ${f}`);
    if (sy.guards.length) {
      console.log(`  conditions found near it:`);
      for (const g of sy.guards.slice(0, 4)) console.log(`      ${g}`);
    }
    if (sy.ops.length)
      console.log(`  reachable endpoints: ${sy.ops.length} — candidates only, this is the\n      surrounding screen's traffic, not proof this field uses them. Open the files.`);
  }
}

if (ENDPOINTS_ONLY || (!compHits.length && !symHits.length && !flowHits.length)) {
  const seen = new Set<string>();
  const rows = opHits.filter(h => !seen.has(h.o.key + h.d.project) && seen.add(h.o.key + h.d.project)).slice(0, 12);
  if (rows.length) {
    console.log(compHits.length ? "\n## endpoints" : "\nNo component matched. Endpoints matching instead:\n");
    for (const { o, d } of rows)
      console.log(`  ${o.key}${o.summary ? `  — ${o.summary}` : ""}\n      ${d.project}${o.tag ? ` · ${o.tag}` : ""}`);
  } else {
    console.log(`\nNothing matched "${query}".`);
  }
}

// Never let a confident-looking answer hide the fact that most of the corpus is unmapped.
const tagsMode = docs.filter(d => d.mode === "tags").map(d => d.project);
if (tagsMode.length)
  console.log(`\n⚠ not yet mapped (tags mode, no component attribution): ${tagsMode.join(", ")}`);
