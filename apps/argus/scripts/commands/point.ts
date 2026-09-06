#!/usr/bin/env bun
/**
 * accio point — everything the blackboard holds about one Needs-you point, in one block.
 * accio ticket — the same block keyed by a Linear ticket (LIA-105).
 *
 * A fresh session has no orientation: the README's Layout table says where each record
 * lives, but finding a point's report line, its decision, the journal entries carrying
 * its ticket and the code it names took seven tool calls the first time Ask was asked.
 * This does that join once, deterministically, and prints markdown that reads the same in
 * a terminal, in Ask's answer, and pasted into a ticket.
 *
 *   accio point decide/lia-71-history-rollup    the record, its report lines, its decision,
 *                                               journal entries, rule ids, files + git log
 *   accio ticket LIA-71                         open points, journal entries, rule ids, then
 *                                               `body: mcp__linear__get_issue LIA-71`
 *
 * Read-only by construction: it reads `reports/points.json`, `reports/<day>.md`,
 * `decisions/`, every app's `features/**\/journal` and `features/**\/docs`, and asks the FE /
 * BE checkouts with `git ls-files` and `git log` — never `fetch`, never `checkout` (the FE
 * tree is shared and its branch changes without warning). No Linear call: argus holds no
 * Linear key, so the `body:` line names the tool the session calls next. Nothing under
 * `.state/` is read, so it works on a clone that has never run `accio sync`.
 */

import { join, relative } from "node:path";
import { readdir } from "node:fs/promises";
import { ROOT, DEFAULT_FE_REPO, DEFAULT_BE_REPO, expand } from "../lib/manifest.ts";
import { appRoots, loadAllJournals, type AppJournalEntry } from "../lib/journal.ts";
import { parseNeedsYou, slug, readDecisions, daysBetween, type Point, type PointsFile, type Decision } from "../../skills/sweep/scripts/points.ts";

// ---------------------------------------------------------------- inputs

export type Checkout = { side: "FE" | "BE"; name: string; path: string };
export type Opts = {
  /** workspace root — the argus checkout */
  root?: string;
  /** product checkouts, by side; default `DEFAULT_FE_REPO` / `DEFAULT_BE_REPO` */
  checkouts?: Checkout[];
};

const defaultCheckouts = (): Checkout[] => [
  { side: "FE", name: "alden-portal-fe", path: expand(DEFAULT_FE_REPO) },
  { side: "BE", name: "alden-connect-portal-be", path: expand(DEFAULT_BE_REPO) },
];

export const RULE_RE = /\b(?:BR|MM)-\d+[a-z]?\b/g;
/** a backticked token with a file extension, optionally `be:` / `fe:` prefixed and `:line` suffixed */
const PATH_TOKEN_RE = /^(?:(be|fe):)?((?:[\w.@-]+\/)*[\w.@-]+\.(?:tsx?|jsx?|mjs|cjs|md|json|prisma|css|scss|sql|ya?ml|sh|html))(?::(\d+))?$/i;

export const ruleIds = (text: string): string[] => [...new Set(text.match(RULE_RE) ?? [])];

export type PathToken = { raw: string; side?: "FE" | "BE"; rel: string; line?: number };
/** every backticked path-looking token, in order of first appearance */
export function pathTokens(text: string): PathToken[] {
  const out: PathToken[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1]!.trim();
    const p = raw.match(PATH_TOKEN_RE);
    if (!p || seen.has(raw)) continue;
    seen.add(raw);
    out.push({ raw, side: p[1] ? (p[1].toUpperCase() as "FE" | "BE") : undefined, rel: p[2]!, line: p[3] ? Number(p[3]) : undefined });
  }
  return out;
}

// ---------------------------------------------------------------- git (read-only)

function git(repo: string, args: string[]): string | null {
  const proc = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().trimEnd() : null;
}

export type Hit = { checkout: Checkout; path: string; log: string[] };
export type Resolved = { token: PathToken; hits: Hit[]; tried: Checkout[] };

/** `git ls-files '*<rel>'` in each checkout the token may live in, then `git log -3` per hit. */
export function resolveToken(token: PathToken, checkouts: Checkout[]): Resolved {
  const tried = checkouts.filter(c => !token.side || c.side === token.side);
  const hits: Hit[] = [];
  for (const checkout of tried) {
    const listed = git(checkout.path, ["ls-files", "--", `*${token.rel}`]);
    if (listed === null) continue;
    const paths = listed.split("\n").filter(p => p === token.rel || p.endsWith(`/${token.rel}`));
    for (const path of paths.slice(0, 5))
      hits.push({ checkout, path, log: (git(checkout.path, ["log", "--oneline", "-3", "--", path]) ?? "").split("\n").filter(Boolean) });
  }
  return { token, hits, tried };
}

/** branch @ short sha of a checkout as it sits on disk — reported so a reader knows it was not fetched */
export function checkoutState(c: Checkout): string {
  const branch = git(c.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return `${c.name} — no checkout at ${c.path}`;
  return `${c.name} (${c.path}, on ${branch} @ ${git(c.path, ["rev-parse", "--short", "HEAD"])}, not fetched)`;
}

// ---------------------------------------------------------------- rules

export type RuleHit = { rel: string; line: number; feature?: string; text: string };
export type RuleIndex = Map<string, RuleHit[]>;

/**
 * Every `| BR-n |` / `| MM-n |` table row in every app's `docs/{product,arch}.md`, by id.
 * Ids are numbered per feature, so one id usually has several definitions; `pickRules`
 * narrows to the features the asker is in.
 */
export async function loadRuleIndex(root: string): Promise<RuleIndex> {
  const out: RuleIndex = new Map();
  for (const { dir } of await appRoots(root)) {
    for await (const path of new Bun.Glob("**/docs/{product,arch}.md").scan({ cwd: dir, absolute: true })) {
      const text = await Bun.file(path).text();
      const feature = text.match(/^---\n[\s\S]*?^id:\s*(\S+)/m)?.[1];
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(/^\|\s*((?:BR|MM)-\d+[a-z]?)\s*\|\s*([^|]*)\|/);
        if (!m) continue;
        if (!out.has(m[1]!)) out.set(m[1]!, []);
        out.get(m[1]!)!.push({ rel: relative(root, path), line: i + 1, feature, text: m[2]!.trim() });
      }
    }
  }
  for (const hits of out.values()) hits.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

/**
 * Where `id` is defined. When any definition sits in one of the `prefer`red features,
 * only those count — a point about `admin-usage` means its own BR-9, not invoicing's.
 * With no feature to go on, every definition is listed so the reader can pick.
 */
export function pickRules(index: RuleIndex, id: string, prefer: string[] = []): RuleHit[] {
  const all = index.get(id) ?? [];
  const own = all.filter(h => h.feature && prefer.includes(h.feature));
  return own.length ? own : all;
}

// ---------------------------------------------------------------- report

export type ReportHit = { rel: string; line: number; headline: string; detail?: string };

/** the point's bullet in `reports/<date>.md`, else in the newest report still carrying it */
export async function reportLines(root: string, id: string, date?: string): Promise<ReportHit | null> {
  const dir = join(root, "reports");
  let names: string[];
  try { names = (await readdir(dir)).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse(); } catch { return null; }
  if (date) names = [`${date}.md`, ...names.filter(n => n !== `${date}.md`)];
  for (const name of names) {
    const file = Bun.file(join(dir, name));
    if (!(await file.exists())) continue;
    const md = await file.text();
    const item = parseNeedsYou(md).find(it => `${it.group}/${slug(it.subject)}` === id);
    if (item) return { rel: `reports/${name}`, line: item.line + 1, headline: md.split("\n")[item.line]!.replace(/^- /, "").trim(), detail: item.detail };
  }
  return null;
}

// ---------------------------------------------------------------- journal

export type JournalMatch = { entry: AppJournalEntry; why: string[] };

/**
 * Entries carrying the ticket, sharing a feature, or rewriting one of the rule ids — newest
 * first. Plus the open decisions (`status: decided`) in the features the ticket's entries
 * live in: a point that says "decision entry still `decided`" is about exactly such an
 * entry, and a decision from a huddle carries no ticket key the point could name.
 */
export function journalFor(entries: AppJournalEntry[], q: { ticket?: string; features?: string[]; rules?: string[] }): JournalMatch[] {
  const out: JournalMatch[] = [];
  const viaTicket = new Set(q.ticket ? entries.filter(e => e.tickets.includes(q.ticket!)).flatMap(e => e.features) : []);
  for (const f of q.features ?? []) viaTicket.delete(f);
  for (const entry of entries) {
    const why: string[] = [];
    if (q.ticket && entry.tickets.includes(q.ticket)) why.push(`ticket ${q.ticket}`);
    for (const f of q.features ?? []) if (entry.features.includes(f)) why.push(`feature ${f}`);
    for (const r of q.rules ?? []) if (entry.affects.includes(r)) why.push(`affects ${r}`);
    if (!why.length && entry.status === "decided")
      for (const f of viaTicket) if (entry.features.includes(f)) why.push(`open decision in ${f} (the feature ${q.ticket}'s entries live in)`);
    if (why.length) out.push({ entry, why });
  }
  return out;
}

const journalLine = ({ entry, why }: JournalMatch) =>
  `- ${entry.rel} — ${entry.status ?? "?"} — ${entry.summary ?? "(no summary)"}  ⟵ ${why.join(", ")}`;

// ---------------------------------------------------------------- render

async function loadPoints(root: string): Promise<PointsFile | null> {
  const f = Bun.file(join(root, "reports/points.json"));
  return (await f.exists()) ? ((await f.json()) as PointsFile) : null;
}

const decisionLine = (d: Decision, file?: string) =>
  `${d.action}${d.reason ? ` — "${d.reason}"` : ""}${d.at ? ` — ${d.at}` : ""}${d.job ? ` — job ${d.job.id} ${d.job.url}` : ""}${file ? ` (${file})` : ""}`;

function renderRules(rules: [id: string, hits: RuleHit[]][]): string[] {
  if (!rules.length) return ["(no BR-n / MM-n ids in the point)"];
  return rules.flatMap(([id, hits]) => {
    if (!hits.length) return [`- ${id} — not found in docs`];
    return hits.slice(0, 4).map((h, i) => `- ${i ? "  " : `${id} → `}${h.rel}:${h.line}${h.feature ? ` (${h.feature})` : ""} — ${h.text.length > 140 ? h.text.slice(0, 137) + "…" : h.text}`);
  });
}

function renderFiles(tokens: PathToken[], checkouts: Checkout[]): string[] {
  if (!tokens.length) return ["(no path-looking tokens in the point)"];
  const out: string[] = [];
  for (const token of tokens) {
    const r = resolveToken(token, checkouts);
    if (!r.hits.length) {
      out.push(`- \`${token.raw}\` — unresolved in ${r.tried.map(c => c.name).join(", ") || "any checkout"}`);
      continue;
    }
    for (const hit of r.hits) {
      out.push(`- \`${token.raw}\` → ${hit.checkout.name} ${hit.path}${token.line ? `:${token.line}` : ""}`);
      for (const l of hit.log) out.push(`    ${l}`);
      if (!hit.log.length) out.push("    (no history)");
    }
  }
  return out;
}

const next = (ticket?: string, checkouts: Checkout[] = []) => [
  ...(ticket ? [`- body: mcp__linear__get_issue ${ticket}`] : ["- no ticket on this point — `accio ticket LIA-nn` once one is filed"]),
  ...checkouts.filter(c => git(c.path, ["rev-parse", "HEAD"]) !== null).map(c =>
    `- read code as landed: git -C ${c.path} show ${c.side === "FE" ? "origin/staging" : "origin/dev"}:<path>`),
];

/** `accio point <group>/<slug>` → { text, ok }. Never writes. */
export async function pointView(id: string, opts: Opts = {}): Promise<{ text: string; ok: boolean }> {
  const root = opts.root ?? ROOT;
  const checkouts = opts.checkouts ?? defaultCheckouts();
  const file = await loadPoints(root);
  if (!file) return { ok: false, text: `no reports/points.json under ${root} — the sweep writes it (skills/sweep/scripts/points.ts)` };
  const point = file.points.find(p => p.id === id);
  if (!point) {
    const word = id.split("/").pop()?.split("-").find(w => w.length > 2) ?? "";
    const near = file.points.filter(p => word && p.id.includes(word)).slice(0, 5).map(p => p.id);
    return { ok: false, text: `no point \`${id}\` in reports/points.json (${file.points.length} points as of ${file.date}); ids are <group>/<slug>${near.length ? ` — near: ${near.join(", ")}` : ""}` };
  }

  const text = `${point.subject} ${point.ask} ${point.detail ?? ""}`;
  const rules = ruleIds(text);
  const tokens = pathTokens(text);
  const sideOf = point.repo?.endsWith("-fe") ? "FE" : point.repo?.endsWith("-be") ? "BE" : undefined;
  const scoped = sideOf ? checkouts.filter(c => c.side === sideOf) : checkouts;

  const [report, { decisions }, journal, ruleHits] = await Promise.all([
    reportLines(root, id, file.date),
    readDecisions(join(root, "decisions")),
    loadAllJournals(root),
    loadRuleIndex(root),
  ]);
  const decision = point.decision ?? decisions.get(id);
  const decisionFile = `decisions/${id}.json`;
  const matches = journalFor(journal, { ticket: point.ticket, features: point.features, rules });
  const age = daysBetween(point.firstSeen, file.date);

  const out = [
    `# ${id}`,
    "",
    `**${point.subject}** — ${point.ask}`,
    ...(point.detail ? [point.detail] : []),
    "",
    `- group ${point.group} · first seen ${point.firstSeen}${age > 0 ? ` (${age}d at ${file.date})` : ""} · ticket ${point.ticket ?? "—"} · repo ${point.repo ?? "— (both checkouts)"} · features ${point.features?.join(", ") ?? "—"}`,
    `- record: reports/points.json (tick ${file.tick}, date ${file.date})`,
    "",
    "## Report",
    ...(report
      ? [`${report.rel}:${report.line}`, `- ${report.headline}`, ...(report.detail ? [`  ${report.detail}`] : [])]
      : [`not in reports/${file.date}.md${decision ? " — decided points leave Needs you" : ""}, nor in any older report`]),
    "",
    "## Decision",
    decision
      ? decisionLine(decision, (await Bun.file(join(root, decisionFile)).exists()) ? decisionFile : undefined)
      : `none — no ${decisionFile} (still in Needs you)`,
    "",
    `## Journal — ${[point.ticket && `ticket ${point.ticket}`, point.features?.length && `features ${point.features.join(", ")}`, rules.length && `affects ${rules.join(", ")}`].filter(Boolean).join(" · ") || "nothing to key on (no ticket, features or rule ids)"}`,
    ...(matches.length ? matches.map(journalLine) : ["(no journal entry carries this point)"]),
    "",
    "## Rules",
    ...renderRules(rules.map(id => [id, pickRules(ruleHits, id, point.features)])),
    "",
    `## Files — ${scoped.map(checkoutState).join(" · ")}`,
    ...renderFiles(tokens, scoped),
    "",
    "## Next",
    ...next(point.ticket, scoped),
  ];
  return { ok: true, text: out.join("\n") };
}

/** `accio ticket LIA-nn` → { text, ok }. Never writes, never calls Linear. */
export async function ticketView(key: string, opts: Opts = {}): Promise<{ text: string; ok: boolean }> {
  const root = opts.root ?? ROOT;
  const checkouts = opts.checkouts ?? defaultCheckouts();
  const [file, journal, { decisions }] = await Promise.all([loadPoints(root), loadAllJournals(root), readDecisions(join(root, "decisions"))]);
  const points = (file?.points ?? []).filter(p => p.ticket === key);
  const entries = journal.filter(e => e.tickets.includes(key));
  const apps = (await appRoots(root)).length;
  if (!points.length && !entries.length)
    return { ok: false, text: `nothing on the blackboard carries ${key} — looked in ${file ? `reports/points.json (${file.points.length} points as of ${file.date})` : "reports/points.json (absent)"} and ${apps} app${apps === 1 ? "" : "s"}' features/**/journal (${journal.length} entries)` };

  const open = points.filter(p => !(p.decision ?? decisions.get(p.id)));
  const decided = points.filter(p => p.decision ?? decisions.get(p.id));
  // an id is scoped to the features of the entries that name it — BR-9 in a usage entry is usage's BR-9
  const rules = new Map<string, string[]>();
  for (const e of entries) for (const r of e.affects) rules.set(r, [...new Set([...(rules.get(r) ?? []), ...e.features])]);
  const index = await loadRuleIndex(root);
  const pointLine = (p: Point) => `- ${p.id} — **${p.subject}** — ${p.ask}${p.repo ? ` (${p.repo})` : ""}`;

  const out = [
    `# ${key}`,
    "",
    `## Points — ${file ? `reports/points.json as of ${file.date}` : "reports/points.json absent"}`,
    ...(open.length ? open.map(pointLine) : ["(no open point)"]),
    ...decided.map(p => `- decided: ${p.id} — ${decisionLine((p.decision ?? decisions.get(p.id))!)}`),
    "",
    `## Journal — ${entries.length} entr${entries.length === 1 ? "y" : "ies"} with ticket ${key}`,
    ...(entries.length ? entries.map(e => `- ${e.rel} — ${e.status ?? "?"} — ${e.summary ?? "(no summary)"}${e.pr ? ` (${e.pr}${e.merge ? ` @ ${e.merge}` : ""})` : ""}`) : ["(none)"]),
    "",
    `## Rules — from those entries' \`affects\``,
    ...renderRules([...rules].map(([id, prefer]) => [id, pickRules(index, id, prefer)])),
    "",
    "## Next",
    ...next(key, checkouts),
    ...open.map(p => `- accio point ${p.id}`),
  ];
  return { ok: true, text: out.join("\n") };
}

// ---------------------------------------------------------------- cli

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const ticketAt = argv.indexOf("--ticket");
  const key = ticketAt >= 0 ? argv[ticketAt + 1] : undefined;
  const id = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ticket");
  if (ticketAt >= 0 ? !key : !id) {
    console.error("usage: accio point <group>/<slug> | accio ticket LIA-nn");
    process.exit(1);
  }
  const { text, ok } = key ? await ticketView(key) : await pointView(id!);
  (ok ? console.log : console.error)(text);
  process.exit(ok ? 0 : 1);
}
