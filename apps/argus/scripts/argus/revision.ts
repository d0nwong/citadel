/**
 * The revision (CTD-192): one confirmed piece of work — its intent, the revised spec of
 * every feature it touches, and the plan that cuts it into tickets — kept under
 * `revisions/<slug>` while a draft and `revisions/<KEY>` once filed on its parent ticket,
 * and under `revisions/archive/` once done or dropped. `revision.json` is the record and
 * this module is the only writer of it; the markdown beside it is the `scope` skill's.
 *
 * Nothing here deletes: a revision leaves `revisions/` only by moving, whole, into the
 * archive. The fold that lands a done revision is `blockers.ts`'s (reconcile); the
 * `archiveRevision` step it ends with is shared from here.
 */

import { mkdir, readdir, rename, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { splitKey } from "./linear.ts";
import { archivedRevisionDir, archiveDir, revisionDir, revisionsDir, splitFeatureKey } from "./paths.ts";
import { type Evidence, parseEvidence, SchemaError } from "./schema.ts";
import { type Problem, REVISION_STATUSES, type RevisionRecord, validateRevisionRecord, validateSpec, ValidationError } from "./validate.ts";

export type Revision = RevisionRecord;
export const REVISION_FILE = "revision.json";
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const day = (d: Date) => d.toISOString().slice(0, 10);
const exists = (p: string) => stat(p).then(() => true, () => false);

// ---------------------------------------------------------------- the record

type Obj = Record<string, unknown>;
const obj = (v: unknown, path: string): Obj => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new SchemaError(path, "expected an object");
  return v as Obj;
};
const str = (o: Obj, key: string, path: string): string => {
  const v = o[key];
  if (typeof v !== "string") throw new SchemaError(`${path}.${key}`, "expected a string");
  return v;
};
const strOrNull = (o: Obj, key: string, path: string): string | null => (o[key] === null || o[key] === undefined ? null : str(o, key, path));
const strs = (o: Obj, key: string, path: string): string[] => {
  const v = o[key];
  if (!Array.isArray(v)) throw new SchemaError(`${path}.${key}`, "expected an array");
  return v.map((x, i) => {
    if (typeof x !== "string") throw new SchemaError(`${path}.${key}[${i}]`, "expected a string");
    return x;
  });
};

/** the shape, naming the first path that breaks it; the rules beyond the shape are `validateRevisionRecord`'s */
export function parseRevision(v: unknown, path = "revision"): Revision {
  const o = obj(v, path);
  const status = str(o, "status", path);
  if (!(REVISION_STATUSES as readonly string[]).includes(status))
    throw new SchemaError(`${path}.status`, `expected one of ${REVISION_STATUSES.join(", ")}, got "${status}"`);
  const at = obj(o.at, `${path}.at`);
  const evidence: Evidence[] = (Array.isArray(o.evidence) ? o.evidence : []).map((e, i) => parseEvidence(e, `${path}.evidence[${i}]`));
  return {
    slug: str(o, "slug", path),
    ...(o.key !== undefined ? { key: str(o, "key", path) } : {}),
    title: str(o, "title", path),
    status: status as Revision["status"],
    features: strs(o, "features", path),
    tickets: strs(o, "tickets", path),
    at: { drafted: str(at, "drafted", `${path}.at`), filed: strOrNull(at, "filed", `${path}.at`), settled: strOrNull(at, "settled", `${path}.at`) },
    evidence,
  };
}

export const serializeRevision = (r: Revision) => `${JSON.stringify(r, null, 2)}\n`;

/** whether `<app>/<dir>` is a feature directory under an app of the checkout */
export const knownFeature = async (key: string) => (await splitFeatureKey(key)) !== null;

export type Found = { rev: Revision; dir: string; archived: boolean };

/** the revision named by its slug or key, in `revisions/` first and then the archive */
export async function readRevision(id: string): Promise<Found | null> {
  for (const [dir, archived] of [[revisionDir(id), false], [archivedRevisionDir(id), true]] as const) {
    const f = Bun.file(join(dir, REVISION_FILE));
    if (await f.exists()) return { rev: parseRevision(await f.json()), dir, archived };
  }
  return null;
}

/** every revision, the live ones first and then the archive, each sorted by directory name */
export async function listRevisions(): Promise<Found[]> {
  const names = async (p: string) =>
    (await readdir(p, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "archive")
      .map((d) => d.name)
      .sort();
  const out: Found[] = [];
  for (const [base, archived] of [[revisionsDir(), false], [archiveDir(), true]] as const)
    for (const name of await names(base)) {
      const f = Bun.file(join(base, name, REVISION_FILE));
      if (await f.exists()) out.push({ rev: parseRevision(await f.json()), dir: join(base, name), archived });
    }
  return out;
}

async function assertValid(rev: Revision, path: string): Promise<void> {
  const problems = await validateRevisionRecord(rev, path, knownFeature);
  if (problems.length) throw new ValidationError(problems);
}

async function writeRecord(dir: string, rev: Revision, dryRun: boolean): Promise<string> {
  const path = join(dir, REVISION_FILE);
  await assertValid(rev, path);
  if (!dryRun) {
    await mkdir(dir, { recursive: true });
    await Bun.write(path, serializeRevision(rev));
  }
  return path;
}

// ---------------------------------------------------------------- the verbs

export type RevisionOptions = { now?: Date; dryRun?: boolean };
export type RevisionResult = { wrote: boolean; path: string; revision: Revision; diff: string[] };

/** `argus revision new`: a draft under `revisions/<slug>`; the skill writes the markdown beside it */
export async function newRevision(slug: string, input: { title: string; features: string[] }, o: RevisionOptions = {}): Promise<RevisionResult> {
  const { now = new Date(), dryRun = false } = o;
  if (!SLUG.test(slug)) throw new Error(`"${slug}" is not a slug: lower-case letters, digits and dashes`);
  if (!input.title.trim()) throw new Error("a revision has a title");
  const found = await readRevision(slug);
  if (found) throw new Error(`${slug}: already a revision (${found.rev.status}${found.archived ? ", archived" : ""})`);
  const revision: Revision = {
    slug,
    title: input.title.trim(),
    status: "draft",
    features: [...new Set(input.features)],
    tickets: [],
    at: { drafted: day(now), filed: null, settled: null },
    evidence: [],
  };
  const path = await writeRecord(revisionDir(slug), revision, dryRun);
  return { wrote: !dryRun, path, revision, diff: [`+ ${slug} draft: ${revision.title}`] };
}

/** `argus revision file`: the draft is filed on its parent ticket; the directory takes the key's name */
export async function fileRevision(slug: string, key: string, tickets: string[], o: RevisionOptions & { url?: string } = {}): Promise<RevisionResult> {
  const { now = new Date(), dryRun = false } = o;
  const found = await readRevision(slug);
  if (!found) throw new Error(`${slug}: no revision`);
  if (found.archived || found.rev.status !== "draft") throw new Error(`${slug}: is ${found.rev.status}${found.archived ? " (archived)" : ""}, not a draft`);
  if (!splitKey(key)) throw new Error(`"${key}" is not a ticket key`);
  const list = [...new Set(tickets.map((t) => t.trim()).filter(Boolean))];
  if (!list.length) throw new Error("a filed revision names its tickets: --tickets K1,K2,…");
  for (const t of list) if (!splitKey(t)) throw new Error(`"${t}" is not a ticket key`);
  const target = revisionDir(key);
  if (target !== found.dir && (await exists(target))) throw new Error(`${key}: a revision already sits there`);
  const revision: Revision = {
    ...found.rev,
    key,
    status: "filed",
    tickets: list,
    at: { ...found.rev.at, filed: day(now) },
    evidence: [...found.rev.evidence, { kind: "ticket", key, ...(o.url ? { url: o.url } : {}) }],
  };
  await writeRecord(found.dir, revision, dryRun);
  if (!dryRun && target !== found.dir) await rename(found.dir, target);
  return { wrote: !dryRun, path: join(target, REVISION_FILE), revision, diff: [`${slug} draft → filed as ${key} (${list.length} ticket${list.length === 1 ? "" : "s"})`] };
}

/**
 * The one exit from `revisions/`: the record written, then the whole directory moved under
 * the archive, keeping its name. Refuses to land on an archived directory of the same name.
 * Reconcile's fold ends here too.
 */
export async function archiveRevision(dir: string, rev: Revision, dryRun = false): Promise<string> {
  const target = archivedRevisionDir(basename(dir));
  if (await exists(target)) throw new Error(`${relative(revisionsDir(), target)}: already in the archive`);
  await writeRecord(dir, rev, dryRun);
  if (!dryRun) {
    await mkdir(archiveDir(), { recursive: true });
    await rename(dir, target);
  }
  return join(target, REVISION_FILE);
}

/** `argus revision drop`: a draft or a filed revision the user abandons, archived whole with the reason */
export async function dropRevision(id: string, reason: string, o: RevisionOptions = {}): Promise<RevisionResult> {
  const { now = new Date(), dryRun = false } = o;
  if (!reason.trim()) throw new Error("say why: --reason \"<why>\"");
  const found = await readRevision(id);
  if (!found) throw new Error(`${id}: no revision`);
  if (found.archived) throw new Error(`${id}: already ${found.rev.status} and archived`);
  const was = found.rev.status;
  const revision: Revision = {
    ...found.rev,
    status: "dropped",
    at: { ...found.rev.at, settled: day(now) },
    evidence: [...found.rev.evidence, { kind: "user", reason: reason.trim(), at: now.toISOString() }],
  };
  const path = await archiveRevision(found.dir, revision, dryRun);
  return { wrote: !dryRun, path, revision, diff: [`${id} ${was} → dropped: ${reason.trim()}`] };
}

// ---------------------------------------------------------------- validate

/** every `specs/<app>/<dir>.md` under a revision, with the feature key each names by its path */
export async function specsIn(dir: string): Promise<{ path: string; feature: string }[]> {
  const base = join(dir, "specs");
  const out: { path: string; feature: string }[] = [];
  const walk = async (p: string) => {
    for (const d of await readdir(p, { withFileTypes: true }).catch(() => [])) {
      const full = join(p, d.name);
      if (d.isDirectory()) await walk(full);
      else if (d.name.endsWith(".md")) out.push({ path: full, feature: relative(base, full).replace(/\.md$/, "") });
    }
  };
  await walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** the record's shape and rules, its directory's name, and every spec under it */
export async function validateRevisionDir(dir: string): Promise<Problem[]> {
  const path = join(dir, REVISION_FILE);
  let rev: Revision;
  try {
    rev = parseRevision(await Bun.file(path).json(), path);
  } catch (e) {
    if (e instanceof SchemaError) return [{ path: e.path, rule: e.message.slice(e.path.length + 2) }];
    return [{ path, rule: `not JSON: ${(e as Error).message}` }];
  }
  const out = await validateRevisionRecord(rev, path, knownFeature);
  const expected = rev.status === "draft" ? rev.slug : (rev.key ?? rev.slug);
  if (basename(dir) !== expected) out.push({ path, rule: `directory is named ${basename(dir)}, the record says ${expected}` });
  for (const s of await specsIn(dir)) {
    out.push(...(await validateSpec(s.path, s.feature)));
    if (!rev.features.includes(s.feature)) out.push({ path: s.path, rule: `a spec for ${s.feature}, which the record does not name` });
  }
  return out;
}
