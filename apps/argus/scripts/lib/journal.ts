/**
 * Read change-journal entries (DOC-PROTOCOL Phase 5) from their frontmatter alone.
 *
 * Entries route by frontmatter — `features:` is the key every consumer greps — so this is
 * deliberately a flat parser over the fields the protocol names, not a YAML library.
 */

import { join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import { FEATURES_DIR, ROOT } from "./manifest.ts";

export type JournalEntry = {
  /** path relative to the features dir, e.g. `admin/invoicing/journal/2026-09/…/x.md` */
  name: string;
  path: string;
  date?: string;
  status?: string;
  features: string[];
  tickets: string[];
  pr?: string;
  merge?: string;
  source?: string;
  summary?: string;
  hold?: string;
  /** documented rules / mismatch rows this change rewrites, e.g. `BR-22h`, `MM-16` */
  affects: string[];
};

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
/** `x` or `[x, y]` → ["x","y"]; `null` → [] */
export const listField = (v: string | undefined) =>
  !v || v.trim() === "null" ? []
    : v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);

export function parseJournalEntry(text: string, name: string, path: string): JournalEntry {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  // a quoted value keeps its `#`s (Slack channels live in `source:`); only an unquoted
  // value can carry a trailing ` # comment`
  const field = (k: string) => {
    const raw = fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"))?.[1]?.trim();
    if (raw === undefined) return undefined;
    const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"|^'([^']*)'/);
    if (quoted) return `"${quoted[1] ?? quoted[2] ?? ""}"`;
    return raw.replace(/\s+#.*$/, "").trim();
  };
  const nn = (v: string | undefined) => (v === undefined || v === "" || v === "null" ? undefined : unquote(v));
  return {
    name, path,
    date: field("date"),
    status: field("status")?.split(/\s/)[0],
    features: listField(field("features")),
    tickets: listField(field("ticket")),
    pr: nn(field("pr")),
    merge: nn(field("merge")),
    source: nn(field("source")),
    summary: nn(field("summary")),
    hold: nn(field("hold")),
    affects: listField(field("affects")),
  };
}

/** every entry under `dir` — journals sit at `<feature>/journal/**`, any depth */
export async function loadJournal(dir = FEATURES_DIR): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  for await (const path of new Bun.Glob("**/journal/**/*.md").scan({ cwd: dir, absolute: true })) {
    out.push(parseJournalEntry(await Bun.file(path).text(), relative(dir, path), path));
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- every app

/** Workspace directories that are never an app, so the scan does not descend into them. */
const NOT_APPS = new Set(["reports", "digests", "decisions", "arcs", "skills", "scripts", "canvas", "node_modules", "features", "dist", ".state", ".git", ".claude"]);

export type AppRoot = {
  /** relative to the workspace root — `foundry`, `pensieve`, `alden/alden-portal` */
  app: string;
  /** absolute path of that app's `features/` directory */
  dir: string;
};

/**
 * Every app under the workspace: a directory one or two levels down holding a `features/`
 * tree (`foundry` and `pensieve` are one deep, `alden/alden-portal` two). The same
 * discovery Pensieve's `src/server/workspace.ts` does, so both sides see one list.
 */
export async function appRoots(root = ROOT): Promise<AppRoot[]> {
  const out: AppRoot[] = [];
  const dirsIn = async (dir: string) => {
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter(d => d.isDirectory() && !d.name.startsWith(".") && !NOT_APPS.has(d.name))
        .map(d => d.name);
    } catch { return []; }
  };
  for (const a of await dirsIn(root)) {
    const one = join(root, a);
    if ((await dirsIn(join(one, "features"))).length)
      out.push({ app: a, dir: join(one, "features") });
    else
      for (const b of await dirsIn(one))
        if ((await dirsIn(join(one, b, "features"))).length) out.push({ app: `${a}/${b}`, dir: join(one, b, "features") });
  }
  return out.sort((x, y) => x.app.localeCompare(y.app));
}

export type AppJournalEntry = JournalEntry & {
  app: string;
  /** feature dir inside the app's `features/`, e.g. `admin/usage` */
  featureDir: string;
  /** path relative to the workspace root, e.g. `alden/alden-portal/features/admin/usage/journal/…` */
  rel: string;
};

/**
 * Every journal entry of every app, newest first. `<dir>/journal/**` under each app's
 * `features/`; a feature that is itself named `journal` (Pensieve has one) is a docs
 * folder, not a journal, so the `journal` segment must follow at least one feature segment.
 */
export async function loadAllJournals(root = ROOT): Promise<AppJournalEntry[]> {
  const out: AppJournalEntry[] = [];
  for (const { app, dir } of await appRoots(root)) {
    for await (const path of new Bun.Glob("**/journal/**/*.md").scan({ cwd: dir, absolute: true })) {
      const name = relative(dir, path);
      const i = name.indexOf("/journal/");
      if (i <= 0) continue;
      const entry = parseJournalEntry(await Bun.file(path).text(), name, path);
      out.push({ ...entry, app, featureDir: name.slice(0, i), rel: relative(root, path) });
    }
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.rel.localeCompare(b.rel));
}
