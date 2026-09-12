/**
 * Whole-repo frontend analysis — syntax-only TS AST, no type checking.
 *
 * One pass over src/ produces per-file facts; features are later carved out of this as
 * views (see index-store.ts). Replaces the first accio's regex scanner. What the AST buys:
 *
 *   - exact type-only import skipping (`import type` erases; regex needed a heuristic)
 *   - template-literal and const-bound URLs resolved properly
 *   - a JSX RENDER graph: imports point up, but data flows down as props — "who renders
 *     this file's component" is how a field is traced to the parent that fetched its data
 *   - UI-visible strings (JSX text, label/placeholder/title attrs): the words a user
 *     actually sees on screen, which is how questions are phrased
 *
 * Measured lessons from the first accio, kept verbatim:
 *   - never traverse src/http/generated/ (orval barrel: everything calls all 469 ops);
 *     generated symbols resolve BY NAME — orval naming is a pure function of method+path
 *   - match the generated hook (useGetApiV1…) as well as the base fn (+40% ops)
 *   - a URL literal with no knowable method becomes "~METHOD path" per spec method —
 *     marked uncertain, never guessed
 */

import ts from "typescript";
import { dirname, resolve as rp, relative, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { METHODS, normPath, type OpIndex } from "./spec.ts";

export type FileInfo = {
  /** repo-relative path */
  file: string;
  /** resolved local imports that survive compilation (type-only skipped) */
  imports: string[];
  /** files whose exported components this file RENDERS (JSX graph) */
  renders: string[];
  /** "METHOD /path" (certain) or "~METHOD /path" (method inferred from spec) */
  ops: string[];
  /** /api/v1 literals matching no spec path */
  unknownUrls: string[];
  exports: string[];
  /** form field names (react-hook-form vocabulary) */
  fields: string[];
  /** UI-visible strings: JSX text, label=/placeholder=/title= etc. */
  visible: string[];
  /** unambiguous condition snippets: react-query enabled:, readOnly/disabled */
  guards: string[];
  /** TanStack route path, when this is a src/routes file */
  routePath?: string;
};

export type Analysis = {
  files: Map<string, FileInfo>;
  /** route path -> route file (repo-relative) */
  routes: { path: string; file: string }[];
  fileCount: number;
};

const METHOD_SET = new Set<string>(METHODS);
const GENERATED = /\/src\/http\/generated\//;
const SKIP = /(\.d\.ts$|\.gen\.tsx?$|\.test\.tsx?$|\.spec\.tsx?$|\.stories\.tsx?$|\/test\/|\/__mocks__\/)/;

/** quick pre-filter before the byName lookup */
const ORVAL_ID = /^(?:use)?(?:[gG]et|[pP]ost|[pP]ut|[pP]atch|[dD]elete)ApiV1[A-Za-z0-9]*$/;

const RESERVED_FIELDS = new Set([
  "default", "props", "children", "className", "value", "onChange", "data", "index",
  "type", "name", "id", "key", "ref", "style", "error", "loading", "state",
]);
const FIELD_FNS = new Set(["watch", "getValues", "setValue", "register", "resetField", "clearErrors"]);
const VISIBLE_ATTRS = new Set(["label", "placeholder", "title", "aria-label", "alt", "tooltip", "heading", "description"]);
const VISIBLE_PROPS = new Set(["label", "title", "placeholder", "header", "heading", "tooltip"]);

const looksVisible = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.length <= 80 && /[a-zA-Z]{2}/.test(t) && !t.includes("/") && !/[{}<>]/.test(t);
};

const existsCache = new Map<string, boolean>();
const fileExists = (p: string) => {
  let v = existsCache.get(p);
  if (v === undefined) { v = existsSync(p); existsCache.set(p, v); }
  return v;
};

function resolveImport(spec: string, fromAbs: string, srcAbs: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = rp(srcAbs, spec.slice(2));
  else if (spec.startsWith(".")) base = rp(dirname(fromAbs), spec);
  else return null; // package import — not ours
  if (/\.(ts|tsx)$/.test(base) && fileExists(base)) return base;
  for (const c of [base + ".ts", base + ".tsx", base + "/index.ts", base + "/index.tsx"])
    if (fileExists(c)) return c;
  return null;
}

/** Reconstruct a template literal with every interpolation collapsed to {p}. */
function templateText(node: ts.TemplateExpression): string {
  let out = node.head.text;
  for (const span of node.templateSpans) out += "{p}" + span.literal.text;
  return out;
}

function analyzeFile(absPath: string, feRoot: string, srcAbs: string, idx: OpIndex): FileInfo {
  const text = readFileSync(absPath, "utf8");
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.ES2022, false,
    absPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const info: FileInfo = {
    file: relative(feRoot, absPath), imports: [], renders: [], ops: [],
    unknownUrls: [], exports: [], fields: [], visible: [], guards: [],
  };
  const ops = new Set<string>(), unknown = new Set<string>();
  const fields = new Set<string>(), visible = new Set<string>(), guards = new Set<string>();
  const exportsSet = new Set<string>(), importsSet = new Set<string>(), renders = new Set<string>();
  /** local binding name -> resolved file (for JSX tag resolution) */
  const bindingFile = new Map<string, string>();
  /** local const name -> /api/v1 url */
  const urlConsts = new Map<string, string>();
  /** urls already claimed by an api.<method>() call — leftovers become ~METHOD */
  const claimed = new Set<string>();

  const addField = (raw: string) => {
    const n = raw.split(".")[0];
    if (n && n.length >= 3 && !RESERVED_FIELDS.has(n)) fields.add(n);
  };
  const addUrl = (url: string, method: string | null) => {
    if (!url.startsWith("/api/")) return;
    const e = idx.byPath.get(normPath(url));
    if (!e) { unknown.add(url); return; }
    if (method) { ops.add(`${method.toUpperCase()} ${e.path}`); claimed.add(url); }
    else e.methods.forEach(m => ops.add(`~${m.toUpperCase()} ${e.path}`));
  };
  const urlOf = (arg: ts.Expression | undefined): string | null => {
    if (!arg) return null;
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    if (ts.isTemplateExpression(arg)) return templateText(arg);
    if (ts.isIdentifier(arg)) return urlConsts.get(arg.text) ?? null;
    return null;
  };

  // Pass 1 — imports, url consts, exports. Consts must be known before calls that use them.
  const pass1 = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const target = resolveImport(node.moduleSpecifier.text, absPath, srcAbs);
      if (target) {
        const relTarget = relative(feRoot, target);
        // Record bindings even for type-only imports — a type-only-imported component
        // can't be rendered anyway, so this only helps resolution, never attribution.
        if (clause?.name) bindingFile.set(clause.name.text, relTarget);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const el of clause.namedBindings.elements)
            if (!el.isTypeOnly) bindingFile.set(el.name.text, relTarget);
        const allType = clause?.isTypeOnly
          || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
              && clause.namedBindings.elements.length > 0
              && clause.namedBindings.elements.every(el => el.isTypeOnly)
              && !clause.name);
        if (!allType) importsSet.add(relTarget);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) {
        const target = resolveImport(node.moduleSpecifier.text, absPath, srcAbs);
        if (target) importsSet.add(relative(feRoot, target));
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const url = ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)
        ? node.initializer.text
        : ts.isTemplateExpression(node.initializer) ? templateText(node.initializer) : null;
      if (url?.startsWith("/api/")) urlConsts.set(node.name.text, url);
    }
    if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
        exportsSet.add(node.name.text);
      else if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations)
          if (ts.isIdentifier(d.name)) exportsSet.add(d.name.text);
    }
    ts.forEachChild(node, pass1);
  };
  pass1(sf);

  // Pass 2 — calls, orval symbols, JSX, vocabulary.
  const pass2 = (node: ts.Node) => {
    // orval symbols resolve by name; the hook capitalises the method after `use`
    if (ts.isIdentifier(node) && ORVAL_ID.test(node.text)) {
      const base = node.text.replace(/^use/, "");
      const hit = idx.byName.get(base.charAt(0).toLowerCase() + base.slice(1));
      if (hit) ops.add(hit);
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // api.get('/api/v1/…') / api.post(url) — the hand-written layer
      if (ts.isPropertyAccessExpression(callee) && METHOD_SET.has(callee.name.text)
          && ts.isIdentifier(callee.expression) && callee.expression.text === "api") {
        const url = urlOf(node.arguments[0]);
        if (url) addUrl(url, callee.name.text);
      }
      // react-hook-form vocabulary: watch("taskPriority"), form.setValue("x", …)
      const fnName = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (fnName && FIELD_FNS.has(fnName)) {
        const a = node.arguments[0];
        if (a && ts.isStringLiteral(a)) addField(a.text);
      }
      // TanStack route file: createFileRoute("/path")
      if (ts.isIdentifier(callee) && callee.text === "createFileRoute") {
        const a = node.arguments[0];
        if (a && ts.isStringLiteral(a)) info.routePath = a.text;
      }
      // createFileRoute may also appear curried: createFileRoute("/x")({...})
      if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression)
          && callee.expression.text === "createFileRoute") {
        const a = callee.arguments[0];
        if (a && ts.isStringLiteral(a)) info.routePath = a.text;
      }
    }

    // leftover /api/v1 literals — path known, method not; claimed set filters at the end
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith("/api/")) {
      pendingLiterals.push(node.text);
    } else if (ts.isTemplateExpression(node) && node.head.text.startsWith("/api/")) {
      pendingLiterals.push(templateText(node));
    }

    // JSX: render edges + visible vocabulary
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) {
        const target = bindingFile.get(tag.text);
        if (target && target !== info.file) renders.add(target);
      }
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.name) continue;
        const an = ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText(sf);
        if (attr.initializer && ts.isStringLiteral(attr.initializer)) {
          if (VISIBLE_ATTRS.has(an) && looksVisible(attr.initializer.text)) visible.add(attr.initializer.text.trim());
          if (an === "name" && /^[\w.]+$/.test(attr.initializer.text)) addField(attr.initializer.text);
        }
        if ((an === "readOnly" || an === "disabled") && attr.initializer
            && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const t = attr.initializer.expression.getText(sf);
          if (t.length <= 60) guards.add(`${an}={${t}}`);
        }
      }
    }
    if (ts.isJsxText(node) && looksVisible(node.text)) visible.add(node.text.trim().replace(/\s+/g, " "));

    // object-literal vocabulary: { label: "Priority" }, { name: "taskPriority" }, enabled: guards
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const pn = node.name.text;
      if (ts.isStringLiteral(node.initializer)) {
        if (VISIBLE_PROPS.has(pn) && looksVisible(node.initializer.text)) visible.add(node.initializer.text.trim());
        if (pn === "name" && /^[\w.]+$/.test(node.initializer.text)) addField(node.initializer.text);
      }
      if (pn === "enabled") {
        const t = node.initializer.getText(sf);
        if (t.length <= 60) guards.add(`enabled: ${t}`);
      }
    }

    ts.forEachChild(node, pass2);
  };
  /** literals possibly claimed later in the walk — resolved after the pass */
  const pendingLiterals: string[] = [];
  pass2(sf);
  for (const url of pendingLiterals) {
    if (claimed.has(url)) continue;
    addUrl(url, null);
  }

  // "~METHOD path" is redundant once the same op is known with certainty
  for (const k of [...ops]) if (k.startsWith("~") && ops.has(k.slice(1))) ops.delete(k);

  info.imports = [...importsSet];
  info.renders = [...renders];
  info.ops = [...ops];
  info.unknownUrls = [...unknown];
  info.exports = [...exportsSet].filter(x => x.length >= 4 && !RESERVED_FIELDS.has(x));
  info.fields = [...fields];
  info.visible = [...visible].slice(0, 40);
  info.guards = [...guards];
  return info;
}

export async function analyzeRepo(feRoot: string, idx: OpIndex): Promise<Analysis> {
  const srcAbs = join(feRoot, "src");
  const files = new Map<string, FileInfo>();
  const routes: { path: string; file: string }[] = [];

  const paths: string[] = [];
  for await (const f of new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: feRoot, absolute: true })) {
    if (GENERATED.test(f) || SKIP.test(f)) continue;
    paths.push(f);
  }
  for (const abs of paths.sort()) {
    const info = analyzeFile(abs, feRoot, srcAbs, idx);
    files.set(info.file, info);
    if (info.routePath) routes.push({ path: info.routePath, file: info.file });
  }
  return { files, routes, fileCount: files.size };
}
