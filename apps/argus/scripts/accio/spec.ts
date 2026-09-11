/**
 * OpenAPI spec loading, flattening, fingerprinting, diffing.
 *
 * The backend is owned by another team and publishes no JSON endpoint: the spec is
 * embedded in swagger-ui-init.js as `"swaggerDoc": {...}` and extracted by balanced-brace
 * scan. Everything here is ported from the proven first accio — mechanical only.
 */

export const SPEC_UI_URL = "https://dev-alden-portal.uc.r.appspot.com/api-docs/";
export const SPEC_JS_URL = SPEC_UI_URL + "swagger-ui-init.js";

export const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export type Field = { name: string; type: string; required: boolean; description: string };
export type Op = {
  key: string; method: string; path: string; tags: string[];
  summary: string; description: string;
  params: { in: string; name: string; required: boolean; type: string; description: string }[];
  bodySchema: string | null; body: Field[];
  responses: { code: string; description: string; schema: string | null }[];
  auth: string[];
  deprecated: boolean;
};

/** The spec is embedded in swagger-ui-init.js as `"swaggerDoc": {...}` — no JSON endpoint. */
export function extractSwaggerDoc(js: string): any {
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

export function flatten(doc: any): Op[] {
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
export const fingerprintOf = (op: Op) =>
  Bun.hash(JSON.stringify([
    op.summary, op.deprecated, op.auth,
    op.params.map(p => [p.in, p.name, p.required, p.type]),
    op.bodySchema, op.body.map(f => [f.name, f.type, f.required]),
    op.responses.map(r => [r.code, r.schema]),
  ])).toString(16);

export type SpecDiff = { added: Op[]; removed: string[]; changed: Op[] };

export function diffSpec(ops: Op[], prevFp: Record<string, string> | null): SpecDiff {
  if (!prevFp) return { added: [], removed: [], changed: [] };
  const currKeys = new Set(ops.map(o => o.key));
  return {
    added: ops.filter(o => !(o.key in prevFp)),
    removed: Object.keys(prevFp).filter(k => !currKeys.has(k)),
    changed: ops.filter(o => o.key in prevFp && prevFp[o.key] !== fingerprintOf(o)),
  };
}

/** orval's name for an operation: method + PascalCase of each path segment. */
export const orvalName = (method: string, path: string) =>
  method.toLowerCase() + path.split("/").filter(Boolean)
    .map(s => s.replace(/[{}]/g, ""))
    .map(s => s.split("-").map(w => (w[0] ?? "").toUpperCase() + w.slice(1)).join(""))
    .join("");

/** `${taskId}` and `{taskId}` both collapse, so code URLs match spec paths. */
export const normPath = (u: string) =>
  u.replace(/\$\{[^}]*\}/g, "{p}").replace(/\{[^}]*\}/g, "{p}").replace(/\?.*$/, "").replace(/\/+$/, "");

export type OpIndex = {
  byName: Map<string, string>;              // orvalName -> "METHOD /path"
  byPath: Map<string, { methods: string[]; path: string }>; // normalised path -> spec path
  byKey: Map<string, Op>;
};

export function indexOps(doc: any, ops: Op[]): OpIndex {
  const byName = new Map<string, string>();
  const byPath = new Map<string, { methods: string[]; path: string }>();
  for (const [path, item] of Object.entries<any>(doc.paths ?? {})) {
    const methods = Object.keys(item).filter(m => (METHODS as readonly string[]).includes(m));
    if (!methods.length) continue;
    byPath.set(normPath(path), { methods, path });
    for (const m of methods) byName.set(orvalName(m, path), `${m.toUpperCase()} ${path}`);
  }
  return { byName, byPath, byKey: new Map(ops.map(o => [o.key, o])) };
}
