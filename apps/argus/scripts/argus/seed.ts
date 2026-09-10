/**
 * `argus seed <feature>...`: a ledger's first requirement rows, from the product doc's
 * Business Rules table. The Rule column becomes the text, stripped of markup; the Source
 * column becomes code pointers pinned to the shas the doc was verified at; status is
 * `assumed` with an assumption as evidence, because nobody has confirmed a seeded rule.
 * A row the validator would refuse (over the sentence ceiling, code in the sentence, a
 * "because") is not copied: it is listed for the user to rewrite by hand, so the ledger
 * never opens with a sentence a reader would stumble on.
 */

import { featureDirOf, loadManifest } from "./manifest.ts";
import { unlink } from "node:fs/promises";
import { featureDir, ledgerPath } from "./paths.ts";
import { emptyLedger, type Evidence, type Ledger, type Requirement } from "./schema.ts";
import { checkStyle } from "./validate.ts";
import { readLedger, writeLedger, type WriteResult } from "./write.ts";

export type SeedRow = { id: string; rule: string; source: string };
export type Skipped = { id: string; rule: string; why: string };

const strip = (s: string) =>
  s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").replace(/\s*\\\|\s*/g, " or ").trim();

/** the BR rows of a product doc: `| BR-n | rule | condition | outcome | source |` */
export function parseRules(markdown: string): SeedRow[] {
  const out: SeedRow[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\|\s*(BR-\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2]!.split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length < 4) continue;
    out.push({ id: m[1]!, rule: cells[0]!, source: cells[3]! });
  }
  return out;
}

/** the verified shas from the doc's front matter */
export function parseStamps(markdown: string): { fe: string | null; be: string | null } {
  const fe = markdown.match(/^last_verified:\s*\S+@([0-9a-f]+)/m)?.[1] ?? null;
  const be = markdown.match(/^last_verified_be:\s*\S+@([0-9a-f]+)/m)?.[1] ?? null;
  return { fe, be };
}

/** `\`be:src/x.ts\` (\`fn\`), \`src/y.tsx\`` → file pointers; functions and prose are dropped */
export function parseSources(source: string, shas: { fe: string | null; be: string | null }): Extract<Evidence, { kind: "file" }>[] {
  const out: Extract<Evidence, { kind: "file" }>[] = [];
  for (const m of source.matchAll(/`((?:be:)?[\w./@-]+\.(?:tsx?|jsx?|json|sql))`/g)) {
    const raw = m[1]!;
    const be = raw.startsWith("be:");
    const sha = be ? shas.be : shas.fe;
    if (!sha) continue;
    const path = be ? raw.slice(3) : raw;
    if (!out.some((e) => e.path === path && e.repo === (be ? "be" : "fe"))) out.push({ kind: "file", repo: be ? "be" : "fe", sha, path });
  }
  return out;
}

/** why a rule sentence cannot be seeded as it stands, or null */
export function refuse(text: string): string | null {
  if (/\bbecause\b/i.test(text)) return "explains the mechanism";
  // a route like /admin/usage is a business word; a file like src/x.ts or roles.ts is code
  if (/\w+\(\)/.test(text) || /\b[a-z]+[A-Z]\w+\b/.test(text) || /\bsrc\//.test(text) || /\w\.(tsx?|jsx?|json|sql|md)\b/.test(text)) return "names code";
  const problems = checkStyle(text.endsWith(".") ? text : `${text}.`, "rule");
  return problems[0]?.rule ?? null;
}

export function toRequirements(rows: SeedRow[], shas: { fe: string | null; be: string | null }): { requirements: Requirement[]; skipped: Skipped[] } {
  const requirements: Requirement[] = [];
  const skipped: Skipped[] = [];
  for (const r of rows) {
    const text = strip(r.rule).replace(/\s*[—-]\s*$/, "");
    const why = refuse(text);
    if (why) { skipped.push({ id: r.id, rule: text, why }); continue; }
    const code = parseSources(r.source, shas);
    requirements.push({
      id: "",
      text: /[.!?]$/.test(text) ? text : `${text}.`,
      status: "assumed",
      evidence: [{ kind: "assumption", note: `seeded from the product doc's ${r.id}` }],
      ...(code.length ? { code } : {}),
    });
  }
  return { requirements, skipped };
}

/** the doc's one-line summary: the manifest name, and the TL;DR's first sentence when it fits the ceiling */
export function summaryOf(markdown: string, name: string): string {
  const tldr = markdown.match(/\*\*TL;DR:\*\*\s*(.+)/)?.[1] ?? "";
  const first = strip(tldr).split(/(?<=[.!?])\s/)[0] ?? "";
  return first && !checkStyle(first, "s").length ? first : `${name}.`;
}

export type SeedResult = { feature: string; write: WriteResult | null; seeded: number; skipped: Skipped[]; note?: string };

export async function seedFeature(feature: string, opts: { dryRun?: boolean; now?: Date; force?: boolean } = {}): Promise<SeedResult> {
  const manifest = await loadManifest();
  const mf = manifest.features.find((f) => featureDirOf(f) === feature);
  const name = mf?.name ?? feature;
  let existing = await readLedger(feature);
  if (existing && existing.requirements.length) {
    if (!opts.force) return { feature, write: null, seeded: 0, skipped: [], note: "already has requirements; --force to reseed" };
    const onlySeed = !existing.asks.length && !existing.tickets.length && !existing.landings.length && !existing.proposals.length && existing.requirements.every((r) => r.status === "assumed");
    if (!onlySeed) return { feature, write: null, seeded: 0, skipped: [], note: "holds more than seeded rows; reseeding would lose them" };
    if (!opts.dryRun) await unlink(ledgerPath(feature));
    existing = null;
  }
  const doc = Bun.file(`${featureDir(feature)}/docs/product.md`);
  const markdown = (await doc.exists()) ? await doc.text() : "";
  const rows = parseRules(markdown);
  const { requirements, skipped } = toRequirements(rows, parseStamps(markdown));
  const base: Ledger = existing ?? emptyLedger(feature, "", (opts.now ?? new Date()).toISOString());
  const next: Ledger = { ...base, summary: base.summary || summaryOf(markdown, name), requirements };
  const write = await writeLedger(feature, next, { actor: "user", dryRun: opts.dryRun, now: opts.now });
  return { feature, write, seeded: requirements.length, skipped };
}
