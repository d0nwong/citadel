#!/usr/bin/env bun
/**
 * sync-skills — keep the global Claude skills folder in step with `skills/` in this repo.
 *
 * Every `skills/<name>/` that carries a SKILL.md gets a per-skill symlink in the global
 * folder (`~/.claude/skills`, followed through whatever it points at). Per-skill links,
 * never one link to the whole folder: the global folder also holds third-party skills
 * that live there directly, and a whole-folder link would shadow them.
 *
 * The script only ever touches links that point into this repo's `skills/`:
 *
 *   +  missing link                                → created
 *   =  link already correct                        → left alone
 *   -  our link, but its target is gone            → removed  (the dangling case)
 *   !  name taken by a real dir or a foreign link  → skipped and reported, never overwritten
 *
 *   bun run sync-skills            reconcile
 *   bun run sync-skills --check    report only; exit 1 if anything would change or conflicts
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CHECK = process.argv.includes("--check");

const REPO_SKILLS = path.resolve(import.meta.dir, "..", "skills");
const GLOBAL_ENTRY = path.join(os.homedir(), ".claude", "skills");

/** Follow `~/.claude/skills` through any symlink chain to the real directory. */
function resolveGlobalDir(): string {
  try {
    const real = fs.realpathSync(GLOBAL_ENTRY);
    if (!fs.statSync(real).isDirectory()) throw new Error("not a directory");
    return real;
  } catch (err) {
    console.error(`cannot resolve global skills folder at ${GLOBAL_ENTRY}: ${(err as Error).message}`);
    process.exit(2);
  }
}

/** Skills in this repo = directories under skills/ that contain a SKILL.md. */
function repoSkills(): string[] {
  return fs
    .readdirSync(REPO_SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(REPO_SKILLS, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

/** Where a symlink points, made absolute relative to the link's own directory. */
function linkTarget(linkPath: string): string {
  return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
}

function pointsIntoRepo(target: string): boolean {
  const rel = path.relative(REPO_SKILLS, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

type Outcome =
  | { kind: "create"; name: string }
  | { kind: "ok"; name: string }
  | { kind: "prune"; name: string }
  | { kind: "conflict"; name: string; why: string };

function reconcile(globalDir: string): Outcome[] {
  const outcomes: Outcome[] = [];
  const wanted = new Set(repoSkills());

  // Pass 1 — every repo skill should have a correct link.
  for (const name of wanted) {
    const link = path.join(globalDir, name);
    const source = path.join(REPO_SKILLS, name);

    let st: fs.Stats;
    try {
      st = fs.lstatSync(link);
    } catch {
      outcomes.push({ kind: "create", name });
      if (!CHECK) fs.symlinkSync(source, link);
      continue;
    }

    if (!st.isSymbolicLink()) {
      outcomes.push({ kind: "conflict", name, why: "a real file/directory with this name exists" });
      continue;
    }

    const target = linkTarget(link);
    if (target === source) {
      outcomes.push({ kind: "ok", name });
    } else if (pointsIntoRepo(target)) {
      // Our link, but aimed at the wrong place (renamed skill, moved repo). Repoint it.
      outcomes.push({ kind: "create", name });
      if (!CHECK) {
        fs.unlinkSync(link);
        fs.symlinkSync(source, link);
      }
    } else {
      outcomes.push({ kind: "conflict", name, why: `a link to somewhere else exists → ${target}` });
    }
  }

  // Pass 2 — links of ours whose target no longer exists (skill deleted from the repo).
  for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
    if (!entry.isSymbolicLink() || wanted.has(entry.name)) continue;
    const link = path.join(globalDir, entry.name);
    const target = linkTarget(link);
    if (!pointsIntoRepo(target)) continue; // not ours — leave it
    if (fs.existsSync(target)) continue; // ours and alive, but has no SKILL.md; not our call
    outcomes.push({ kind: "prune", name: entry.name });
    if (!CHECK) fs.unlinkSync(link);
  }

  return outcomes;
}

function report(globalDir: string, outcomes: Outcome[]): number {
  const mode = CHECK ? "check" : "sync";
  console.log(`${mode}: ${REPO_SKILLS} → ${globalDir}\n`);

  const ok = outcomes.filter((o) => o.kind === "ok");
  const changes = outcomes.filter((o) => o.kind === "create" || o.kind === "prune");
  const conflicts = outcomes.filter((o) => o.kind === "conflict");

  for (const o of outcomes) {
    if (o.kind === "create") console.log(`  + ${o.name}`);
    if (o.kind === "prune") console.log(`  - ${o.name} (dangling)`);
    if (o.kind === "conflict") console.log(`  ! ${o.name} (skipped: ${o.why})`);
  }
  if (ok.length) console.log(`  = ${ok.length} already in sync`);

  const verb = CHECK ? "would change" : "changed";
  console.log(`\n${changes.length} ${verb}, ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`);
  if (conflicts.length) console.log("conflicts need a human: nothing was overwritten");

  if (conflicts.length) return 1;
  if (CHECK && changes.length) return 1;
  return 0;
}

const globalDir = resolveGlobalDir();
process.exit(report(globalDir, reconcile(globalDir)));
