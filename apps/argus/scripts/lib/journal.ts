/**
 * Read change-journal entries (DOC-PROTOCOL Phase 5) from their frontmatter alone.
 *
 * Entries route by frontmatter — `features:` is the key every consumer greps — so this is
 * deliberately a flat parser over the fields the protocol names, not a YAML library.
 */

import { relative } from "node:path";
import { FEATURES_DIR } from "./manifest.ts";

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
  const field = (k: string) => fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"))?.[1]?.replace(/\s+#.*$/, "").trim();
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
