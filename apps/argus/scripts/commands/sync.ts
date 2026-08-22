#!/usr/bin/env bun
/**
 * openapi-sync — derive per-feature API docs from the Alden Connect Portal OpenAPI spec.
 *
 * The backend is owned by another team. This script is the read-only bridge: it fetches
 * their spec, caches it, diffs it against the last sync, and writes a curated `api.md`
 * into each feature project that declares an `api:` block in its project.yaml.
 *
 * Mechanical only — no AI, no judgment. Deciding what a diff *means* for a todo is the
 * project-manager skill's job.
 *
 *   accio sync                 fetch, diff, regenerate every api.md
 *   accio sync --offline       use the cached spec (no network)
 *   accio sync --check         report only, write nothing
 *   accio sync --project tasks limit generation to one project
 */

import { join, relative, dirname, resolve as rp } from "node:path";
import { indexOps, collectUsage, type Usage } from "../lib/usage.ts";
import { buildSymbols, type Symbol } from "../lib/symbols.ts";
import { parseDataFlow, checkDrift, type Drift } from "../lib/dataflow.ts";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const STATE = join(ROOT, ".state");
const FEATURES = join(ROOT, "alden/alden-portal/features");

const SPEC_UI_URL = "https://dev-alden-portal.uc.r.appspot.com/api-docs/";
const SPEC_JS_URL = SPEC_UI_URL + "swagger-ui-init.js";

const CACHE = join(STATE, "openapi.json");            // big, gitignored
const FINGERPRINT = join(STATE, "openapi-fingerprint.json"); // small, tracked
const META = join(STATE, "openapi-meta.json");
const REPORT = join(STATE, "last-api-sync.md");
/** One greppable file answering "which project owns X?" before any api.md is opened. */
const INDEX = join(FEATURES, "COMPONENTS.md");
/** Derived from code, never curated — the field-grain fallback behind component lookup. */
const SYMBOLS = join(STATE, "symbols.json");

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** User error — a message, not a stack trace. */
const fail = (msg: string): never => { console.error(`error: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const OFFLINE = has("--offline");
const CHECK = has("--check");
const ONLY = opt("--project");
/**
 * How many import hops from a component's own files still count as "this component calls
 * it". Unbounded reachability attributes the shared axios client's `POST /auth/refresh`
 * and every dashboard invalidation query to every component. 2 covers the real shape:
 * the component's file, the `src/http/*` module it imports, and one hop beyond.
 */
const ATTR_DEPTH = Number(opt("--attribution-depth") ?? 2);

// ---------------------------------------------------------------- spec loading

/** The spec is embedded in swagger-ui-init.js as `"swaggerDoc": {...}` — no JSON endpoint. */
function extractSwaggerDoc(js: string): any {
  const at = js.indexOf('"swaggerDoc"');
  if (at < 0) throw new Error("no swaggerDoc in swagger-ui-init.js — did the docs move?");
  const start = js.indexOf("{", at);
  let depth = 0, inStr = false, esc = false;
  for (let p = start; p < js.length; p++) {
    const c = js[p];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(js.slice(start, p + 1));
  }
  throw new Error("unbalanced swaggerDoc JSON");
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

// ---------------------------------------------------------------- operations

type Op = {
  key: string; method: string; path: string; tags: string[];
  summary: string; description: string;
  params: { in: string; name: string; required: boolean; type: string; description: string }[];
  bodySchema: string | null; body: Field[];
  responses: { code: string; description: string; schema: string | null }[];
  auth: string[];
  deprecated: boolean;
};
type Field = { name: string; type: string; required: boolean; description: string };

const refName = (s: any): string | null =>
  typeof s?.$ref === "string" ? s.$ref.split("/").pop()! : null;

function typeOf(schema: any, doc: any, seen = 0): string {
  if (!schema) return "?";
  const r = refName(schema);
  if (r) return r;
  if (schema.type === "array") return `${typeOf(schema.items, doc, seen + 1)}[]`;
  if (schema.enum) return schema.enum.slice(0, 6).map((e: any) => JSON.stringify(e)).join("|");
  if (schema.oneOf || schema.anyOf) return (schema.oneOf ?? schema.anyOf).map((s: any) => typeOf(s, doc, seen + 1)).join(" | ");
  if (schema.type === "string" && schema.format) return `string<${schema.format}>`;
  return schema.type ?? "object";
}

const deref = (schema: any, doc: any): any => {
  const r = refName(schema);
  return r ? doc.components?.schemas?.[r] ?? schema : schema;
};

/** One level of fields — enough to code against, small enough to keep in context. */
function fieldsOf(schema: any, doc: any): Field[] {
  const s = deref(schema, doc);
  const props = s?.properties ?? deref(s?.items, doc)?.properties;
  if (!props) return [];
  const required: string[] = s?.required ?? [];
  return Object.entries<any>(props).map(([name, p]) => ({
    name,
    type: typeOf(p, doc, 1),
    required: required.includes(name),
    description: (p.description ?? "").split("\n")[0].trim(),
  }));
}

function flatten(doc: any): Op[] {
  const out: Op[] = [];
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    const shared = (item as any).parameters ?? [];
    for (const [method, op] of Object.entries<any>(item)) {
      if (!METHODS.includes(method as any)) continue;
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      out.push({
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(), path,
        tags: op.tags ?? ["(untagged)"],
        summary: op.summary ?? "",
        description: op.description ?? "",
        params: [...shared, ...(op.parameters ?? [])].map((p: any) => ({
          in: p.in, name: p.name, required: !!p.required,
          type: typeOf(p.schema, doc, 1),
          description: (p.description ?? "").split("\n")[0].trim(),
        })),
        bodySchema: refName(bodySchema) ?? (bodySchema ? "(inline)" : null),
        body: bodySchema ? fieldsOf(bodySchema, doc) : [],
        responses: Object.entries<any>(op.responses ?? {}).map(([code, r]) => ({
          code, description: r.description ?? "",
          schema: refName(r.content?.["application/json"]?.schema)
            ?? (r.content?.["application/json"]?.schema ? "(inline)" : null),
        })),
        auth: (op.security ?? []).flatMap((s: any) => Object.keys(s)),
        deprecated: !!op.deprecated,
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Changes to any of this are changes a consumer must care about. */
const fingerprintOf = (op: Op) =>
  Bun.hash(JSON.stringify([
    op.summary, op.deprecated, op.auth,
    op.params.map(p => [p.in, p.name, p.required, p.type]),
    op.bodySchema, op.body.map(f => [f.name, f.type, f.required]),
    op.responses.map(r => [r.code, r.schema]),
  ])).toString(16);

// ---------------------------------------------------------------- projects

const DEFAULT_REPO = "~/git/alden/alden-portal-fe";
const expand = (p: string) => p.replace(/^~/, process.env.HOME ?? "~");

type ApiCfg = {
  tags?: string[]; paths?: string[]; exclude?: string[];
  /** repo-relative globs seeding the call analysis — presence switches on calls mode */
  sources?: string[]; repo?: string;
};
/** A component is either a bare slug (journal vocabulary only) or a slug with code. */
type Component = { slug: string; does?: string; files?: string[] };
type Project = { name: string; dir: string; api: ApiCfg | null; components: Component[] };

/** `- slug` and `- {slug, does, files}` are both valid; the first is the older shape. */
const readComponent = (c: any): Component =>
  typeof c === "string" ? { slug: c }
    : { slug: c?.slug ?? String(c), does: c?.does, files: c?.files };

async function projects(): Promise<Project[]> {
  const found: Project[] = [];
  const glob = new Bun.Glob("**/project.yaml");
  for await (const f of glob.scan({ cwd: FEATURES, absolute: true })) {
    const cfg: any = Bun.YAML.parse(await Bun.file(f).text());
    found.push({
      name: cfg?.name ?? relative(FEATURES, dirname(f)),
      dir: dirname(f),
      api: cfg?.api ?? null,
      components: (cfg?.components ?? []).map(readComponent),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const globToRe = (g: string) =>
  new RegExp("^" + g.split("**").map(s =>
    s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
  ).join(".*") + "$");

function select(ops: Op[], api: ApiCfg): Op[] {
  const tags = new Set(api.tags ?? []);
  const pathRes = (api.paths ?? []).map(globToRe);
  const exclRes = (api.exclude ?? []).map(globToRe);
  return ops.filter(o =>
    !exclRes.some(re => re.test(o.path)) &&
    (o.tags.some(t => tags.has(t)) || pathRes.some(re => re.test(o.path))));
}

// ---------------------------------------------------------------- rendering

const rel = (p: string) => relative(ROOT, p);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Which component owns a repo-relative file? The MOST SPECIFIC glob wins, not the first
 * declared — otherwise a broad `components/task-detail/**` would steal the file that
 * `metadata-rail` names exactly, and ownership would depend on yaml ordering.
 */
function ownerOf(file: string, comps: Component[]): string | null {
  let best: { slug: string; len: number } | null = null;
  for (const c of comps)
    for (const g of c.files ?? []) {
      const pattern = /[*.]/.test(g.split("/").pop() ?? "") ? g : g.replace(/\/$/, "") + "/**";
      if (globToRe(pattern).test(file) || globToRe(pattern + "/**").test(file))
        if (!best || g.length > best.len) best = { slug: c.slug, len: g.length };
    }
  return best?.slug ?? null;
}

type ByComponent = {
  /** component slug -> op key -> { call sites, nearest import distance } */
  owned: Map<string, Map<string, { files: Set<string>; dist: number }>>;
  /** calls whose file matches no component's globs */
  unattributed: Map<string, Set<string>>;
};

/**
 * Attribute by REACHABILITY, not by call site. A component owns the ops its own files can
 * reach through the import graph — so a hook that delegates to `src/http/*` still shows the
 * calls it causes, and shared data-layer code shows up under every component that uses it.
 * The recorded file is the call site, which is what you open to check the claim.
 */
function attribute(usage: Usage, comps: Component[]): ByComponent {
  const owned = new Map<string, Map<string, { files: Set<string>; dist: number }>>();
  const unattributed = new Map<string, Set<string>>();
  const callSites = (op: string) => usage.ops.get(op) ?? usage.ops.get(op.replace(/^~/, "")) ?? new Set<string>();

  const attributed = new Set<string>();
  for (const [seed, reached] of usage.opsBySeed) {
    const slug = ownerOf(seed, comps);
    if (!slug) continue;
    const bucket = owned.get(slug) ?? owned.set(slug, new Map()).get(slug)!;
    for (const [op, dist] of reached) {
      if (dist > ATTR_DEPTH) continue;
      attributed.add(op);
      const e = bucket.get(op) ?? bucket.set(op, { files: new Set(), dist }).get(op)!;
      e.dist = Math.min(e.dist, dist);
      for (const f of callSites(op)) e.files.add(f);
    }
  }
  // Anything no component reaches — seeds outside every glob, or code reached only from
  // a seed with no component mapping.
  for (const [op, files] of usage.ops)
    if (!attributed.has(op)) unattributed.set(op, files);
  return { owned, unattributed };
}

/** Calls mode: the feature described component-first, APIs hanging off each component. */
function renderCallsMd(
  p: Project, usage: Usage, byComp: ByComponent, opsByKey: Map<string, Op>,
  selected: Op[], doc: any, fetchedAt: string,
): string {
  const L: string[] = [];
  const called = new Set(usage.ops.keys());

  L.push(`# ${p.name} — API surface by component`, "");
  L.push("> GENERATED FILE — do not edit. Regenerate with `accio sync`.");
  L.push(`> Source: ${doc.info?.title} v${doc.info?.version} — ${SPEC_UI_URL}`);
  L.push(`> Spec fetched ${fetchedAt}. The backend is owned by another team; this file is derived,`);
  L.push("> never authoritative. Overview and architecture live in `base.md` — not here.");
  L.push("");
  L.push(`**Mode:** calls — resolved from the code, not guessed from tag names.`);
  L.push(`**Scanned:** ${usage.seeds} seed files → ${usage.filesScanned} files (import depth ${usage.maxDepthReached}) → **${called.size} operations**`);
  L.push("");

  const withFiles = p.components.filter(c => c.files?.length);
  const withoutFiles = p.components.filter(c => !c.files?.length);

  for (const c of withFiles) {
    L.push(`## ${c.slug}`);
    if (c.does) L.push(c.does);
    L.push("");
    L.push((c.files ?? []).map(f => `\`${f}\``).join(" · "));
    L.push("");
    const ops = byComp.owned.get(c.slug);
    if (!ops?.size) {
      // Not an empty section — a pure module is a property base.md asserts and this checks.
      L.push("**Calls nothing.** No network access reached from these files.");
      L.push("");
      continue;
    }
    // Direct calls are this component's own contract; indirect ones are usually
    // cache-invalidation fan-out. Labelling beats silently mixing them.
    const entries = [...ops].sort((a, b) => a[1].dist - b[1].dist || a[0].localeCompare(b[0]));
    for (const [key, { files, dist }] of entries) {
      const uncertain = key.startsWith("~");
      const op = opsByKey.get(uncertain ? key.slice(1) : key);
      const tag = dist === 0 ? "" : dist === 1 ? "  _(direct)_" : `  _(indirect — ${dist} hops)_`;
      L.push(`- \`${uncertain ? key.slice(1) : key}\`${op?.summary ? ` — ${op.summary}` : ""}${tag}${uncertain ? "  _(method inferred)_" : ""}`);
      L.push(`    ← ${[...files].map(f => `\`${f}\``).join(", ")}`);
    }
    L.push("");
  }

  if (withoutFiles.length) {
    L.push("---", "", "## Components with no code mapping", "");
    L.push("Cross-cutting concerns, or components whose `files:` are not yet declared in");
    L.push("`project.yaml`. They carry no API section by design.");
    L.push("");
    withoutFiles.forEach(c => L.push(`- \`${c.slug}\`${c.does ? ` — ${c.does}` : ""}`));
    L.push("");
  }

  if (byComp.unattributed.size) {
    L.push("---", "", "## Unattributed calls", "");
    L.push("Reached from this feature, but the calling file matches no component's `files:`.");
    L.push("Either add the glob, or accept it as shared data-layer code.");
    L.push("");
    for (const [key, files] of [...byComp.unattributed].sort()) {
      const op = opsByKey.get(key.replace(/^~/, ""));
      L.push(`- \`${key.replace(/^~/, "")}\`${op?.summary ? ` — ${op.summary}` : ""}`);
      L.push(`    ← ${[...files].slice(0, 3).map(f => `\`${f}\``).join(", ")}`);
    }
    L.push("");
  }

  const unused = selected.filter(o => !called.has(o.key) && !called.has("~" + o.key));
  if (unused.length) {
    L.push("---", "", "## Available but unused", "");
    L.push(`In this project's tag group, called by no code reached from the seeds — either a`);
    L.push("capability the UI has not adopted, or a selector that is too broad.");
    L.push("");
    L.push("| Method | Path | Summary |", "| --- | --- | --- |");
    unused.forEach(o => L.push(`| ${o.method} | \`${o.path}\` | ${(o.summary || "—").replace(/\|/g, "\\|")} |`));
    L.push("");
  }

  if (usage.undocumented.size) {
    L.push("---", "", "## Unmatched URL literals", "");
    L.push("**Candidates, not findings** — the scanner does not strip comments, and");
    L.push("react-query `queryKey` prefixes look like URLs. Open the file before believing one.");
    L.push("");
    for (const [lit, files] of usage.undocumented)
      L.push(`- \`${lit}\` ← ${[...files].slice(0, 2).map(f => `\`${f}\``).join(", ")}`);
    L.push("");
  }
  return L.join("\n");
}

function renderApiMd(p: Project, sel: Op[], doc: any, fetchedAt: string): string {
  const L: string[] = [];
  const cfg = p.api!;
  L.push(`# ${p.name} — API surface`, "");
  L.push("> GENERATED FILE — do not edit. Regenerate with `accio sync`.");
  L.push(`> Source: ${doc.info?.title} v${doc.info?.version} — ${SPEC_UI_URL}`);
  L.push(`> Spec fetched ${fetchedAt}. The backend is owned by another team; this file is derived,`);
  L.push("> never authoritative. Anything missing here is a backend ask, not a frontend todo.");
  L.push("");
  const by: string[] = [];
  if (cfg.tags?.length) by.push(`tags [${cfg.tags.join(", ")}]`);
  if (cfg.paths?.length) by.push(`paths [${cfg.paths.join(", ")}]`);
  L.push(`**Selected by:** ${by.join(" · ") || "nothing"} — **${sel.length} operation${sel.length === 1 ? "" : "s"}**`);
  L.push("");

  if (!sel.length) {
    L.push("## No endpoints");
    L.push("");
    L.push("Nothing in the published spec matches this project's selectors. Either the feature has");
    L.push("no backend yet, or the selectors in `project.yaml` are wrong — check both before");
    L.push("treating it as unbuilt.");
    L.push("");
    return L.join("\n");
  }

  L.push("## Index", "");
  L.push("| Method | Path | Summary |", "| --- | --- | --- |");
  for (const o of sel)
    L.push(`| ${o.method} | \`${o.path}\` | ${(o.summary || "—").replace(/\|/g, "\\|")}${o.deprecated ? " **(deprecated)**" : ""} |`);
  L.push("");

  const groups = new Map<string, Op[]>();
  for (const o of sel) {
    const t = o.tags[0] ?? "(untagged)";
    (groups.get(t) ?? groups.set(t, []).get(t)!).push(o);
  }

  for (const [tag, ops] of [...groups].sort()) {
    L.push(`---`, "", `## ${tag}`, "");
    for (const o of ops) {
      L.push(`### ${o.method} \`${o.path}\``);
      if (o.summary) L.push(o.summary + (o.deprecated ? "  **(deprecated)**" : ""));
      L.push("");
      const desc = o.description && o.description !== o.summary
        ? o.description.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 3).join(" ") : "";
      if (desc) L.push(desc, "");
      L.push(`- auth: ${o.auth.length ? o.auth.join(", ") : "_not declared in spec_"}`);
      for (const where of ["path", "query", "header"]) {
        const ps = o.params.filter(x => x.in === where);
        if (!ps.length) continue;
        L.push(`- ${where}: ${ps.map(x => `\`${x.name}\` ${x.type}${x.required ? " **req**" : ""}`).join(" · ")}`);
      }
      if (o.bodySchema) {
        L.push(`- body: \`${o.bodySchema}\``);
        for (const f of o.body)
          L.push(`    - \`${f.name}\` ${f.type}${f.required ? " **req**" : ""}${f.description ? ` — ${f.description}` : ""}`);
      }
      const ok = o.responses.filter(r => r.code.startsWith("2"));
      const err = o.responses.filter(r => !r.code.startsWith("2"));
      for (const r of ok) L.push(`- ${r.code} → \`${r.schema ?? "—"}\`${r.description ? ` — ${r.description}` : ""}`);
      if (err.length) L.push(`- errors: ${err.map(r => r.code).join(", ")}`);
      L.push("");
    }
  }
  return L.join("\n");
}

function renderReport(
  d: { added: Op[]; removed: string[]; changed: Op[] },
  hits: { p: Project; sel: Op[]; usage: Usage | null }[],
  doc: any, prevAt: string | null, fetchedAt: string,
): string {
  const L: string[] = [];
  L.push(`# API sync — ${fetchedAt}`, "");
  L.push(`Spec: ${doc.info?.title} v${doc.info?.version} · ${flatten(doc).length} operations`);
  L.push(prevAt ? `Previous sync: ${prevAt}` : "First sync — no baseline to diff against.");
  L.push("");

  const owner = (path: string) =>
    hits.filter(h => h.sel.some(o => o.path === path)).map(h => h.p.name).join(", ") || "_unclaimed_";

  if (!prevAt) {
    L.push("## Changes", "", "_baseline established; diffs start next sync_", "");
  } else if (!d.added.length && !d.removed.length && !d.changed.length) {
    L.push("## Changes", "", "None. The backend spec is unchanged since the last sync.", "");
  } else {
    L.push("## Changes", "");
    const section = (title: string, rows: string[]) => {
      if (!rows.length) return;
      L.push(`### ${title}`, "");
      rows.forEach(r => L.push(`- ${r}`));
      L.push("");
    };
    section("Added", d.added.map(o => `\`${o.key}\` — ${o.summary || "—"} → **${owner(o.path)}**`));
    section("Removed", d.removed.map(k => `\`${k}\` → **${owner(k.split(" ")[1])}**`));
    section("Changed", d.changed.map(o => `\`${o.key}\` — params/body/responses/auth differ → **${owner(o.path)}**`));
  }

  L.push("## Coverage", "", "| Project | Operations | |", "| --- | ---: | --- |");
  for (const { p, sel, usage } of hits) {
    const n = usage ? usage.ops.size : sel.length;
    L.push(`| ${p.name} | ${n} | ${n ? (usage ? "calls" : "") : "**no backend in spec**"} |`);
  }
  L.push("");
  const unconfigured = hits.filter(h => !h.p.api);
  if (unconfigured.length) {
    L.push("Projects with no `api:` block in project.yaml: " +
      unconfigured.map(h => `\`${h.p.name}\``).join(", "), "");
  }
  return L.join("\n");
}

/**
 * The routing table. A question names a UI element ("the status select"), not a project —
 * so one grep over the `does:` lines here has to be enough to pick the right api.md.
 */
function renderIndex(hits: { p: Project; usage: Usage | null }[], fetchedAt: string): string {
  const L: string[] = [];
  L.push("# Components — what lives where", "");
  L.push("> GENERATED FILE — do not edit. Regenerate with `accio sync`.");
  L.push(`> ${fetchedAt}`);
  L.push("");
  L.push("**Start here.** Grep this file for the thing you are looking for — a UI element, a");
  L.push("rule, a surface — then open that project's `api.md` at the named component.");
  L.push("");
  L.push("| Component | Project | Does | APIs |", "| --- | --- | --- | --- |");
  for (const { p, usage } of hits) {
    const where = relative(FEATURES, p.dir);
    for (const c of p.components) {
      const mapped = !!c.files?.length;
      const apis = !mapped ? "—" : usage ? `[\`${where}/api.md\`](./${where}/api.md)` : "_tags mode_";
      L.push(`| \`${c.slug}\` | ${p.name} | ${(c.does ?? "—").replace(/\|/g, "\\|")} | ${apis} |`);
    }
  }
  L.push("");
  const unmapped = hits.filter(h => h.p.components.some(c => !c.files?.length));
  if (unmapped.length) {
    L.push("Components showing `—` have no `files:` in their `project.yaml` — either");
    L.push("cross-cutting by design, or not yet mapped. See `API-DOCS-PLAN.md`.");
    L.push("");
  }
  return L.join("\n");
}

// ---------------------------------------------------------------- main

const { doc, fresh } = await loadSpec();
const ops = flatten(doc);
const fetchedAt = today();

const prevFp: Record<string, string> | null = await Bun.file(FINGERPRINT).exists()
  ? await Bun.file(FINGERPRINT).json() : null;
const prevMeta: any = await Bun.file(META).exists() ? await Bun.file(META).json() : null;

const currFp: Record<string, string> = {};
for (const o of ops) currFp[o.key] = fingerprintOf(o);

const diff = {
  added: prevFp ? ops.filter(o => !(o.key in prevFp)) : [],
  removed: prevFp ? Object.keys(prevFp).filter(k => !(k in currFp)) : [],
  changed: prevFp ? ops.filter(o => o.key in prevFp && prevFp[o.key] !== currFp[o.key]) : [],
};

const all = await projects();
const targets = ONLY ? all.filter(p => p.name === ONLY) : all;
if (ONLY && !targets.length) fail(`no project named "${ONLY}" — have: ${all.map(p => p.name).join(", ")}`);

const opsByKey = new Map(ops.map(o => [o.key, o]));
const idx = indexOps(doc);

/** calls mode needs `sources:` AND a repo on disk; anything else falls back to tags. */
type Hit = { p: Project; sel: Op[]; usage: Usage | null; byComp: ByComponent | null; note: string };
const symbols = new Map<string, Symbol & { projects: string[] }>();
const hits: Hit[] = [];
for (const p of targets) {
  const sel = p.api ? select(ops, p.api) : [];
  let usage: Usage | null = null, byComp: ByComponent | null = null, note = "tags";
  const srcs = p.api?.sources ?? [];
  if (srcs.length) {
    const repo = expand(p.api?.repo ?? DEFAULT_REPO);
    if (await Bun.file(join(repo, "package.json")).exists()) {
      usage = await collectUsage(repo, srcs, idx);
      byComp = attribute(usage, p.components);
      note = "calls";
      for (const [k, v] of await buildSymbols(repo, usage.graph)) {
        const e = symbols.get(k);
        if (!e) { symbols.set(k, { ...v, projects: [p.name] }); continue; }
        for (const f of v.files) if (!e.files.includes(f)) e.files.push(f);
        for (const o of v.ops) if (!e.ops.includes(o)) e.ops.push(o);
        for (const g of v.guards) if (!e.guards.includes(g)) e.guards.push(g);
        if (!e.projects.includes(p.name)) e.projects.push(p.name);
      }
    } else {
      note = `tags (repo not found: ${repo})`;
    }
  }
  hits.push({ p, sel, usage, byComp, note });
}

/**
 * Audit the curated data-flow prose against what the code actually calls. A hand-written
 * doc naming an endpoint nothing calls any more is the failure mode this whole split
 * exists to survive — so it is reported every run, not on request.
 */
const drift: Drift[] = [];
for (const { p, usage } of hits) {
  const flowFile = join(p.dir, "data-flow.md");
  if (!(await Bun.file(flowFile).exists())) continue;
  const entries = parseDataFlow(p.name, await Bun.file(flowFile).text());
  const called = new Set(usage ? [...usage.ops.keys()].map(k => k.replace(/^~/, "")) : []);
  if (!called.size) continue;   // tags mode has no call set to audit against
  drift.push(...checkDrift(entries, called));
}

console.log(`spec: ${ops.length} operations${fresh ? " (fetched)" : " (cached)"}`);
if (prevFp) console.log(`diff: +${diff.added.length} added · -${diff.removed.length} removed · ~${diff.changed.length} changed`);
for (const { p, sel, usage, note } of hits) {
  const n = usage ? usage.ops.size : sel.length;
  console.log(`  ${p.name.padEnd(22)} ${String(n).padStart(3)} ops  ${p.api ? note : "(no api: block)"}`);
}

if (CHECK) {
  console.log("\n--check: nothing written");
  process.exit(diff.added.length + diff.removed.length + diff.changed.length ? 1 : 0);
}

if (fresh) {
  await Bun.write(CACHE, JSON.stringify(doc));
  await Bun.write(FINGERPRINT, JSON.stringify(currFp, null, 0));
  await Bun.write(META, JSON.stringify({
    source: SPEC_UI_URL, title: doc.info?.title, version: doc.info?.version,
    fetchedAt, operations: ops.length, previousFetchedAt: prevMeta?.fetchedAt ?? null,
  }, null, 2));
}

for (const { p, sel, usage, byComp } of hits) {
  if (!p.api) continue;
  await Bun.write(join(p.dir, "api.md"), usage && byComp
    ? renderCallsMd(p, usage, byComp, opsByKey, sel, doc, fetchedAt)
    : renderApiMd(p, sel, doc, fetchedAt));
}
// A scoped run sees only one project — writing the report would clobber the full
// coverage table with a one-row version. Console output is the answer there.
if (!ONLY) {
  await Bun.write(REPORT, renderReport(diff, hits, doc, prevMeta?.fetchedAt ?? null, fetchedAt));
  await Bun.write(INDEX, renderIndex(hits, fetchedAt));
  await Bun.write(SYMBOLS, JSON.stringify({ fetchedAt, symbols: Object.fromEntries(symbols) }));
}

if (!ONLY) console.log(`symbols: ${symbols.size} indexed from code`);
if (drift.length) {
  console.log(`\n⚠ data-flow drift — prose names endpoints the code no longer calls:`);
  for (const d of drift) console.log(`   ${d.project}/${d.symbol}  ${d.kind}: ${d.endpoint}`);
} else if (hits.some(h => h.usage)) {
  console.log("data-flow: no drift");
}
console.log(`\nwrote ${hits.filter(h => h.p.api).length} api.md${ONLY ? " (scoped run — report not rewritten)" : ` · ${rel(REPORT)}`}`);
