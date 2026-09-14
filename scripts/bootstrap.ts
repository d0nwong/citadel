#!/usr/bin/env bun
/**
 * bootstrap — take a Mac to a citadel the compose stack can run.
 *
 * It replaces the three apps' scripts/bootstrap.sh with one set of phases over one .env.
 * A phase runs alone or in order; `--check` reports and changes nothing; nothing is
 * installed without a yes (`--yes` answers for you, and a run without a terminal never
 * installs); a phase that is already done is a no-op. A secret is typed at a hidden prompt,
 * copied from another .env, or minted, and never printed.
 *
 * It never repoints what the running system uses: the argus, accio and foundry commands on
 * PATH and the global Claude skills are reported here and moved at cutover.
 *
 *   just bootstrap                     every phase
 *   just check                         report only
 *   just bootstrap env deps            some phases
 *   just bootstrap import <file>...    copy the keys .env lacks from other .env files
 *   just auth linear|slack|trello|claude|foundry-api|gateway|gh|bitbucket [--rotate]
 */

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
const HOME = homedir();
const ENV_FILE = process.env.CITADEL_ENV ?? join(ROOT, ".env");
const EXAMPLE = join(ROOT, ".env.example");
const ARGUS = join(ROOT, "apps/argus");
const FOUNDRY_BIN = join(ROOT, "apps/foundry/bin/foundry");

// ------------------------------------------------------------------ the .env file

/** The last value for each `KEY=value` line; comments and blank lines are skipped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/**
 * `text` with `key` set: its first line rewritten where it stands, so the comment above it
 * still explains it; later lines for it dropped; appended when the file never had it.
 */
export function setKey(text: string, key: string, value: string): string {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let seen = false;
  for (const line of lines) {
    if (!line.startsWith(`${key}=`)) out.push(line);
    else if (!seen) {
      out.push(`${key}=${value}`);
      seen = true;
    }
  }
  if (!seen) out.push(`${key}=${value}`);
  return `${out.join("\n")}\n`;
}

/** One key into `file`: atomic (a sibling temp file, then rename), mode 600. */
export function writeKey(file: string, key: string, value: string): void {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, setKey(text, key, value), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/** Every key .env.example names, the commented-out optional ones included. */
export function exampleKeys(text: string): Set<string> {
  return new Set([...text.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
}

const readEnv = () => (existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {});
const mint = () => randomBytes(24).toString("hex");
const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, HOME));
const tilde = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

// ------------------------------------------------------------------ output and prompts

const color = (code: string) => (s: string) => (process.stderr.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = color("2");
const bold = color("1");
const green = color("32");
const yellow = color("33");
const say = (s = "") => console.error(s);
const info = (s: string) => say(`${bold("==>")} ${s}`);
const ok = (s: string) => say(`${green(" ok ")} ${s}`);
const warn = (s: string) => say(`${yellow("warn")} ${s}`);

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const YES = args.includes("--yes");
let FAIL = false;
const miss = (s: string) => {
  warn(s);
  FAIL = true;
};

const interactive = () => Boolean(process.stdin.isTTY) && !CHECK;
function confirm(question: string): boolean {
  if (YES) return true;
  if (!interactive()) return false;
  const answer = prompt(`  ${question} [Y/n]`);
  return !answer || !/^n/i.test(answer);
}
/** A line typed without echo, from the terminal; "" when nothing was typed. */
function secret(label: string): string {
  const r = Bun.spawnSync(["bash", "-c", 'read -rsp "  $1: " v </dev/tty; echo >&2; printf %s "$v"', "_", label], {
    stdin: "inherit",
    stderr: "inherit",
  });
  return r.stdout.toString();
}
const have = (cmd: string) => Bun.which(cmd) !== null;
const run = (cmd: string[], cwd = ROOT) => Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
const sh = (script: string) =>
  Bun.spawnSync(["bash", "-c", script], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exitCode === 0;

/** Create .env from .env.example when it is missing (never in --check). */
function ensureEnvFile(): boolean {
  if (existsSync(ENV_FILE)) return true;
  if (CHECK) return false;
  writeFileSync(ENV_FILE, readFileSync(EXAMPLE, "utf8"), { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
  ok(`created ${tilde(ENV_FILE)} from .env.example ${dim("(mode 600)")}`);
  return true;
}

// ------------------------------------------------------------------ phases

type Tool = { name: string; why: string; install?: string; optional?: boolean };
const TOOLS: Tool[] = [
  { name: "git", why: "every repo here, and the product checkouts the sweep reads", install: "brew install git" },
  { name: "bun", why: "every script and app", install: "curl -fsSL https://bun.sh/install | bash" },
  { name: "just", why: "these commands", install: "brew install just" },
  {
    name: "claude",
    why: "the sweep, Ask, and `claude setup-token` for the forge credential",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  { name: "docker", why: "the compose stack and Foundry's forges (OrbStack)", install: "brew install --cask orbstack" },
  { name: "gh", why: "PRs on github.com and --github forges", install: "brew install gh", optional: true },
  { name: "bb", why: "PRs on bitbucket.org (apps/foundry/scripts/setup-bb.sh installs it)", optional: true },
  { name: "tailscale", why: "Pensieve and Foundry on your tailnet", install: "brew install --cask tailscale", optional: true },
];

function prereqs() {
  info("host tools");
  if (process.platform !== "darwin") warn("this targets macOS — install the tools below by hand");
  if (have("brew")) ok(`brew ${dim(`(${Bun.which("brew")})`)}`);
  else warn('Homebrew missing — most installs below use it: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
  for (const t of TOOLS) {
    if (have(t.name)) {
      ok(`${t.name} ${dim(`(${Bun.which(t.name)})`)}`);
      continue;
    }
    const line = `${t.name} missing — ${t.why}${t.install ? dim(` (${t.install})`) : ""}`;
    if (!t.install || !confirm(`${t.name} is missing (${t.why}). Install it with: ${t.install}?`)) {
      if (t.optional) warn(line);
      else miss(line);
      continue;
    }
    if (sh(t.install) && have(t.name)) ok(`${t.name} installed`);
    else miss(`${t.name}: the install did not put it on PATH — open a new terminal, or install it by hand`);
  }
  if (have("docker")) {
    const d = run(["docker", "info", "--format", "{{.OperatingSystem}}"]);
    if (d.exitCode === 0) ok(`docker daemon ${dim(`(${d.stdout.toString().trim()})`)}`);
    else miss("docker daemon unreachable — start OrbStack");
  }
}

function identity() {
  info("git identity (every forge commits as it)");
  const get = (k: string) => run(["git", "config", "--global", k]).stdout.toString().trim();
  for (const k of ["user.name", "user.email"]) {
    if (get(k) || !interactive()) continue;
    const v = prompt(`  git ${k}:`)?.trim();
    if (v) run(["git", "config", "--global", k, v]);
  }
  const [name, email] = [get("user.name"), get("user.email")];
  if (name && email) ok(`${name} <${email}>`);
  else miss("git user.name / user.email unset — forge commits would be authored dev@localhost");
}

function deps() {
  info("dependencies");
  const modules = join(ROOT, "node_modules");
  const lock = join(ROOT, "bun.lock");
  if (existsSync(modules) && statSync(lock).mtimeMs <= statSync(modules).mtimeMs) {
    ok("node_modules current with bun.lock");
    return;
  }
  if (CHECK) return miss("node_modules missing or older than bun.lock — just bootstrap deps");
  if (Bun.spawnSync(["bun", "install"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" }).exitCode !== 0) {
    return miss("bun install failed");
  }
  const now = new Date();
  utimesSync(modules, now, now); // bun leaves the dir alone when nothing changed; mark the install current
  ok("bun install");
}

export const PROMPTED = [
  ["SLACK_TOKEN", "slack", "argus's Slack intake and the gateway's Slack server", "the Slack user token, xoxp-…"],
  ["LINEAR_API_KEY", "linear", "the gateway's Linear server, Foundry's linear-link and Pensieve's File", "linear.app → Settings → Security & access → Personal API keys"],
  ["TRELLO_API_KEY", "trello", "Foundry's Trello ticket provider (packages/tickets)", "trello.com/app-key → the API key"],
  ["TRELLO_TOKEN", "trello", "Foundry's Trello ticket provider (packages/tickets)", "trello.com/app-key → a token minted from that key"],
] as const;
const MINTED = [
  ["MCP_GATEWAY_TOKEN", "what every Claude session and forge presents to the gateway"],
  ["FOUNDRY_API_TOKEN", "the bearer Pensieve sends to Foundry's job API"],
] as const;
const LATER = [
  ["BITBUCKET_USERNAME", "the account behind BITBUCKET_TOKEN; the sweep reads pipelines with the pair"],
  ["BITBUCKET_TOKEN", "the sweep container fetches the product repos with it"],
  ["GH_TOKEN", "the sweep container pushes the data repo with it"],
] as const;

function env() {
  info(`the .env ${dim(`(${tilde(ENV_FILE)})`)}`);
  if (!ensureEnvFile()) return miss(`${tilde(ENV_FILE)} missing — just bootstrap creates it from .env.example`);
  const mode = statSync(ENV_FILE).mode & 0o777;
  if (mode === 0o600) ok("mode 600");
  else if (CHECK) miss(`mode ${mode.toString(8)} — chmod 600 ${tilde(ENV_FILE)}`);
  else {
    chmodSync(ENV_FILE, 0o600);
    ok("set to mode 600");
  }
  const e = readEnv();
  for (const [k, auth, why, what] of PROMPTED) {
    if (e[k]) {
      ok(`${k} set`);
      continue;
    }
    if (interactive() && confirm(`${k} is empty (${why}). Enter it now (${what})?`)) {
      const v = secret(k);
      if (v) {
        writeKey(ENV_FILE, k, v);
        ok(`stored ${k}`);
        continue;
      }
    }
    miss(`${k} empty — ${why} ${dim(`(just auth ${auth})`)}`);
  }
  for (const [k, why] of MINTED) {
    if (e[k]) ok(`${k} set`);
    else if (CHECK) miss(`${k} empty — ${why} ${dim("(just bootstrap mints one)")}`);
    else {
      writeKey(ENV_FILE, k, mint());
      ok(`minted ${k} ${dim(`(${why}; to keep an old value, just bootstrap import <old .env> first)`)}`);
    }
  }
  const now = readEnv();
  if (now.CLAUDE_CODE_OAUTH_TOKEN) ok("Claude credential set (CLAUDE_CODE_OAUTH_TOKEN)");
  else if (now.ANTHROPIC_API_KEY) ok("Claude credential set (ANTHROPIC_API_KEY)");
  else miss(`no Claude credential — forges, and in the stack the sweep and Ask, need one ${dim("(just auth claude)")}`);
  for (const [k, why] of LATER) {
    if (now[k]) ok(`${k} set`);
    else warn(`${k} empty — ${why} ${dim("(needed once the sweep runs in the stack)")}`);
  }
}

function trust() {
  info("Claude trust for apps/argus (Ask's Slack and Linear tools need it on a host)");
  let accepted = false;
  try {
    accepted = JSON.parse(readFileSync(join(HOME, ".claude.json"), "utf8")).projects?.[ARGUS]?.hasTrustDialogAccepted === true;
  } catch {
    /* no ~/.claude.json: claude has never run here */
  }
  if (accepted) ok(`${tilde(ARGUS)} is trusted`);
  else warn(`${tilde(ARGUS)} is not a trusted folder yet — run \`claude\` there once and accept it; until then its .mcp.json headersHelper does not run`);
}

function data() {
  info("argus's data");
  const dir = expand(process.env.WORKSPACE_DIR || readEnv().WORKSPACE_DIR || join(HOME, "git/citadel-data"));
  if (!existsSync(join(dir, ".git"))) return miss(`${tilde(dir)} is not a git checkout — clone the data repo there, or set WORKSPACE_DIR`);
  const branch = run(["git", "-C", dir, "branch", "--show-current"]).stdout.toString().trim();
  ok(`${tilde(dir)} ${dim(`(on ${branch || "?"})`)}`);
  if (existsSync(join(dir, ".state/openapi.json"))) ok(".state/openapi.json present");
  else warn(`.state/openapi.json missing — ARGUS_ROOT=${tilde(dir)} bun run accio sync`);
  for (const pattern of ["*/.doc-workspace/feature-manifest.json", "*/*/.doc-workspace/feature-manifest.json"]) {
    for (const f of new Bun.Glob(pattern).scanSync({ cwd: dir, dot: true })) {
      const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const role of ["fe_repo", "be_repo"] as const) {
        if (!m[role]) continue;
        const p = expand(m[role]);
        const label = `${m.app ?? f} ${role.slice(0, 2).toUpperCase()}: ${tilde(p)}`;
        if (existsSync(join(p, ".git"))) ok(label);
        else miss(`${label} missing — clone it there (the sweep and accio read it)`);
      }
    }
  }
}

function home() {
  info("Ask's conversations");
  const dir = join(expand(process.env.PENSIEVE_HOME || readEnv().PENSIEVE_HOME || join(HOME, ".pensieve")), "conversations");
  if (existsSync(dir)) return ok(tilde(dir));
  if (CHECK) return miss(`${tilde(dir)} missing — just bootstrap creates it`);
  mkdirSync(dir, { recursive: true });
  ok(`created ${tilde(dir)}`);
}

function links() {
  info("commands and skills the running system uses (moved at cutover, never here)");
  const wanted = [
    ["argus", ARGUS],
    ["accio", ARGUS],
    ["foundry", join(ROOT, "apps/foundry")],
  ] as const;
  for (const [cmd, want] of wanted) {
    const p = Bun.which(cmd);
    if (!p) {
      warn(`${cmd} not on PATH — cutover links it`);
      continue;
    }
    let real = p;
    try {
      real = realpathSync(p);
    } catch {
      /* a dangling link reports as itself */
    }
    if (real.startsWith(want)) ok(`${cmd} → ${tilde(real)}`);
    else say(`     ${dim(`${cmd} → ${tilde(real)} (the old checkout; cutover repoints it)`)}`);
  }
  if (run(["bun", "scripts/sync-skills.ts", "--check"], ARGUS).exitCode === 0) ok("global skills link into apps/argus/skills");
  else say(`     ${dim("global skills are missing or link elsewhere (cutover links them from apps/argus/skills)")}`);
}

function forge() {
  info("Foundry's forge image");
  if (!have("docker")) return warn("docker missing — see host tools");
  if (run(["docker", "image", "inspect", "foundry/forge:latest"]).exitCode === 0) ok("foundry/forge:latest built");
  else warn("foundry/forge:latest not built — apps/foundry/bin/foundry build");
}

function importKeys(files: string[]) {
  info(`keys ${tilde(ENV_FILE)} lacks, from ${files.length ? files.map(tilde).join(", ") : "nowhere"}`);
  if (!files.length) return miss("just bootstrap import <file>... — name the .env files to copy from");
  if (!ensureEnvFile()) return miss(`${tilde(ENV_FILE)} missing — just bootstrap creates it`);
  const known = exampleKeys(readFileSync(EXAMPLE, "utf8"));
  const current = readEnv();
  const copied = new Set<string>();
  const skipped = new Set<string>();
  for (const f of files) {
    const p = expand(f);
    if (!existsSync(p)) {
      warn(`${tilde(p)} not found`);
      continue;
    }
    for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) {
      if (!v || current[k]) continue;
      if (!known.has(k)) {
        skipped.add(k);
        continue;
      }
      if (!CHECK) writeKey(ENV_FILE, k, v);
      current[k] = v;
      copied.add(k);
    }
  }
  if (copied.size) ok(`${CHECK ? "would copy" : "copied"} ${[...copied].join(", ")}`);
  else ok("nothing to copy — every key those files hold is already set here");
  if (skipped.size) say(`     ${dim(`not copied, not in .env.example: ${[...skipped].join(", ")}`)}`);
}

export const AUTH_USAGE = "just auth linear|slack|trello|claude|foundry-api|gateway|gh|bitbucket [--rotate]";

function auth(what: string | undefined, flags: string[]) {
  ensureEnvFile();
  const passthrough = (cmd: string[]) => {
    const r = Bun.spawnSync(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, CITADEL_ENV: ENV_FILE } });
    if (r.exitCode !== 0) FAIL = true;
  };
  switch (what) {
    case "linear":
    case "slack": {
      const k = what === "linear" ? "LINEAR_API_KEY" : "SLACK_TOKEN";
      if (!process.stdin.isTTY) return miss(`just auth ${what} needs a terminal to type the key into`);
      const v = secret(k);
      if (!v) return miss("nothing typed — nothing written");
      writeKey(ENV_FILE, k, v);
      ok(`stored ${k} in ${tilde(ENV_FILE)} ${dim("(restart the gateway to pick it up)")}`);
      return;
    }
    case "trello": {
      if (!process.stdin.isTTY) return miss("just auth trello needs a terminal to type the pair into");
      const key = secret("TRELLO_API_KEY");
      if (!key) return miss("nothing typed — nothing written");
      const tok = secret("TRELLO_TOKEN");
      if (!tok) return miss("nothing typed — nothing written");
      writeKey(ENV_FILE, "TRELLO_API_KEY", key);
      writeKey(ENV_FILE, "TRELLO_TOKEN", tok);
      ok(`stored the Trello pair in ${tilde(ENV_FILE)} ${dim("(read fresh on every use, no restart needed)")}`);
      return;
    }
    case "gh": {
      if (!process.stdin.isTTY) return miss("just auth gh needs a terminal to type the token into");
      const v = secret("GH_TOKEN");
      if (!v) return miss("nothing typed — nothing written");
      writeKey(ENV_FILE, "GH_TOKEN", v);
      ok(`stored GH_TOKEN in ${tilde(ENV_FILE)} ${dim("(the sweep pushes the data repo with it; a fine-grained token, contents: write on that repo alone)")}`);
      return;
    }
    case "bitbucket": {
      if (!process.stdin.isTTY) return miss("just auth bitbucket needs a terminal to type the token into");
      const user = prompt("  BITBUCKET_USERNAME (the account's email, for an Atlassian API token):")?.trim();
      if (!user) return miss("nothing typed — nothing written");
      const v = secret("BITBUCKET_TOKEN");
      if (!v) return miss("nothing typed — nothing written");
      writeKey(ENV_FILE, "BITBUCKET_USERNAME", user);
      writeKey(ENV_FILE, "BITBUCKET_TOKEN", v);
      ok(`stored the Bitbucket pair in ${tilde(ENV_FILE)} ${dim("(read-only is enough: read:repository:bitbucket, read:pipeline:bitbucket)")}`);
      return;
    }
    case "claude":
      return passthrough([FOUNDRY_BIN, "auth", "--claude"]);
    case "foundry-api":
      return passthrough([FOUNDRY_BIN, "auth", "--api", ...flags]);
    case "gateway":
      if (readEnv().MCP_GATEWAY_TOKEN && !flags.includes("--rotate")) {
        ok("MCP_GATEWAY_TOKEN already set — just auth gateway --rotate replaces it");
        return;
      }
      writeKey(ENV_FILE, "MCP_GATEWAY_TOKEN", mint());
      ok("minted MCP_GATEWAY_TOKEN — restart the gateway, and recreate forges to pick it up");
      return;
    default:
      miss(AUTH_USAGE);
  }
}

function summary() {
  say();
  if (FAIL) warn("something is missing — see above");
  else ok("this machine is ready");
  say(`     ${dim("just up          the stack")}`);
  say(`     ${dim("just migrate     Foundry's schema")}`);
  say(`     ${dim("just check       this report again, changing nothing")}`);
}

const PHASES = { prereqs, identity, deps, env, trust, data, home, links, forge } as const;

if (import.meta.main) {
  const words = args.filter((a) => !a.startsWith("--"));
  const flags = args.filter((a) => a.startsWith("--") && a !== "--check" && a !== "--yes");
  if (words[0] === "auth") auth(words[1], flags);
  else if (words[0] === "import") importKeys(words.slice(1));
  else {
    for (const w of words.length ? words : Object.keys(PHASES)) {
      const phase = PHASES[w as keyof typeof PHASES];
      if (phase) phase();
      else miss(`unknown phase ${w} — phases: ${Object.keys(PHASES).join(", ")}; also import, auth`);
    }
    summary();
  }
  process.exit(FAIL ? 1 : 0);
}
