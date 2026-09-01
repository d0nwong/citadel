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
import { FEATURES_DIR, STATE, ROOT, DEFAULT_FE_REPO, expand } from "../lib/manifest.ts";
import { ATTR_DEPTH, type AccioIndex } from "../lib/index-store.ts";
import { readStamp } from "../lib/stamps.ts";

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

    // The two tiers describe one codebase. `accio sync` keeps the arch stamp on the product
    // stamp unless the feature changed since the product tier was read — so a disagreement
    // is a stale product doc, never a bookkeeping quirk (lib/stamps.ts).
    const product = await Bun.file(join(dir, f.dir, "docs/product.md")).text().catch(() => null);
    const ps = readStamp(product), as = readStamp(text);
    if (ps && as && ps.sha !== as.sha)
      problems.push(`${name}: tiers disagree — product.md verified at ${ps.rev}, arch.md at ${as.rev}; the feature changed since the product tier was read — run /feature-docs ${id}`);

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
 *
 * `pr:`/`merge:` are what make an entry retrievable: without them a reader has to guess
 * which landing an entry describes, which is how one PR ended up split across three
 * entries carrying three different tickets. An entry whose code has landed must therefore
 * name its landing — `pr: null` is allowed, but only said out loud.
 */
export async function auditJournal(index: AccioIndex, dir = FEATURES_DIR): Promise<string[]> {
  const problems: string[] = [];
  const ids = new Set(index.features.map(f => f.id));
  const STATUSES = new Set(["decided", "implemented", "documented", "superseded"]);
  const TICKET = /^([A-Z][A-Z0-9]{1,9}-\d+|https:\/\/trello\.com\/\S+)$/;
  const PR = /^((fe|be)#\d+|direct)$/;
  /** `x` or `[x, y]` → ["x","y"]; quotes and empties stripped */
  const list = (v: string | undefined) =>
    (v ?? "").replace(/^\[|\]$/g, "").split(",")
      .map(x => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

  // product docs move only on real re-verification (arch docs regen every sync)
  const verifiedAt = new Map<string, string>();
  const verifiedSha = new Map<string, string>();
  for (const f of index.features) {
    const t = await Bun.file(join(FEATURES_DIR, f.dir, "docs/product.md")).text().catch(() => null);
    const d = t?.match(/^last_verified_date:\s*(\S+)/m)?.[1];
    if (d) verifiedAt.set(f.id, d);
    const s = t?.match(/^last_verified:\s*(?:\S+?@)?([0-9a-f]{7,40})\s*$/m)?.[1];
    if (s) verifiedSha.set(f.id, s);
  }

  /**
   * Did the docs' last verification actually SEE this landing? Several landings share a
   * day, so `last_verified_date` alone reports every entry filed the same day the docs
   * were refreshed — including the ones that landed after it. When both shas are known,
   * ask git; `undefined` means it could not be decided and the date rule stands.
   */
  const feRepo = expand(DEFAULT_FE_REPO);
  const sawIt = (featureId: string, merges: string[]): boolean | undefined => {
    const at = verifiedSha.get(featureId);
    if (!at || !merges.length) return undefined;
    const answers = merges.map(m => {
      const p = Bun.spawnSync(["git", "-C", feRepo, "merge-base", "--is-ancestor", m, at],
        { stdout: "ignore", stderr: "ignore" });
      return p.exitCode === 0 ? true : p.exitCode === 1 ? false : undefined;  // 128 = unknown sha / no repo
    });
    return answers.some(a => a === undefined) ? undefined : answers.every(Boolean);
  };

  const idByDir = new Map(index.features.map(f => [f.dir, f.id]));

  type Entry = { name: string; date?: string; status?: string; tickets: string[]; prs: string[]; hold?: string };
  const entries: Entry[] = [];

  // entries may sit directly in journal/ or grouped under journal/YYYY-MM/ — the grouping
  // is presentation only, so both depths are one glob and the owner is whatever precedes /journal/
  for await (const path of new Bun.Glob("**/journal/**/*.md").scan({ cwd: dir, absolute: true })) {
    const name = relative(dir, path);
    const owner = idByDir.get(name.replace(/\/journal\/.*$/, ""));
    const text = await Bun.file(path).text();
    const field = (k: string) => text.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
    const date = field("date"), status = field("status")?.split(/\s/)[0];
    const ticket = field("ticket")?.replace(/\s+#.*$/, "");
    const prField = field("pr")?.replace(/\s+#.*$/, "");
    const feats = (text.match(/^features:\s*\[([^\]]*)\]/m)?.[1] ?? "")
      .split(",").map(x => x.trim()).filter(Boolean);

    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) problems.push(`${name}: missing or malformed date`);
    if (!status || !STATUSES.has(status)) problems.push(`${name}: status must be decided|implemented|documented|superseded`);
    if (!feats.length) problems.push(`${name}: features: [] is empty — entry routes nowhere`);
    for (const f of feats) if (!ids.has(f)) problems.push(`${name}: unknown feature id \`${f}\``);
    // the folder is where a human looks; `features:` is what routes the refresh. If the
    // folder's own feature is missing from the list, the entry is invisible to the very
    // feature it was filed under.
    if (!owner) problems.push(`${name}: journal folder matches no feature dir in the manifest`);
    else if (feats.length && !feats.includes(owner))
      problems.push(`${name}: filed under \`${owner}\` but features: [${feats.join(", ")}] does not name it`);
    if (ticket && ticket !== "null")
      for (const t of list(ticket))
        if (!TICKET.test(t)) problems.push(`${name}: ticket \`${t}\` is neither a KEY-123 nor a trello.com link`);

    // the landing this entry describes — what makes it retrievable
    if (prField && prField !== "null")
      for (const p of list(prField))
        if (!PR.test(p)) problems.push(`${name}: pr \`${p}\` is not fe#N, be#N or \`direct\``);
    if (status && STATUSES.has(status) && status !== "decided" && status !== "superseded" && prField === undefined)
      problems.push(`${name}: ${status} but names no \`pr:\` — say which landing carried it (fe#N / be#N / direct), or \`pr: null\``);
    if ((status === "decided" || status === "superseded") && prField && prField !== "null")
      problems.push(`${name}: status ${status} but pr \`${prField}\` — code that landed is \`implemented\`, not \`${status}\``);
    if (prField && prField !== "null" && !field("merge"))
      problems.push(`${name}: pr \`${prField}\` with no \`merge:\` sha — the diff has to be one command away`);

    // An entry can be deliberately parked open — the FE half shipped and the BE half
    // didn't, say. `hold:` says so out loud and silences the refresh nag below; without
    // it, an entry that will never close nags forever and trains everyone to ignore audit.
    const hold = text.match(/^hold:[ \t]*(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (hold !== undefined && !hold) problems.push(`${name}: \`hold:\` with no reason — say what it is waiting for`);
    if (hold && (status === "documented" || status === "superseded"))
      problems.push(`${name}: ${status}, but held for "${hold}" — a closed entry waits for nothing`);

    // implemented + the docs' verification already contained this landing ⇒ the refresh
    // ran over this change and nobody closed the entry
    if (status === "implemented" && date && !hold) {
      const merges = list(field("merge")).filter(s => /^[0-9a-f]{7,40}$/.test(s));
      for (const f of feats) {
        const v = verifiedAt.get(f);
        const seen = sawIt(f, merges) ?? (!!v && v >= date.slice(0, 10));
        if (v && seen)
          problems.push(`${name}: implemented, but ${f} docs were re-verified ${v} — refresh missed this entry or it should be documented`);
      }
    }

    entries.push({
      name, date, status, hold,
      tickets: ticket && ticket !== "null" ? list(ticket) : [],
      prs: prField && prField !== "null" ? list(prField) : [],
    });
  }

  // A `decided` entry is a promise that a landing will close the loop. When a later entry
  // carries the same ticket and a real landing, the loop closed and nobody linked back —
  // the landing entry must reference the decision, and the decision flips to `superseded`.
  // And a decision that just sits open is how work gets re-implemented: after two weeks
  // it either landed unnoticed, or it is parked and must say so with `hold:`.
  const DECIDED_MAX_AGE_DAYS = 14;
  const landedByTicket = new Map<string, Entry>();
  for (const e of entries)
    if ((e.status === "implemented" || e.status === "documented") && e.prs.length)
      for (const t of e.tickets) landedByTicket.set(t, e);
  for (const e of entries) {
    if (e.status !== "decided") continue;
    const hit = e.tickets.map(t => [t, landedByTicket.get(t)] as const).find(([, l]) => l);
    if (hit)
      problems.push(`${e.name}: decided, but ${hit[0]} landed as ${hit[1]!.prs.join(", ")} (${hit[1]!.name}) — mark this entry superseded and have the landing entry link back`);
    else if (!e.hold && e.date && /^\d{4}-\d{2}-\d{2}/.test(e.date)) {
      const age = Math.floor((Date.now() - Date.parse(e.date.slice(0, 10))) / 86_400_000);
      if (age > DECIDED_MAX_AGE_DAYS)
        problems.push(`${e.name}: decided ${age} days ago and still open — journal the landing if it shipped unnoticed, or park it with \`hold:\``);
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
