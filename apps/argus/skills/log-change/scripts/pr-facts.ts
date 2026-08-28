#!/usr/bin/env bun
/**
 * pr-facts — everything a journal entry needs about one landing on staging.
 *
 * A journal entry is keyed by the moment a change reached staging: a merged PR, or a
 * commit pushed straight there. This resolves that moment from whatever you have — a PR
 * number, a sha, or "what landed since Tuesday" — and prints the frontmatter for it.
 *
 *   pr-facts 363                 PR #363 (frontend)
 *   pr-facts 735 --be            PR #735 (backend, lands on origin/dev)
 *   pr-facts 6a1562a16           which landing carried this commit?
 *   pr-facts --since 2026-08-27  every landing since that date, and whether it is journaled
 *
 * Resolution runs against `origin/<ref>`, never a local branch — the FE tree is shared and
 * its local branches go stale without warning (git fetch runs first unless --no-fetch).
 */

import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const FEATURES_DIR = join(ROOT, "alden/alden-portal/features");

const REPOS = {
  fe: { path: join(homedir(), "git/alden-portal-fe"), slug: "aldenstudios/alden-portal-fe", ref: "origin/staging" },
  be: { path: join(homedir(), "git/alden-connect-portal-be"), slug: "aldenstudios/alden-connect-portal-be", ref: "origin/dev" },
} as const;
type RepoKind = keyof typeof REPOS;

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
/** bitbucket writes `Merged in <branch> (pull request #N)` as the merge subject */
const MERGE_RE = /^Merged in (\S+) \(pull request #(\d+)\)/;

type Repo = { kind: RepoKind; path: string; slug: string; ref: string };

async function git(repo: Repo, ...args: string[]): Promise<string> {
  const p = Bun.spawnSync(["git", "-C", repo.path, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString().trimEnd();
}

const lines = (s: string) => (s ? s.split("\n") : []);

/** first-parent chain of the integration branch, newest first — the list of landings */
const chainOf = (repo: Repo) => git(repo, "rev-list", "--first-parent", repo.ref).then(lines);

/**
 * The landing that carried `sha`: the OLDEST commit on the first-parent chain that
 * contains it. Containment is monotone along the chain, so binary search it — a linear
 * scan is ~200 merge-base calls and takes the better part of a minute.
 * A commit pushed straight to the branch is its own landing.
 */
async function landingOfSha(repo: Repo, sha: string, chain: string[]): Promise<string> {
  const contains = (c: string) =>
    Bun.spawnSync(["git", "-C", repo.path, "merge-base", "--is-ancestor", sha, c]).exitCode === 0;
  if (!contains(chain[0]!)) throw new Error(`${sha} is not on ${repo.ref} — not landed yet?`);
  let lo = 0, hi = chain.length - 1;          // chain[0] newest … chain[n-1] oldest
  while (lo < hi) {                            // find the last index that still contains it
    const mid = Math.ceil((lo + hi) / 2);
    if (contains(chain[mid]!)) lo = mid; else hi = mid - 1;
  }
  return chain[lo]!;
}

async function landingOfPr(repo: Repo, pr: number): Promise<string> {
  const log = await git(repo, "log", "--first-parent", "--format=%H\t%s", repo.ref);
  const hit = lines(log).find(l => l.split("\t")[1]?.includes(`(pull request #${pr})`));
  if (!hit) throw new Error(`no merge for PR #${pr} on ${repo.ref}`);
  return hit.split("\t")[0]!;
}

type Facts = {
  landing: string; short: string; date: string; isMerge: boolean;
  pr: number | null; branch: string | null; title: string; range: string;
  commits: { sha: string; subject: string }[]; files: string[]; tickets: string[];
};

async function factsOf(repo: Repo, landing: string): Promise<Facts> {
  const [sha, date, subject, parents] = (
    await git(repo, "log", "-1", "--format=%H%x09%ad%x09%s%x09%P", "--date=format-local:%Y-%m-%d %H:%M %z", landing)
  ).split("\t");
  const isMerge = (parents ?? "").trim().split(/\s+/).length > 1;
  const m = subject!.match(MERGE_RE);
  const short = sha!.slice(0, 9);
  const range = `${short}^1..${short}`;

  // a merge's own commits are what the second parent added; a direct push is one commit
  const commits = lines(
    isMerge
      ? await git(repo, "log", "--format=%h\t%s", "--no-merges", `${sha}^1..${sha}`)
      : await git(repo, "log", "-1", "--format=%h\t%s", sha)
  ).map(l => ({ sha: l.split("\t")[0]!, subject: l.split("\t").slice(1).join("\t") }));

  const files = lines(await git(repo, "diff", "--name-only", range));

  // tickets are stated, never guessed: branch name + every commit message in the range
  const body = await git(repo, "log", "--format=%s%n%b", `${range}`).catch(() => "");
  const tickets = [...new Set(
    [...`${m?.[1] ?? ""}\n${body}`.toUpperCase().matchAll(TICKET_RE)].map(x => x[1]!)
    // BR-7 / MM-6 are business-rule ids from the docs, not tickets; nor are the stray
    // caps-and-a-number strings that show up in test names and http talk
  )].filter(t => !/^(BR|MM|PR|CI|BE|FE|UI|API|HTTP|UTF|SHA|ISO|RGB)-/.test(t));

  const title = isMerge
    ? (await git(repo, "log", "-1", "--format=%b", sha)).split("\n").find(Boolean) ?? subject!
    : subject!;

  return {
    landing: sha!, short, date: date!, isMerge,
    pr: m ? Number(m[2]) : null, branch: m?.[1] ?? null, title: title.trim(),
    range, commits, files, tickets,
  };
}

/** changed files → feature ids, via the accio index (frontend only) */
async function featuresOf(files: string[]): Promise<{ mapped: [string, number][]; unmapped: string[] }> {
  const idx = await Bun.file(join(ROOT, ".state/accio-index.json")).json().catch(() => null);
  if (!idx) return { mapped: [], unmapped: files };
  const counts = new Map<string, number>();
  const unmapped: string[] = [];
  for (const f of files) {
    const hits = idx.features.filter((x: any) => f in x.files).map((x: any) => x.id);
    if (!hits.length) { unmapped.push(f); continue; }
    for (const id of hits) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { mapped: [...counts].sort((a, b) => b[1] - a[1]), unmapped };
}

/**
 * Which landings does the journal already name? Keyed by `fe#363` / `be#735` from `pr:`,
 * and by every sha in `merge:` — `direct` is deliberately NOT a key, since every direct
 * push would otherwise match every entry that has ever recorded one.
 */
async function journalled(): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const items = (v: string) => v.replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(Boolean);
  for await (const path of new Bun.Glob("**/journal/**/*.md").scan({ cwd: FEATURES_DIR, absolute: true })) {
    const text = await Bun.file(path).text();
    const keys = [
      ...items(text.match(/^pr:[ \t]*(.+)$/m)?.[1]?.replace(/\s+#.*$/, "") ?? "").filter(k => /^(fe|be)#\d+$/.test(k)),
      ...items(text.match(/^merge:[ \t]*(.+)$/m)?.[1]?.replace(/\s+#.*$/, "") ?? "")
        .filter(s => /^[0-9a-f]{7,40}$/.test(s)).map(s => s.slice(0, 9)),
    ];
    for (const k of keys) seen.set(k, [...(seen.get(k) ?? []), path.replace(`${FEATURES_DIR}/`, "")]);
  }
  return seen;
}

function render(repo: Repo, f: Facts, feats: { mapped: [string, number][]; unmapped: string[] }): string {
  const key = f.pr ? `${repo.kind}#${f.pr}` : "direct";
  const out: string[] = [];
  out.push(`${f.pr ? `PR ${key}` : `direct push (no PR)`} · landed ${f.date} · ${repo.ref} ${f.short}`);
  out.push(`  title    ${f.title}`);
  if (f.branch) out.push(`  branch   ${f.branch}`);
  if (f.pr) out.push(`  url      https://bitbucket.org/${repo.slug}/pull-requests/${f.pr}`);
  out.push(`  tickets  ${f.tickets.join(", ") || "none stated in the branch or commit messages"}`);
  out.push(`  range    ${f.range}   (${f.commits.length} commit(s), ${f.files.length} file(s))`);
  out.push("");
  if (feats.mapped.length) {
    out.push("features touched (accio index):");
    for (const [id, n] of feats.mapped) out.push(`  ${id.padEnd(22)} ${n} file(s)`);
    if (feats.unmapped.length) out.push(`  ${"<unmapped>".padEnd(22)} ${feats.unmapped.length} file(s)`);
    out.push("  (file counts are a hint — `features:` names what the change is ABOUT, not every dir it grazed)");
    out.push("");
  }
  out.push("commits:");
  for (const c of f.commits) out.push(`  ${c.sha} ${c.subject}`);
  out.push("");
  out.push("frontmatter:");
  out.push(`  date: ${f.date.slice(0, 10)}`);
  out.push(`  pr: ${key}`);
  if (f.pr) out.push(`  url: https://bitbucket.org/${repo.slug}/pull-requests/${f.pr}`);
  out.push(`  merge: ${f.short}`);
  out.push(`  ticket: ${f.tickets.length ? `[${f.tickets.join(", ")}]` : "null"}    # confirm against Linear — commit messages lie by omission`);
  out.push(`  features: [${feats.mapped.map(([id]) => id).join(", ")}]`);
  out.push("");
  out.push(`detail: git -C ${repo.path.replace(homedir(), "~")} diff ${f.range}` + (f.pr ? `  ·  bb pr-details show ${f.pr}` : ""));
  return out.join("\n");
}

async function since(repo: Repo, date: string) {
  // git's approxidate fills a missing time with NOW, so a bare `2026-08-28` means
  // "since this afternoon" and silently hides everything that landed this morning
  const from = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date} 00:00` : date;
  const log = await git(repo, "log", "--first-parent", `--since=${from}`, "--format=%H\t%ad\t%s", "--date=short", repo.ref);
  const seen = await journalled();
  console.log(`landings on ${repo.ref} since ${from}\n`);
  for (const l of lines(log)) {
    const [sha, d, subject] = l.split("\t");
    const pr = subject!.match(MERGE_RE)?.[2];
    const key = pr ? `${repo.kind}#${pr}` : "direct";
    const entries = [...new Set([...(pr ? seen.get(key) ?? [] : []), ...(seen.get(sha!.slice(0, 9)) ?? [])])];
    const mark = entries.length ? "journaled" : "NOT JOURNALED";
    console.log(`  ${d}  ${sha!.slice(0, 9)}  ${key.padEnd(8)}  ${mark.padEnd(13)}  ${subject!.slice(0, 72)}`);
    for (const e of entries) console.log(`${" ".repeat(50)}${e}`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const kind: RepoKind = argv.includes("--be") ? "be" : "fe";
  const repo: Repo = { kind, ...REPOS[kind] };
  const refFlag = argv.indexOf("--ref");
  if (refFlag >= 0) repo.ref = argv[refFlag + 1]!;
  const target = argv.find(a => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--ref" && argv[argv.indexOf(a) - 1] !== "--since");

  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    console.log(`pr-facts — facts about one landing on ${REPOS.fe.ref} / ${REPOS.be.ref}

  pr-facts <pr-number>          e.g. 363
  pr-facts <sha>                which landing carried this commit
  pr-facts --since <date>       landings since <date>, and whether the journal names them
  flags: --be (backend repo) · --ref <ref> · --no-fetch`);
    process.exit(argv.length ? 0 : 1);
  }

  if (!argv.includes("--no-fetch"))
    Bun.spawnSync(["git", "-C", repo.path, "fetch", "--quiet", "origin"], { stdout: "ignore", stderr: "ignore" });

  const sinceFlag = argv.indexOf("--since");
  if (sinceFlag >= 0) { await since(repo, argv[sinceFlag + 1]!); process.exit(0); }

  if (!target) { console.error("error: give a PR number or a sha"); process.exit(1); }
  const landing = /^\d{1,5}$/.test(target)
    ? await landingOfPr(repo, Number(target))
    : await landingOfSha(repo, target, await chainOf(repo));
  const facts = await factsOf(repo, landing);
  const feats = kind === "fe" ? await featuresOf(facts.files) : { mapped: [], unmapped: facts.files };
  console.log(render(repo, facts, feats));
}
