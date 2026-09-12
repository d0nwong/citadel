#!/usr/bin/env bun
/**
 * link — point this machine's global commands and skills at citadel. Cutover only.
 *
 * `just bootstrap` reports these and never touches them, because the running system uses them:
 * the sweep, every Claude session, and whatever `foundry` on PATH means today. This moves them,
 * one at a time, and prints how to put each one back.
 *
 *   just link --dry-run     what it would repoint
 *   just link               repoint, asking first; --yes answers for you
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const HOME = homedir();
const ARGUS = join(ROOT, "apps/argus");

export type Action =
  | { kind: "relink"; what: string; path: string; from: string; to: string }
  | { kind: "create"; what: string; path: string; to: string }
  | { kind: "keep"; what: string; path: string; note: string }
  | { kind: "conflict"; what: string; path: string; note: string };

/** What one link needs: nothing when it already points into citadel, a warning when something else owns the name. */
export function planLink(what: string, path: string, to: string, cur: { exists: boolean; link: string | null }): Action {
  if (!cur.exists) return { kind: "create", path, to, what };
  if (cur.link === null) return { kind: "conflict", note: "a real file or directory, not a link — left alone", path, what };
  if (resolve(cur.link) === to) return { kind: "keep", note: "already citadel's", path, what };
  return { from: cur.link, kind: "relink", path, to, what };
}

const state = (path: string) => {
  try {
    const st = lstatSync(path);
    return { exists: true, link: st.isSymbolicLink() ? readlinkSync(path) : null };
  } catch {
    return { exists: false, link: null };
  }
};
const tilde = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

/** The global skills directory, followed through the symlink `~/.claude/skills` usually is. */
function skillsDir(): string | null {
  const entry = join(HOME, ".claude/skills");
  try {
    return realpathSync(entry);
  } catch {
    return null;
  }
}

export function plan(): Action[] {
  const out: Action[] = [];
  out.push(planLink("argus and accio (bun's global link)", join(HOME, ".bun/install/global/node_modules/argus"), ARGUS, state(join(HOME, ".bun/install/global/node_modules/argus"))));
  const foundryPath = Bun.which("foundry") ?? join(HOME, ".local/bin/foundry");
  out.push(planLink("foundry", foundryPath, join(ROOT, "apps/foundry/bin/foundry"), state(foundryPath)));
  const dir = skillsDir();
  if (!dir) {
    out.push({ kind: "conflict", note: "~/.claude/skills does not exist — open `claude` once, then rerun", path: join(HOME, ".claude/skills"), what: "skills" });
    return out;
  }
  for (const name of readdirSync(join(ARGUS, "skills")).sort()) {
    if (!existsSync(join(ARGUS, "skills", name, "SKILL.md"))) continue;
    out.push(planLink(`skill ${name}`, join(dir, name), join(ARGUS, "skills", name), state(join(dir, name))));
  }
  return out;
}

function apply(a: Action): void {
  if (a.kind !== "relink" && a.kind !== "create") return;
  mkdirSync(join(a.path, ".."), { recursive: true });
  if (a.kind === "relink") unlinkSync(a.path);
  symlinkSync(a.to, a.path);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const yes = args.includes("--yes");
  const actions = plan();
  for (const a of actions) {
    if (a.kind === "relink") console.error(`  ${tilde(a.path)}\n      ${tilde(a.from)}  ->  ${tilde(a.to)}`);
    else if (a.kind === "create") console.error(`  ${tilde(a.path)}\n      (missing)  ->  ${tilde(a.to)}`);
    else console.error(`  ${tilde(a.path)}\n      ${a.note}`);
  }
  const changes = actions.filter((a) => a.kind === "relink" || a.kind === "create");
  if (!changes.length) {
    console.error("\nnothing to move: every command and skill already points at citadel");
    process.exit(0);
  }
  if (dry) {
    console.error(`\n${changes.length} link(s) would move. This is cutover: the sweep, Pensieve and every Claude session follow them.`);
    process.exit(0);
  }
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error("\nnot a terminal — rerun with --yes to move them");
      process.exit(1);
    }
    const answer = prompt(`\nmove ${changes.length} link(s) to citadel? [y/N]`);
    if (!/^y/i.test(answer ?? "")) {
      console.error("nothing moved");
      process.exit(1);
    }
  }
  const undo: string[] = [];
  for (const a of changes) {
    apply(a);
    undo.push(a.kind === "relink" ? `ln -sfn ${tilde(a.from)} ${tilde(a.path)}` : `rm ${tilde(a.path)}`);
  }
  console.error(`\nmoved ${changes.length}. To put them back:`);
  for (const u of undo) console.error(`  ${u}`);
}
