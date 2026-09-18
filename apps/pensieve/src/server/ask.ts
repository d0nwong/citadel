/**
 * Node-only. The server half of Ask (LIA-102): the Claude Code adapter configured to
 * read the argus checkout and nothing more, a TanStack AI persistence adapter that keeps
 * one conversation per file under `PENSIEVE_HOME/conversations/`, and the run itself.
 *
 * `PENSIEVE_RUNNER` picks the run mode per request (CTD-219; see `runMode`). In container
 * mode — the image's own — the claude process runs with `permissionMode: 'default'` and a
 * read-only allowlist, so the checkout is never touched; the adapter's per-run runner files
 * land in the checkout for the run's duration and are removed in its `finally` — `git status`
 * is unchanged afterwards. In local mode — the host's default — the process runs with
 * `bypassPermissions` and the operator's own credentials, exactly as a terminal session would,
 * but never against the live checkouts: a conversation's first question cuts its own
 * `citadel` and `citadel-data` worktrees on branch `ask/<id>` under `PENSIEVE_HOME/worktrees/`
 * (CTD-221; see `worktrees.ts`), and every run in that conversation works there — the citadel
 * worktree's argus directory as its sandbox, the citadel-data worktree as `ARGUS_ROOT`. Before
 * each later question the citadel-data branch is rebased onto main, so a ledger the sweep
 * committed since the last question is what the run reads; a conflict is left for the run
 * itself to resolve first (`conflictPrompt`). Pensieve's own rule holds in both modes: in the
 * blackboard it writes `decisions/` and nothing else, and Ask writes only under
 * `PENSIEVE_HOME` (default `~/.pensieve`) — a local run's worktrees included.
 *
 * Two tools are bridged into the run: `propose_decision` (LIA-111, retargeted by LIA-162)
 * and `propose_ticket` (LIA-113). A bridged tool always executes when the model calls it,
 * so each only reads and answers a proposal; the write is the user's click on the card the
 * chat renders from its tool part — `decisions/` for a correction or a send, Linear's
 * `issueCreate` for a ticket.
 *
 * Auth is decided per request: `ANTHROPIC_API_KEY` in the environment means `'api-key'`
 * (the container); otherwise `'host'` — the machine's `claude login`. With neither,
 * `askStatus()` says so and `askStream()` answers a RUN_ERROR chunk instead of spawning.
 *
 * `finishConversation` (CTD-222) is local mode's other way of ending a turn at the data: it
 * commits everything in the conversation's citadel-data worktree, rebases it onto main —
 * resolving a conflict with one more Claude turn, reusing `askStream` — fast-forwards the live
 * checkout's main onto it, and then removes both worktrees and both local branches. A code
 * change still leaves only as the PR the user asked for.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  AnyTextAdapter,
  ChatMiddleware,
  DebugOption,
  Logger,
  ModelMessage,
  StreamChunk,
  UIMessage,
} from "@tanstack/ai";
import {
  chat,
  convertMessagesToModelMessages,
  defineChatMiddleware,
  EventType,
  modelMessagesToUIMessages,
} from "@tanstack/ai";
import type { ClaudeCodeTextConfig } from "@tanstack/ai-claude-code";
import { claudeCodeText, SESSION_ID_EVENT } from "@tanstack/ai-claude-code";
import type {
  AIPersistence,
  MessageStore,
  MetadataStore,
} from "@tanstack/ai-persistence";
import {
  defineAIPersistence,
  defineMessageStore,
  defineMetadataStore,
  withPersistence,
} from "@tanstack/ai-persistence";
import {
  defineSandbox,
  SandboxCapability,
  withSandbox,
} from "@tanstack/ai-sandbox";
import { localProcessSandbox } from "@tanstack/ai-sandbox-local-process";
import {
  ACCIO_WRITE_VERBS,
  BASE_TOOLS,
  bridgedToolRules,
  gitReadRules,
  HARNESS_WRITE_TOOLS,
  LINEAR_WRITE_TOOLS,
  SCOPE_LIFTED,
  SLACK_READ_TOOLS,
  SLACK_WRITE_TOOLS,
  scopeWriteRules,
  TRACKER_WRITE_RULES,
} from "../lib/ask-tools";

/** a feature is its directory under an app's features/, one level of nesting at most */
const isFeature = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(v);

import { proposeDecisionTool, proposeTicketTool } from "./ask-tools.server";
import { ARGUS_DIR, CITADEL_DIR, WORKSPACE_DIR } from "./workspace";
import type {
  EnsureWorktreesResult,
  WorktreeDiscardCounts,
  WorktreePaths,
} from "./worktrees";
import {
  branchOf,
  commitAll,
  discardCounts,
  ensureWorktrees,
  fastForwardMain,
  hasWorktrees,
  rebaseOntoMain,
  removeWorktrees,
  worktreePaths,
} from "./worktrees";

// ── configuration ──────────────────────────────────────────────────────────────

/** Ask's own state directory — the only place this feature writes. */
export const PENSIEVE_HOME = resolve(
  process.env.PENSIEVE_HOME || join(homedir(), ".pensieve")
);
export const CONVERSATIONS_DIR = join(PENSIEVE_HOME, "conversations");
/** A local-mode conversation's worktrees (CTD-221) — `worktrees/<threadId>/{citadel,citadel-data}`. */
export const WORKTREES_DIR = join(PENSIEVE_HOME, "worktrees");

/** The claude binary's own model alias; the CLI resolves it. */
export const MODEL = "opus";

/**
 * The product checkouts the `ask` skill reads at their landed refs (`git -C <repo> show
 * origin/<branch>:<path>`). Same defaults as argus's `scripts/lib/manifest.ts`; `FE_REPO` /
 * `BE_REPO` override them where the paths differ (the container).
 */
export const CHECKOUTS = [
  process.env.FE_REPO?.trim() || "~/git/alden-portal-fe",
  process.env.BE_REPO?.trim() || "~/git/alden-connect-portal-be",
];

const expandHome = (p: string) =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

/**
 * The allowlist for a set of checkouts. A `Bash(...)` rule is a literal command prefix, so
 * each checkout gets its rules in both spellings the session will type: `~/git/…` as the
 * skill writes it, and the absolute path as `argus show` prints it. The bridged tool joins
 * them under its `mcp__tanstack__` name — without that rule the session's call is denied.
 */
export function allowedToolsFor(checkouts: readonly string[]): string[] {
  const rules = new Set<string>([
    ...BASE_TOOLS,
    ...SLACK_READ_TOOLS,
    ...bridgedToolRules(),
  ]);
  for (const c of checkouts) {
    for (const p of new Set([c, expandHome(c)])) {
      for (const r of gitReadRules(p)) {
        rules.add(r);
      }
    }
  }
  return [...rules];
}

/** Files, search, git history, the accio and argus read verbs, the `ask` skill, ticket reads (both providers, through `argus tracker`) and the bridged tools. Nothing that writes. */
export const ALLOWED_TOOLS = allowedToolsFor([...CHECKOUTS, WORKSPACE_DIR]);

export type RunMode = "container" | "local";

/**
 * Container keeps today's read-only sandbox exactly; local runs each session as the host's
 * own Claude Code, with no allowlist and the operator's settings (CTD-219). Decided per
 * request from the environment, never cached, the same as `authMode`: the image sets
 * `PENSIEVE_RUNNER=container`; anything else, unset included, is local (hosting S-7 — a host
 * run is local unless told otherwise).
 */
export const runMode = (env: NodeJS.ProcessEnv = process.env): RunMode =>
  env.PENSIEVE_RUNNER?.trim() === "container" ? "container" : "local";

/** Belt and braces under `default`: these never even reach the permission check. */
export const DISALLOWED_TOOLS = [
  ...HARNESS_WRITE_TOOLS,
  ...ACCIO_WRITE_VERBS,
  ...TRACKER_WRITE_RULES,
  ...LINEAR_WRITE_TOOLS,
  ...SLACK_WRITE_TOOLS,
];

/**
 * The adapter configuration (`docs/adapters/claude-code.md`). `cwd` is the sandbox's
 * virtual root, which the local-process provider maps onto argus's code (ARGUS_DIR). The
 * data it reads, WORKSPACE_DIR, is an extra directory (`--add-dir`), and the verbs find it
 * through ARGUS_ROOT.
 * `settingSources` stays at `['project']`: it is what loads argus's `.mcp.json` (the Linear
 * and Slack servers, both behind the local MCP gateway) and argus symlinks its skills into its own `.claude/skills` — the host's
 * `~/.claude` stays out of the run.
 */
export const ADAPTER_CONFIG = {
  addDirs: [WORKSPACE_DIR],
  allowedTools: ALLOWED_TOOLS,
  cwd: "/workspace",
  disallowedTools: DISALLOWED_TOOLS,
  emitDiff: false,
  env: { ARGUS_ROOT: WORKSPACE_DIR },
  // One turn per model round-trip, so every tool call is one: a question about a feature
  // that reads its page, a journal entry and a doc or two is 15–25. When the cap is hit the CLI
  // still prints its result (finish reason `length`) and then exits 1 — see `askStream`.
  maxTurns: 40,
  permissionMode: "default",
  settingSources: ["project"],
} satisfies ClaudeCodeTextConfig;

/**
 * Local mode (CTD-219): the host's own Claude Code, with no allowlist — `bypassPermissions`
 * needs no rule per command (AC6). `allowedTools`/`disallowedTools` are explicitly `undefined`
 * so spreading this over `ADAPTER_CONFIG` in `askAdapter` clears the container's lists rather
 * than leaving them in place. `cwd` stays `/workspace`: the sandbox (below) is pinned to
 * `ARGUS_DIR` regardless of mode, so `/workspace` already resolves to argus's own directory in
 * the live checkout — the same directory a literal path would name.
 *
 * CTD-248: `settingSources` stays at `ADAPTER_CONFIG`'s `['project']` rather than adding
 * `'user'` and `'local'` — the host's `~/.claude` stays out in local mode too (S-3), so the
 * skills a conversation can invoke are argus's own and Claude Code's built-ins, not the
 * operator's personal skills and installed plugins (S-56), and the only MCP servers are argus's
 * gateway ones from `apps/argus/.claude/settings.json`'s `enabledMcpjsonServers` (S-50); with no
 * `'user'` source to prefer, there is nothing left to disable it in favour of. `maxTurns` is
 * `undefined` so no `--max-turns` reaches the CLI at all (`adapters/text.js`'s `buildArgv` only
 * pushes the flag when it is set): a local run, including `/scope`, has no turn cap (S-51).
 */
export const LOCAL_ADAPTER_CONFIG = {
  ...ADAPTER_CONFIG,
  allowedTools: undefined,
  disallowedTools: undefined,
  maxTurns: undefined,
  permissionMode: "bypassPermissions",
} satisfies ClaudeCodeTextConfig;

// Once per process, so the value the running server uses is on record (a dev server keeps
// an old module loaded across edits; the 08:48 run on 2026-09-06 ran with 12 while the
// source said 40). `runner` is the default this process falls back to; a request's own
// `PENSIEVE_RUNNER` can still differ (tests, mainly).
console.log(
  `[ask] claude-code · model ${MODEL} · runner ${runMode()} · maxTurns ${ADAPTER_CONFIG.maxTurns} · permissionMode ${ADAPTER_CONFIG.permissionMode} · ${ALLOWED_TOOLS.length} allowed · ${DISALLOWED_TOOLS.length} disallowed · checkouts ${CHECKOUTS.join(", ")}`
);

/**
 * Appended to Claude Code's own prompt (`--append-system-prompt`, the adapter's default
 * mode), so the harness's tool behaviour stays and only the environment facts are added.
 * The file map and the retrieval recipes live in argus (`CLAUDE.md`, the `ask` skill),
 * which the run loads with `--setting-sources project`; they are not repeated here.
 */
export const ASK_SYSTEM_PROMPT = `You are Argus, a panel inside Pensieve — a web app that reads the argus ledgers. Your working directory is argus's code (its skills, CLAUDE.md and scripts); its data (the ledgers, the arch docs and state/) is in ${WORKSPACE_DIR}, which the argus and accio verbs read on their own. This is not a terminal: there is no permission dialog and no one to answer one, so never tell the user to grant, allow or approve anything — a denied tool is an answer, and you work around it once.

To answer, load the \`ask\` skill (skills/ask/SKILL.md) and follow it. A feature's record is \`argus show <feature>\` (its ledger.json: the story, the requirements with their status, the asks with their history, the tickets, the landings); what nobody could place is ${WORKSPACE_DIR}/state/unplaced.json; the record's own history is \`git -C ${WORKSPACE_DIR} log\`; where a screen or field lives in the code is \`accio find "<words>"\`; a ticket is \`argus tracker show <KEY>\`; a Slack permalink is \`mcp__slack__slack_read_thread\` (the channel id and ts from the link). Code from a product checkout is \`git -C <repo> show origin/<branch>:<path>\` at the sha the ledger names; never run git fetch, pull, checkout or stash.

Cite every path and command you used. "The files don't say" beats a guess. Keep the answer short: it is read in a chat panel.

You cannot write files, edit tickets or comments, or run the sweep; the argus verbs that write are denied. To change the record — close an ask, confirm or contradict a requirement, place an unplaced message — call \`propose_decision\` once as the ask skill's Correcting section says; the user confirms it on the card, so never say it is done. To open a ticket, draft it per the linear-ticket skill, confirm its feature with the user (none for Citadel apps), then call \`propose_ticket\` once with it; say the draft is ready, never that it is filed.`;

/**
 * Local mode's plain-Ask prompt (CTD-219): the same working directory and retrieval recipes,
 * but no sandbox to work around — the session runs on the operator's own machine, with their
 * own tools and credentials, so it drops the "no permission dialog" and "cannot write" lines
 * and adds the one rule local mode still needs: a commit, a push or a PR only on the user's
 * word, never on its own initiative.
 */
export const LOCAL_ASK_SYSTEM_PROMPT = `You are Argus, a panel inside Pensieve — a web app that reads the argus ledgers. Your working directory is argus's code (its skills, CLAUDE.md and scripts); its data (the ledgers, the arch docs and state/) is in ${WORKSPACE_DIR}, which the argus and accio verbs read on their own. This session runs on the operator's own machine, with their own tools and credentials, like a terminal.

To answer, load the \`ask\` skill (skills/ask/SKILL.md) and follow it. A feature's record is \`argus show <feature>\` (its ledger.json: the story, the requirements with their status, the asks with their history, the tickets, the landings); what nobody could place is ${WORKSPACE_DIR}/state/unplaced.json; the record's own history is \`git -C ${WORKSPACE_DIR} log\`; where a screen or field lives in the code is \`accio find "<words>"\`; a ticket is \`argus tracker show <KEY>\`; a Slack permalink is \`mcp__slack__slack_read_thread\` (the channel id and ts from the link). Code from a product checkout is \`git -C <repo> show origin/<branch>:<path>\` at the sha the ledger names; never run git fetch, pull, checkout or stash.

Cite every path and command you used. "The files don't say" beats a guess. Keep the answer short: it is read in a chat panel.

To change the record — close an ask, confirm or contradict a requirement, place an unplaced message — call \`propose_decision\` once as the ask skill's Correcting section says; the user confirms it on the card, so never say it is done. To open a ticket, draft it per the linear-ticket skill, confirm its feature with the user (none for Citadel apps), then call \`propose_ticket\` once with it; say the draft is ready, never that it is filed. You may commit, push a branch or open a pull request, but only when the user asks for it in this conversation — never on your own initiative.`;

/**
 * A conversation whose first turn starts `/scope` runs the scope skill (CTD-192's Ask
 * slice): Ask's reads, plus writes under `revisions/`, the revision verbs and the tracker
 * writes for filing. The skill's own gate — the user's yes in the chat before each step's
 * write — is the approval; Ask's other conversations stay read-only. Longer turn budget: a
 * grounding pass reads a feature's spec, arch doc and ledger before the first question.
 */
export const SCOPE_ADAPTER_CONFIG = {
  ...ADAPTER_CONFIG,
  allowedTools: [
    ...ALLOWED_TOOLS,
    ...scopeWriteRules(WORKSPACE_DIR, ARGUS_DIR),
  ],
  disallowedTools: DISALLOWED_TOOLS.filter((t) => !SCOPE_LIFTED.includes(t)),
  maxTurns: 80,
} satisfies ClaudeCodeTextConfig;

/**
 * Local mode's `/scope` config (CTD-219): local mode already has no allowlist to lift, so a
 * scope run there just keeps `LOCAL_ADAPTER_CONFIG` as is — a local `/scope` sandboxed again
 * would be the one surprise. Unlike the container scope config it does not widen `maxTurns`
 * to 80: local mode has no turn cap at all (CTD-226, S-51), a scope run included.
 */
export const LOCAL_SCOPE_ADAPTER_CONFIG = {
  ...LOCAL_ADAPTER_CONFIG,
} satisfies ClaudeCodeTextConfig;

/** A `/scope` first turn, with or without arguments. */
export const isScopeRequest = (text: string) =>
  /^\/scope(\s|$)/.test(text.trim());

export const SCOPE_SYSTEM_PROMPT = `You are Argus, a panel inside Pensieve, running the scope skill with the user. Your working directory is argus's code; its data is in ${WORKSPACE_DIR}. This is not a terminal: there is no permission dialog and no one to answer one, so never tell the user to grant, allow or approve anything — a denied tool is an answer, and you work around it once.

This is a \`/scope\` conversation: load the \`scope\` skill (skills/scope/SKILL.md), if it is not loaded already, and follow it with the user in this chat. Every step waits for their explicit yes, in a message here, before its file is written or anything is filed.

ARGUS_ROOT is already ${WORKSPACE_DIR}: run \`argus\` and \`accio\` bare, one command at a time, with no pipe, redirect (\`2>&1\`), \`&&\` or \`;\` — a command with any of those is denied, whatever the skill's examples show. You may write files only under ${WORKSPACE_DIR}/revisions/, run \`argus revision new\`, \`show\` and \`file\`, and in step 5 only \`argus tracker create\` and \`argus tracker edit\`, passing a body as \`--body -\` from a heredoc, never a temp file. Everything else that writes is denied: never run the sweep, reconcile or commit.`;

/**
 * Local mode's `/scope` prompt (CTD-219): the same skill, the same wait for an explicit yes
 * before a step's file is written or anything is filed, but no sandbox rule to work around —
 * the skill's own commands run as written, pipes, redirects and \`&&\` included (AC6). Adds the
 * same commit/push/PR rule the plain local prompt does, since the skill's own steps stop at
 * filing a ticket and never commit or push on their own.
 */
export const LOCAL_SCOPE_SYSTEM_PROMPT = `You are Argus, a panel inside Pensieve, running the scope skill with the user. Your working directory is argus's code; its data is in ${WORKSPACE_DIR}. This session runs on the operator's own machine, with their own tools and credentials, like a terminal.

This is a \`/scope\` conversation: load the \`scope\` skill (skills/scope/SKILL.md), if it is not loaded already, and follow it with the user in this chat. Every step waits for their explicit yes, in a message here, before its file is written or anything is filed.

ARGUS_ROOT is already ${WORKSPACE_DIR}: run \`argus\` and \`accio\` exactly as the skill shows, pipes, redirects and \`&&\` included. You may commit, push a branch or open a pull request, but only when the user asks for it in this conversation, and never as part of a step the skill did not ask you to commit.`;

/**
 * The extra system prompt a conversation opened from a feature page carries (LIA-162 AC4,
 * CTD-167 AC5). Without it "it" has no antecedent on the first turn: the page the question was
 * asked from is the browser's, not the session's, and `chat({ context })` reaches only the
 * tool's `execute`. It names the retrieval too, so the feature's own story is the first
 * thing read rather than the board.
 */
export const featurePrompt = (feature: string) =>
  `This conversation was opened on the feature \`${feature}\` (its directory under an app's features/). "it" in a question, a correction or a send means that feature unless the user names something else. Start with \`argus show ${feature}\` — that is its whole record — and read \`${WORKSPACE_DIR}/<app>/features/${feature}/ledger.json\` when the verb is denied.`;

export type AuthMode = "host" | "api-key";

/** Decided per request from the environment, never cached: the container sets the key. */
export const authMode = (env: NodeJS.ProcessEnv = process.env): AuthMode =>
  env.ANTHROPIC_API_KEY?.trim() ? "api-key" : "host";

/** The `claudeCodeText` adapter with Ask's configuration. */
export function askAdapter(overrides: Partial<ClaudeCodeTextConfig> = {}) {
  return claudeCodeText(MODEL, { ...ADAPTER_CONFIG, ...overrides });
}

/**
 * One sandbox for the process, pinned to argus's code (no temp dir, never removed on
 * destroy). `fileEvents: false` — the default watcher would fs.watch the whole checkout.
 * `@tanstack/ai-sandbox` 0.5.6 declares a projection it only provides when a `workspace`
 * is defined; narrowing `provides` to the sandbox itself is enough (see LIA-100).
 */
const sandbox = defineSandbox({
  fileEvents: false,
  id: "ask",
  provider: localProcessSandbox({ dir: ARGUS_DIR }),
});
export const sandboxMiddleware: ChatMiddleware = {
  ...withSandbox(sandbox),
  provides: [SandboxCapability] as const,
};

/**
 * A local-mode run's own sandbox (CTD-221, AC1, AC2): the working directory is argus's
 * directory inside the conversation's citadel worktree, not the live checkout `sandbox`
 * above is pinned to. The local-process provider resolves a given `dir` as a real host
 * directory and never removes it, so this is safe to build per run.
 */
export function worktreeSandboxMiddleware(
  citadelWorktree: string
): ChatMiddleware {
  const worktreeSandbox = defineSandbox({
    fileEvents: false,
    id: "ask",
    provider: localProcessSandbox({ dir: join(citadelWorktree, "apps/argus") }),
  });
  return {
    ...withSandbox(worktreeSandbox),
    provides: [SandboxCapability] as const,
  };
}

/**
 * Local mode's data override, once a run has its worktrees (S-33, S-47): the citadel-data
 * worktree instead of the live checkout `ADAPTER_CONFIG.addDirs` / `.env.ARGUS_ROOT` name.
 */
export const worktreeAdapterOverrides = (
  worktrees: WorktreePaths | undefined
): Partial<ClaudeCodeTextConfig> =>
  worktrees
    ? {
        addDirs: [worktrees.citadelData],
        env: { ARGUS_ROOT: worktrees.citadelData },
      }
    : {};

/**
 * Prepended when a later question's rebase left the citadel-data worktree mid-conflict
 * (S-37): the run's first job, before it answers, is to resolve each file and finish the
 * rebase, then say in its reply which files it resolved.
 */
export const conflictPrompt = (worktree: string, files: string[]) =>
  `Rebasing this conversation's citadel-data worktree onto main left it mid-rebase, with conflicts in: ${files.join(", ")}. Before answering the question below: resolve each conflict in ${worktree}, \`git -C ${worktree} add\` the resolved files, then \`git -C ${worktree} rebase --continue\`. Name the files you resolved in your reply.`;

// ── availability ───────────────────────────────────────────────────────────────

/** What `claude auth status` said: logged in or not, and how (`claude.ai`, `console`, …). */
export interface LoginVerdict {
  authMethod?: string;
  loggedIn: boolean;
}

/**
 * What the page and the run know about the credential. `claudePath` and `probe` are the
 * diagnosis inputs (LIA-104): a run that fails to authenticate names them, so the next
 * "not logged in" is diagnosable rather than retried. `probe.loggedIn` is `null` when the
 * probe could not tell, or was not consulted (`api-key` mode).
 */
export type AskStatus =
  | {
      available: true;
      authMode: AuthMode;
      claudePath: string | null;
      probe: { loggedIn: boolean | null; authMethod?: string };
    }
  | {
      available: false;
      reason: string;
      claudePath: string | null;
      probe: { loggedIn: boolean | null; authMethod?: string };
    };

/** What a host-login probe can say: a verdict, or `null` — cannot tell. */
export type LoginProbe = () => Promise<LoginVerdict | null>;

/**
 * `claude auth status` prints JSON with `loggedIn` and `authMethod`. Advisory only: a
 * missing binary, a timeout, or unparseable output is `null` — "cannot tell", treated as
 * available so the first run's own error is what the user sees.
 */
export const claudeLoginProbe: LoginProbe = () =>
  new Promise((done) => {
    execFile(
      "claude",
      ["auth", "status"],
      { env: process.env, timeout: 8000 },
      (err, stdout) => {
        if (err && !stdout) {
          return done(null);
        }
        try {
          const v = JSON.parse(String(stdout)) as {
            loggedIn?: unknown;
            authMethod?: unknown;
          };
          if (typeof v.loggedIn !== "boolean") {
            return done(null);
          }
          done({
            loggedIn: v.loggedIn,
            ...(typeof v.authMethod === "string" && v.authMethod
              ? { authMethod: v.authMethod }
              : {}),
          });
        } catch {
          done(null);
        }
      }
    );
  });

/**
 * Where the `claude` the run will spawn lives. The harness runs `claude` from PATH through
 * its node runner with Pensieve's own environment, so `command -v` in a shell with that
 * environment is the same lookup. Resolved once per process; `null` when not on PATH.
 */
let claudePathCache: Promise<string | null> | undefined;
export const claudePathProbe = (): Promise<string | null> => {
  claudePathCache ??= new Promise((done) => {
    execFile(
      "sh",
      ["-c", "command -v claude"],
      { env: process.env, timeout: 8000 },
      (err, stdout) => {
        const p = String(stdout ?? "").trim();
        done(!err && p ? p : null);
      }
    );
  });
  return claudePathCache;
};

let probeCache: { at: number; verdict: LoginVerdict | null } | undefined;
const PROBE_TTL_MS = 60_000;

export const NOT_LOGGED_IN =
  "not logged in — run `claude login` on this machine (if you are logged in, a macOS Keychain dialog may be waiting for the claude process: choose Always Allow), or set ANTHROPIC_API_KEY";

/** Is a credential available for a run? Cheap for the key; the host probe is cached a minute. */
export async function askStatus(
  opts: {
    env?: NodeJS.ProcessEnv;
    probe?: LoginProbe;
    claudePath?: string | null;
    now?: number;
  } = {}
): Promise<AskStatus> {
  const mode = authMode(opts.env ?? process.env);
  const claudePath =
    opts.claudePath === undefined ? await claudePathProbe() : opts.claudePath;
  if (mode === "api-key") {
    return {
      authMode: mode,
      available: true,
      claudePath,
      probe: { loggedIn: null },
    };
  }
  const now = opts.now ?? Date.now();
  let verdict: LoginVerdict | null;
  if (opts.probe || !probeCache || now - probeCache.at > PROBE_TTL_MS) {
    verdict = await (opts.probe ?? claudeLoginProbe)();
    if (!opts.probe) {
      probeCache = { at: now, verdict };
    }
  } else {
    ({ verdict } = probeCache);
  }
  const probe = verdict
    ? {
        loggedIn: verdict.loggedIn,
        ...(verdict.authMethod ? { authMethod: verdict.authMethod } : {}),
      }
    : { loggedIn: null };
  if (verdict?.loggedIn === false) {
    return { available: false, claudePath, probe, reason: NOT_LOGGED_IN };
  }
  return { authMode: mode, available: true, claudePath, probe };
}

/**
 * One line that makes an auth failure diagnosable from the page and from the conversation
 * file: which binary, which auth mode, what the login probe said. Two causes fit the
 * 2026-09-06 08:40 failure (same binary, host mode, worked on retry): a macOS Keychain
 * access prompt on the first credential read after a `claude` update, which a headless
 * subprocess cannot answer; or a transient in the CLI's own login check.
 */
export function diagnosisLine(
  status: AskStatus,
  mode: AuthMode = status.available ? status.authMode : "host"
): string {
  const said =
    status.probe.loggedIn === null
      ? "unreachable"
      : status.probe.loggedIn
        ? `loggedIn: true${status.probe.authMethod ? `, ${status.probe.authMethod}` : ""}`
        : "not logged in";
  return `Ask runs \`claude\` from \`${status.claudePath ?? "not on PATH"}\` as \`${mode}\`; \`claude auth status\` said \`${said}\`; on macOS a Keychain dialog may be waiting for the claude process — choose Always Allow.`;
}

/** An error message that is about the credential or the binary rather than the question. */
export const AUTH_ERROR_RE =
  /not logged in|log ?in|authenticat|keychain|api[ _-]?key|credential|401|403|spawn claude|ENOENT/i;

// ── persistence: one file per conversation ─────────────────────────────────────

/**
 * `<dir>/<id>.json`. The messages store keys by thread id; the metadata store keys by
 * (namespace, key) and Ask uses the thread id as the namespace, so both land in the same
 * file. Written whole, via a temp file in the same directory and a rename, so a reader
 * never sees half of one; read-modify-write is serialised per file in this process.
 */
export interface ConversationFile {
  createdAt: string;
  messages: ModelMessage[];
  metadata: Record<string, unknown>;
  threadId: string;
  updatedAt: string;
  version: 1;
}

/** Thread ids the API accepts: what `useChat` and `crypto.randomUUID()` produce, nothing path-like. */
export const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
export const isThreadId = (id: unknown): id is string =>
  typeof id === "string" && THREAD_ID_RE.test(id);

/** A store id as a file name: no separators, no dot-names, reversible. */
export const fileNameOf = (id: string) =>
  `${encodeURIComponent(id).replace(/^\.+/, (dots) => "%2E".repeat(dots.length))}.json`;
const idOfFileName = (name: string) =>
  decodeURIComponent(name.slice(0, -".json".length));

export interface ConversationSummary {
  /** Local mode only: its worktrees are still on disk (S-55) — one `stat`, nothing about what is in them. */
  hasWorktrees?: boolean;
  threadId: string;
  /** The first user turn. */
  title: string;
  updatedAt: string;
}

export interface ConversationStore {
  dir: string;
  list: () => Promise<ConversationSummary[]>;
  persistence: AIPersistence<{
    messages: MessageStore;
    metadata: MetadataStore;
  }>;
  read: (threadId: string) => Promise<ConversationFile | null>;
  remove: (threadId: string) => Promise<void>;
}

const textOf = (content: ModelMessage["content"]): string =>
  content === null
    ? ""
    : typeof content === "string"
      ? content
      : content
          .map((p) =>
            p.type === "text" && typeof p.content === "string" ? p.content : ""
          )
          .join("");

/** The first user turn, whitespace collapsed — the list's title. Empty when there is none. */
export const titleOf = (messages: ModelMessage[]): string =>
  textOf(messages.find((m) => m.role === "user")?.content ?? null)
    .replace(/\s+/g, " ")
    .trim();

/** The last user turn's text: the one a run answers. Empty when there is none. */
const lastUserTurnOf = (messages: ModelMessage[]): string =>
  textOf(
    [...messages].reverse().find((m) => m.role === "user")?.content ?? null
  ).trim();

/** Where a thread's short name lives, once Haiku has written one: `metadata[<threadId>].title`. */
export const TITLE_KEY = "title";

const storedTitleOf = (metadata: Record<string, unknown>) => {
  const t = metadata[TITLE_KEY];
  return typeof t === "string" && t ? t : undefined;
};

const TITLE_PROMPT =
  "Name this conversation in 3 to 6 words, sentence case, no quotes or trailing punctuation. Reply with the name only.";
const TITLE_INPUT_MAX = 2000;
const TITLE_MAX = 80;

/** Haiku's reply, made one clean line; empty is null. */
export const cleanTitle = (reply: string): string | null => {
  const line = (reply.trim().split("\n")[0] ?? "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();
  return line || null;
};

/**
 * A short name for a conversation from its first turn: one `claude -p` on Haiku. Advisory,
 * like the login probe: an error, a timeout or an empty reply is null and the list keeps
 * showing the first turn.
 */
export const nameConversation = (firstTurn: string): Promise<string | null> =>
  new Promise((done) => {
    execFile(
      "claude",
      [
        "-p",
        "--model",
        "haiku",
        "--max-turns",
        "1",
        "--output-format",
        "text",
        `${TITLE_PROMPT}\n\n${firstTurn.slice(0, TITLE_INPUT_MAX)}`,
      ],
      { env: process.env, timeout: 30_000 },
      (err, stdout) => done(err ? null : cleanTitle(String(stdout)))
    );
  });

function parseFile(text: string): ConversationFile | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return null;
  }
  const f = v as Record<string, unknown>;
  if (typeof f.threadId !== "string" || !Array.isArray(f.messages)) {
    return null;
  }
  return {
    createdAt: typeof f.createdAt === "string" ? f.createdAt : "",
    messages: f.messages as ModelMessage[],
    metadata:
      f.metadata && typeof f.metadata === "object" && !Array.isArray(f.metadata)
        ? (f.metadata as Record<string, unknown>)
        : {},
    threadId: f.threadId,
    updatedAt: typeof f.updatedAt === "string" ? f.updatedAt : "",
    version: 1,
  };
}

export function conversationStore(dir = CONVERSATIONS_DIR): ConversationStore {
  const pathOf = (id: string) => join(dir, fileNameOf(id));
  const chains = new Map<string, Promise<unknown>>();

  /** Run `fn` after every earlier operation on the same file has settled. */
  function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    chains.set(
      id,
      next.catch(() => undefined)
    );
    void next.finally(() => {
      if (chains.get(id) === next) {
        chains.delete(id);
      }
    });
    return next;
  }

  async function readRaw(id: string): Promise<ConversationFile | null> {
    try {
      return parseFile(await readFile(pathOf(id), "utf8"));
    } catch {
      return null;
    }
  }

  async function writeAtomic(
    id: string,
    file: ConversationFile
  ): Promise<void> {
    const target = pathOf(id);
    await mkdir(dirname(target), { recursive: true });
    const tmp = join(
      dirname(target),
      `.${basename(target)}.${randomBytes(6).toString("hex")}.tmp`
    );
    try {
      await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await rename(tmp, target);
    } catch (e) {
      await unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  /** Read, patch, write — under the per-file chain. */
  const update = (
    id: string,
    patch: (current: ConversationFile) => ConversationFile
  ) =>
    serial(id, async () => {
      const now = new Date().toISOString();
      const current = (await readRaw(id)) ?? {
        createdAt: now,
        messages: [],
        metadata: {},
        threadId: id,
        updatedAt: now,
        version: 1 as const,
      };
      await writeAtomic(id, { ...patch(current), updatedAt: now });
    });

  const messages = defineMessageStore({
    async loadThread(threadId) {
      return (await serial(threadId, () => readRaw(threadId)))?.messages ?? [];
    },
    // Full replace: `messages` is the whole authoritative transcript.
    saveThread: (threadId, list) =>
      update(threadId, (f) => ({ ...f, messages: [...list] })),
  });

  const metadata = defineMetadataStore({
    delete(namespace, key) {
      return serial(namespace, async () => {
        const f = await readRaw(namespace);
        if (!(f && Object.hasOwn(f.metadata, key))) {
          return;
        }
        const { [key]: _gone, ...rest } = f.metadata;
        await writeAtomic(namespace, {
          ...f,
          metadata: rest,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    async get(namespace, key) {
      const f = await serial(namespace, () => readRaw(namespace));
      return f && Object.hasOwn(f.metadata, key)
        ? (f.metadata[key] ?? null)
        : null;
    },
    set(namespace, key, value) {
      if (value === null || value === undefined) {
        throw new TypeError(
          `metadata.set(${namespace}, ${key}): value is nullish — use delete()`
        );
      }
      return update(namespace, (f) => ({
        ...f,
        metadata: { ...f.metadata, [key]: value },
      }));
    },
  });

  return {
    dir,
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const out: ConversationSummary[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || name.startsWith(".")) {
          continue;
        }
        const id = idOfFileName(name);
        const f = await serial(id, () => readRaw(id));
        if (!f) {
          continue;
        }
        const title = storedTitleOf(f.metadata) ?? titleOf(f.messages);
        if (!title) {
          continue;
        }
        out.push({ threadId: f.threadId, title, updatedAt: f.updatedAt });
      }
      return out.sort((a, b) =>
        a.updatedAt < b.updatedAt
          ? 1
          : a.updatedAt > b.updatedAt
            ? -1
            : a.threadId.localeCompare(b.threadId)
      );
    },
    persistence: defineAIPersistence({ stores: { messages, metadata } }),
    read: (threadId) => serial(threadId, () => readRaw(threadId)),
    remove: (threadId) =>
      serial(threadId, async () => {
        await unlink(pathOf(threadId)).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") {
            throw e;
          }
        });
      }),
  };
}

/** The process's store — `<PENSIEVE_HOME>/conversations/`. */
export const askStore = conversationStore();
export const askPersistence = askStore.persistence;

/** Where a thread's Claude session id lives: `metadata[<threadId>].sessionId`. */
export const SESSION_KEY = "sessionId";

/**
 * The feature this conversation is about, when it was opened from one (LIA-162 AC4, CTD-167
 * AC5). Written once, on the first run that names it, and never again: the conversation is
 * about the feature it started on, whatever a later request claims.
 */
export const FEATURE_KEY = "feature";

/** `"scope"` on a conversation once a user turn started `/scope`, written once, like the feature. */
export const MODE_KEY = "mode";

/**
 * Is this run a `/scope` one, and is it the run that records it? The stored mode wins,
 * the way the feature does; a thread with none turns scope when its first user turn or the
 * one this run answers starts `/scope` — so a conversation that began as a question can
 * switch mid-way, keeping its session and what the interview settled.
 */
export const scopeModeOf = (
  stored: unknown,
  firstTurn: string,
  latestTurn = ""
) => {
  const record =
    stored === null &&
    (isScopeRequest(firstTurn) || isScopeRequest(latestTurn));
  return { on: stored === "scope" || record, record };
};

/**
 * Local mode only (CTD-221): the worktree step between `acquireThread` and `runSetup` — the
 * first question on a thread cuts its worktrees, every later one rebases citadel-data onto
 * main. Container mode never calls `ensureWorktrees` at all (out of scope for this ticket).
 */
function localWorktrees(
  runner: RunMode,
  threadId: string,
  opts: AskRunOptions
): Promise<EnsureWorktreesResult | undefined> {
  if (runner !== "local") {
    return Promise.resolve(undefined);
  }
  return ensureWorktrees({
    citadelDataDir: opts.citadelDataDir ?? WORKSPACE_DIR,
    citadelDir: opts.citadelDir ?? CITADEL_DIR,
    threadId,
    worktreesDir: opts.worktreesDir ?? WORKTREES_DIR,
  });
}

/**
 * What Delete discards beyond the conversation file (CTD-223, S-44): local mode only, and
 * only once the conversation has worktrees — `null` in container mode, or before its first
 * question has cut them, since there is nothing there to discard.
 */
export async function conversationDiscardCounts(
  threadId: string,
  opts: Pick<AskRunOptions, "env" | "worktreesDir"> = {}
): Promise<WorktreeDiscardCounts | null> {
  if (runMode(opts.env ?? process.env) !== "local") {
    return null;
  }
  const paths = worktreePaths(opts.worktreesDir ?? WORKTREES_DIR, threadId);
  return (await hasWorktrees(paths)) ? discardCounts(paths) : null;
}

/** The run's sandbox: the conversation's citadel worktree once it has one, the live checkout otherwise. */
const sandboxFor = (
  worktrees: EnsureWorktreesResult | undefined
): ChatMiddleware =>
  worktrees ? worktreeSandboxMiddleware(worktrees.citadel) : sandboxMiddleware;

/**
 * The adapter overrides and system prompts for a run: the scope skill's or Ask's, container's
 * or local's (CTD-219), with local's worktrees (CTD-221) laid over that. `askAdapter` always
 * merges its argument over `ADAPTER_CONFIG`, so the container branches pass only what they
 * change (`{}`, `SCOPE_ADAPTER_CONFIG`) while the local branches pass a whole `LOCAL_*` config
 * — its explicit `allowedTools`/`disallowedTools: undefined` is what clears the container's
 * lists rather than leaving them under the merge — plus `worktreeAdapterOverrides`, which
 * point the data at the conversation's citadel-data worktree instead of the live checkout.
 * A conflict left by that worktree's rebase (S-37) becomes the run's first system prompt.
 */
const runSetup = (
  scope: boolean,
  feature: string | undefined,
  mode: RunMode,
  worktrees?: EnsureWorktreesResult
) => {
  const local = mode === "local";
  const overrides = worktreeAdapterOverrides(local ? worktrees : undefined);
  const conflictPrompts =
    local && worktrees?.conflict.length
      ? [conflictPrompt(worktrees.citadelData, worktrees.conflict)]
      : [];
  if (scope) {
    return {
      adapter: {
        ...(local ? LOCAL_SCOPE_ADAPTER_CONFIG : SCOPE_ADAPTER_CONFIG),
        ...overrides,
      },
      systemPrompts: [
        ...conflictPrompts,
        local ? LOCAL_SCOPE_SYSTEM_PROMPT : SCOPE_SYSTEM_PROMPT,
      ],
    };
  }
  return {
    adapter: local ? { ...LOCAL_ADAPTER_CONFIG, ...overrides } : {},
    systemPrompts: [
      ...conflictPrompts,
      local ? LOCAL_ASK_SYSTEM_PROMPT : ASK_SYSTEM_PROMPT,
      ...(feature ? [featurePrompt(feature)] : []),
    ],
  };
};

/**
 * Where a filed ticket lives: `metadata[<threadId>]["ticket:<toolCallId>"]`. One key per
 * proposal, which is what makes File idempotent per card (LIA-113 AC3): a second click, or
 * a click after a reload replayed the tool part, answers the issue the first press filed
 * rather than creating another.
 */
export const ticketKey = (toolCallId: string) => `ticket:${toolCallId}`;

/** What a press of File recorded: the issue Linear made, and when. */
export interface FiledTicket {
  at: string;
  /** the feature dir the user confirmed; absent for a Citadel ticket, which has no ledger */
  feature?: string;
  id: string;
  identifier: string;
  /** absent on tickets filed before titles were kept; Home shows the identifier instead */
  title?: string;
  url: string;
}

const asFiledTicket = (v: unknown): FiledTicket | undefined => {
  if (!v || typeof v !== "object") {
    return;
  }
  const t = v as Record<string, unknown>;
  return typeof t.identifier === "string" && typeof t.url === "string"
    ? {
        at: typeof t.at === "string" ? t.at : "",
        id: typeof t.id === "string" ? t.id : "",
        identifier: t.identifier,
        url: t.url,
        ...(typeof t.title === "string" ? { title: t.title } : {}),
        ...(isFeature(t.feature) ? { feature: t.feature } : {}),
      }
    : undefined;
};

export const readFiledTicket = async (
  store: ConversationStore,
  threadId: string,
  toolCallId: string
): Promise<FiledTicket | undefined> =>
  asFiledTicket(
    await store.persistence.stores.metadata.get(threadId, ticketKey(toolCallId))
  );

export const writeFiledTicket = (
  store: ConversationStore,
  threadId: string,
  toolCallId: string,
  ticket: FiledTicket
): Promise<void> =>
  store.persistence.stores.metadata.set(
    threadId,
    ticketKey(toolCallId),
    ticket
  );

/** A ticket File recorded, with the thread it was filed from. */
export interface FiledTicketRow extends FiledTicket {
  threadId: string;
}

/** Every ticket filed from Ask, across threads — what Home lists for tickets with no ledger. */
export async function listFiledTickets(
  store: ConversationStore = askStore
): Promise<FiledTicketRow[]> {
  const out: FiledTicketRow[] = [];
  for (const { threadId } of await store.list()) {
    const f = await store.read(threadId);
    for (const [k, v] of Object.entries(f?.metadata ?? {})) {
      const t = k.startsWith("ticket:") ? asFiledTicket(v) : undefined;
      if (t) {
        out.push({ ...t, threadId });
      }
    }
  }
  return out;
}

export const readSessionId = async (
  store: ConversationStore,
  threadId: string
): Promise<string | undefined> => {
  const v = await store.persistence.stores.metadata.get(threadId, SESSION_KEY);
  return typeof v === "string" && v ? v : undefined;
};

// ── the run ────────────────────────────────────────────────────────────────────

export interface AskInput {
  /** The feature the conversation was opened on — stored on the first run, ignored after. */
  feature?: string;
  /**
   * The full transcript (what `useChat` sends), or `[]` to continue the stored one as it
   * stands — TanStack's "send the full transcript, or none of it". A delta would replace
   * the stored thread, so never send one.
   */
  messages: UIMessage[];
  runId?: string;
  threadId: string;
}

export interface AskRunOptions {
  abortController?: AbortController;
  adapter?: AnyTextAdapter;
  /** Local mode only: citadel-data's repo root, cut from its local `main`. Defaults to `WORKSPACE_DIR`. */
  citadelDataDir?: string;
  /** Local mode only (CTD-221): citadel's repo root, cut from `origin/main`. Defaults to `CITADEL_DIR`. */
  citadelDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Middleware ahead of persistence; the sandbox by default. Tests pass `[]` with a fake adapter. */
  middleware?: ChatMiddleware[];
  /** Names a new thread; `nameConversation` on a real run, none with a test's fake adapter. */
  name?: (firstTurn: string) => Promise<string | null>;
  status?: () => Promise<AskStatus>;
  store?: ConversationStore;
  /** Local mode only: where a conversation's worktrees live. Defaults to `WORKTREES_DIR`. */
  worktreesDir?: string;
}

/**
 * One run at a time per thread in this process. The client's `useChat` already queues
 * sends per hook; two tabs on one thread bypass that, so this is the belt and braces.
 */
const threadChains = new Map<string, Promise<void>>();

async function acquireThread(threadId: string): Promise<() => void> {
  const prev = threadChains.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => mine);
  threadChains.set(threadId, chained);
  await prev;
  return () => {
    release();
    if (threadChains.get(threadId) === chained) {
      threadChains.delete(threadId);
    }
  };
}

/**
 * The feature a run is about. The stored one wins for the same reason `onStart` refuses to
 * overwrite it: the conversation is about the feature it started on, whatever a later
 * request claims. Only a feature key counts, on the way in and on the way out.
 */
export function featureOf(
  stored: unknown,
  asked: string | undefined
): string | undefined {
  if (isFeature(stored)) {
    return stored;
  }
  return isFeature(asked) ? asked : undefined;
}

const errorChunks = (
  threadId: string,
  runId: string,
  message: string,
  code: string
): StreamChunk[] => [
  { runId, threadId, timestamp: Date.now(), type: EventType.RUN_STARTED },
  {
    code,
    error: { code, message },
    message,
    runId,
    threadId,
    timestamp: Date.now(),
    type: EventType.RUN_ERROR,
  },
];

/** Where a run's end lands in the conversation file, beside `sessionId`. */
export const LAST_ERROR_KEY = "lastError";
export const FINISH_REASON_KEY = "finishReason";

export interface LastError {
  at: string;
  code?: string;
  message: string;
}

const errorMessageOf = (e: unknown): string =>
  e instanceof Error
    ? e.message
    : typeof e === "string"
      ? e
      : JSON.stringify(e);
const errorCodeOf = (e: unknown): string | undefined =>
  e && typeof e === "object" && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;

/**
 * The harness's non-JSON stdout lines and the adapter's errors, per run. The adapter logs
 * them through TanStack's debug logger at the `provider` category and nowhere else, so a
 * logger that keeps them is the only way to see what the CLI printed before it died. With
 * `ASK_DEBUG=1` every category goes to the console instead.
 */
function harnessLog(): { debug: DebugOption; lines: string[] } {
  if (process.env.ASK_DEBUG === "1") {
    return { debug: true, lines: [] };
  }
  const lines: string[] = [];
  const NON_JSON = "provider=claude-code non-json line: ";
  const logger: Logger = {
    debug: (message) => {
      if (message.startsWith(NON_JSON)) {
        lines.push(message.slice(NON_JSON.length));
      }
    },
    error: (message, meta) => console.error(`[ask] ${message}`, meta ?? ""),
    info: () => undefined,
    warn: (message, meta) => console.warn(`[ask] ${message}`, meta ?? ""),
  };
  return {
    debug: {
      agentLoop: false,
      config: false,
      errors: true,
      logger,
      middleware: false,
      output: false,
      provider: true,
      request: false,
      sandbox: false,
      tools: false,
    },
    lines,
  };
}

/**
 * At `maxTurns` the claude CLI prints its result — the adapter emits RUN_FINISHED with
 * `finishReason: 'length'` — and then exits 1. The sandbox runner throws, the adapter
 * answers with a RUN_ERROR chunk, and the engine takes its error path: the assistant turn
 * is never assembled onto the transcript and persistence never writes it, so the file
 * keeps the streaming snapshot (text only, throttled) and the page shows nothing. The run
 * did finish. Whatever comes after the adapter's own finish — a RUN_ERROR chunk or a
 * throw — is logged and dropped here, before the engine sees it, so the run ends the way
 * a clean one does (LIA-104, AC8).
 */
export function finishedIsFinished<A extends AnyTextAdapter>(
  adapter: A,
  late: (what: unknown) => void
): A {
  const chatStream = async function* (options: Parameters<A["chatStream"]>[0]) {
    let finished = false;
    try {
      for await (const chunk of adapter.chatStream(options)) {
        if (chunk.type === EventType.RUN_FINISHED) {
          finished = true;
        } else if (finished && chunk.type === EventType.RUN_ERROR) {
          late(chunk.message);
          continue;
        }
        yield chunk;
      }
    } catch (e) {
      if (!finished) {
        throw e;
      }
      late(e instanceof Error ? e.message : e);
    }
  };
  return new Proxy(adapter, {
    get: (target, prop) =>
      prop === "chatStream" ? chatStream : Reflect.get(target, prop, target),
  });
}

/**
 * Run one Ask turn. Under the thread's lock: read the stored session id, run `chat()` with
 * the adapter, the sandbox and `withPersistence` (streaming snapshots on, so a page closed
 * mid-answer keeps the partial text), and record the session id the run reports.
 *
 * RUN_FINISHED is held back until the run's hooks have completed — the engine emits it
 * before persistence's finish hook writes the final transcript, and a client must be able
 * to reload on RUN_FINISHED and see the whole conversation.
 *
 * A run that ends in RUN_ERROR leaves `metadata.lastError` in the file; when the error is
 * about the credential its message gains the diagnosis line (`diagnosisLine`), on screen
 * and on disk. A run that ended at the turn cap leaves `metadata.finishReason: 'length'`
 * and, thanks to `finishedIsFinished`, its whole transcript (LIA-104).
 */
export async function* askStream(
  input: AskInput,
  opts: AskRunOptions = {}
): AsyncIterable<StreamChunk> {
  const store = opts.store ?? askStore;
  const name = opts.name ?? (opts.adapter ? undefined : nameConversation);
  const runId = input.runId ?? `run_${randomBytes(8).toString("hex")}`;
  const status = await (opts.status ?? askStatus)();
  if (!status.available) {
    yield* errorChunks(
      input.threadId,
      runId,
      `${status.reason}\n${diagnosisLine(status)}`,
      "ASK_UNAVAILABLE"
    );
    return;
  }
  const auth = authMode(opts.env ?? process.env);
  const runner = runMode(opts.env ?? process.env);
  const diagnosis = diagnosisLine(status, auth);
  const release = await acquireThread(input.threadId);
  try {
    // Local mode only (CTD-221): the first question cuts the conversation's worktrees,
    // every later one rebases citadel-data onto main. Between the thread lock and the run
    // setup, so it also serialises the git calls per thread (S-15).
    const worktrees = await localWorktrees(runner, input.threadId, opts);
    const sessionId = await readSessionId(store, input.threadId);
    const modelMessages = convertMessagesToModelMessages(input.messages);
    let firstTurn = titleOf(modelMessages);
    let latestTurn = lastUserTurnOf(modelMessages);
    if (input.messages.length === 0) {
      const stored = await store.persistence.stores.messages.loadThread(
        input.threadId
      );
      firstTurn = titleOf(stored);
      latestTurn = lastUserTurnOf(stored);
      if (stored.at(-1)?.role !== "user") {
        yield* errorChunks(
          input.threadId,
          runId,
          "nothing to continue — the stored conversation has no unanswered question; send the full transcript with the new one",
          "ASK_NOTHING_TO_CONTINUE"
        );
        return;
      }
    }
    const { metadata } = store.persistence.stores;
    const feature = featureOf(
      await metadata.get(input.threadId, FEATURE_KEY),
      input.feature
    );
    const scope = scopeModeOf(
      await metadata.get(input.threadId, MODE_KEY),
      firstTurn,
      latestTurn
    );
    const setup = runSetup(scope.on, feature, runner, worktrees);
    const harness = harnessLog();
    let lastError: LastError | undefined;
    const recordError = async (message: string, code: string | undefined) => {
      const full =
        AUTH_ERROR_RE.test(message) && !message.includes(diagnosis)
          ? `${message}\n${diagnosis}`
          : message;
      lastError = {
        message: full,
        ...(code ? { code } : {}),
        at: new Date().toISOString(),
      };
      await metadata.set(input.threadId, LAST_ERROR_KEY, lastError);
      if (harness.lines.length) {
        console.warn(
          `[ask] ${input.threadId}: the harness printed, before the error —\n${harness.lines.join("\n")}`
        );
      }
      return full;
    };
    const recorder = defineChatMiddleware({
      name: "ask-session",
      async onChunk(_ctx, chunk) {
        if (chunk.type === EventType.RUN_ERROR) {
          const message = await recordError(chunk.message, chunk.code);
          return message === chunk.message
            ? undefined
            : { ...chunk, error: { ...chunk.error, message }, message };
        }
        if (
          chunk.type !== EventType.CUSTOM ||
          chunk.name !== SESSION_ID_EVENT
        ) {
          return;
        }
        const id = (chunk.value as { sessionId?: unknown } | undefined)
          ?.sessionId;
        if (typeof id === "string" && id) {
          await metadata.set(input.threadId, SESSION_KEY, id);
        }
      },
      // A throw the engine caught (the adapter's RUN_ERROR chunk is the other way in).
      async onError(_ctx, info) {
        if (!lastError) {
          await recordError(
            errorMessageOf(info.error),
            errorCodeOf(info.error)
          );
        }
      },
      async onFinish(_ctx, info) {
        if (info.finishReason === "length") {
          await metadata.set(input.threadId, FINISH_REASON_KEY, "length");
        }
      },
      // A new run starts clean: what the last one left is superseded by this one's end.
      // The feature is the exception — it is the thread's own, written once and kept.
      async onStart() {
        await metadata.delete(input.threadId, LAST_ERROR_KEY);
        await metadata.delete(input.threadId, FINISH_REASON_KEY);
        if (
          isFeature(input.feature) &&
          (await metadata.get(input.threadId, FEATURE_KEY)) === null
        ) {
          await metadata.set(input.threadId, FEATURE_KEY, input.feature);
        }
        if (scope.record) {
          await metadata.set(input.threadId, MODE_KEY, "scope");
        }
        // Named alongside the answer, never awaited: a slow or failed name never holds the run.
        if (
          name &&
          firstTurn &&
          (await metadata.get(input.threadId, TITLE_KEY)) === null
        ) {
          void name(firstTurn)
            .then((title) =>
              title ? metadata.set(input.threadId, TITLE_KEY, title) : undefined
            )
            .catch((e: unknown) =>
              console.warn(`[ask] ${input.threadId}: naming failed —`, e)
            );
        }
      },
    });
    const middleware: ChatMiddleware[] = [
      ...(opts.middleware ?? [sandboxFor(worktrees)]),
      withPersistence(store.persistence, { snapshotStreaming: true }),
      recorder,
    ];
    const late = (what: unknown) =>
      console.warn(
        `[ask] ${input.threadId}: the run finished, then the agent process failed —`,
        what
      );
    const stream = chat({
      abortController: opts.abortController,
      adapter: finishedIsFinished(
        opts.adapter ?? askAdapter(setup.adapter),
        late
      ),
      // Each tool's `execute` runs here, in this process, through the adapter's MCP bridge —
      // which is provisioned only because `tools` below is non-empty (LIA-111).
      context: {
        threadId: input.threadId,
        ...(feature ? { feature } : {}),
      },
      debug: harness.debug,
      messages: modelMessages,
      middleware,
      modelOptions: { authMode: auth, ...(sessionId ? { sessionId } : {}) },
      runId,
      systemPrompts: setup.systemPrompts,
      threadId: input.threadId,
      tools: [proposeDecisionTool, proposeTicketTool],
    });
    let finished: StreamChunk | undefined;
    for await (const chunk of stream) {
      if (chunk.type === EventType.RUN_FINISHED) {
        finished = chunk;
        continue;
      }
      yield chunk;
    }
    if (finished) {
      yield finished;
    }
  } finally {
    release();
  }
}

// ── reads for the pages ────────────────────────────────────────────────────────

export interface Conversation {
  createdAt: string;
  /** The feature this conversation was opened on, when it was (LIA-162, CTD-167). */
  feature?: string;
  /** `'length'` when the last run stopped at the turn cap — the page says so under the answer. */
  finishReason?: "length";
  /** How the last run ended, when it ended in error; cleared when the next run starts. */
  lastError?: LastError;
  messages: UIMessage[];
  /** This server's run mode (CTD-224) — the page shows Finish only in `'local'`. */
  mode: RunMode;
  sessionId?: string;
  threadId: string;
  /** Haiku's short name for it, once written; the page falls back to the first turn. */
  title?: string;
  updatedAt: string;
}

const lastErrorOf = (v: unknown): LastError | undefined => {
  if (!v || typeof v !== "object") {
    return undefined;
  }
  const e = v as Record<string, unknown>;
  if (typeof e.message !== "string") {
    return undefined;
  }
  return {
    message: e.message,
    ...(typeof e.code === "string" ? { code: e.code } : {}),
    at: typeof e.at === "string" ? e.at : "",
  };
};

export async function getConversation(
  threadId: string,
  store = askStore,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<Conversation | null> {
  const f = await store.read(threadId);
  if (!f) {
    return null;
  }
  const sessionId = f.metadata[SESSION_KEY];
  const lastError = lastErrorOf(f.metadata[LAST_ERROR_KEY]);
  const feature = f.metadata[FEATURE_KEY];
  const title = storedTitleOf(f.metadata);
  return {
    messages: modelMessagesToUIMessages(f.messages),
    mode: runMode(opts.env ?? process.env),
    threadId: f.threadId,
    ...(title ? { title } : {}),
    ...(isFeature(feature) ? { feature } : {}),
    ...(typeof sessionId === "string" && sessionId ? { sessionId } : {}),
    ...(f.metadata[FINISH_REASON_KEY] === "length"
      ? { finishReason: "length" as const }
      : {}),
    ...(lastError ? { lastError } : {}),
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

/**
 * Every stored conversation, newest first. In local mode each row also says whether its
 * worktrees are still on disk (S-55, CTD-251) — one `stat` per row via `hasWorktrees`, never
 * a `git status`; container mode never has worktrees to mark, so its rows pass through as is.
 */
export async function listConversations(
  store = askStore,
  opts: Pick<AskRunOptions, "env" | "worktreesDir"> = {}
): Promise<ConversationSummary[]> {
  const rows = await store.list();
  if (runMode(opts.env ?? process.env) !== "local") {
    return rows;
  }
  const worktreesDir = opts.worktreesDir ?? WORKTREES_DIR;
  return Promise.all(
    rows.map(async (row) => {
      const held = await hasWorktrees(
        worktreePaths(worktreesDir, row.threadId)
      );
      return held ? { ...row, hasWorktrees: true } : row;
    })
  );
}

/**
 * Remove that one file; answer the remaining list. In local mode the conversation's worktrees
 * and their shared `ask/<id>` branch go first (S-44, CTD-223) — `removeWorktrees` is a no-op
 * when the thread never got past its first question, so container mode and a fresh thread
 * cost nothing extra here.
 */
export async function deleteConversation(
  threadId: string,
  store = askStore,
  opts: Pick<
    AskRunOptions,
    "citadelDataDir" | "citadelDir" | "env" | "worktreesDir"
  > = {}
): Promise<ConversationSummary[]> {
  if (runMode(opts.env ?? process.env) === "local") {
    await removeWorktrees(
      worktreePaths(opts.worktreesDir ?? WORKTREES_DIR, threadId),
      {
        citadelDataDir: opts.citadelDataDir ?? WORKSPACE_DIR,
        citadelDir: opts.citadelDir ?? CITADEL_DIR,
        threadId,
      }
    );
  }
  await store.remove(threadId);
  return listConversations(store, opts);
}

// ── Finish (CTD-222) ─────────────────────────────────────────────────────────────

export interface FinishConversationOptions {
  adapter?: AnyTextAdapter;
  /** Local mode only: citadel-data's repo root, cut from its local `main`. Defaults to `WORKSPACE_DIR`. */
  citadelDataDir?: string;
  /** Local mode only: citadel's repo root, cut from `origin/main`. Defaults to `CITADEL_DIR`. */
  citadelDir?: string;
  env?: NodeJS.ProcessEnv;
  middleware?: ChatMiddleware[];
  status?: () => Promise<AskStatus>;
  store?: ConversationStore;
  /** Local mode only: where a conversation's worktrees live. Defaults to `WORKTREES_DIR`. */
  worktreesDir?: string;
}

/**
 * The synthetic question Finish's rebase conflict becomes (S-42): run through `askStream`
 * exactly like a real question, so it streams into the thread, updates the session id, and
 * the reply — naming the files it resolved — is what the thread shows.
 */
const finishConflictQuestion = (
  worktree: string,
  files: string[]
): UIMessage => ({
  id: `finish_${randomBytes(8).toString("hex")}`,
  parts: [
    {
      content: `Finish is landing this conversation's data on main.\n\n${conflictPrompt(worktree, files)}`,
      type: "text",
    },
  ],
  role: "user",
});

/**
 * One askStream turn asking the session to resolve the citadel-data worktree's current rebase
 * conflict. Reuses the run path a real question takes — including `localWorktrees`' own
 * rebase-and-conflict check, so the run's system prompt carries the same instructions — and is
 * subject to the one-run-per-thread lock like any other turn, which is why `finishConversation`
 * drops its own lock before calling this and re-takes it after.
 *
 * A RUN_ERROR here (no credential, the turn itself failing) never resolves the conflict, so
 * `finishConversation`'s loop would otherwise call this again on the very same conflict
 * forever; raising instead stops Finish and surfaces why.
 */
async function resolveConflictTurn(
  threadId: string,
  worktree: string,
  files: string[],
  opts: FinishConversationOptions
): Promise<void> {
  const stream = askStream(
    { messages: [finishConflictQuestion(worktree, files)], threadId },
    opts
  );
  let error: string | undefined;
  for await (const chunk of stream) {
    if (chunk.type === EventType.RUN_ERROR) {
      error = chunk.message;
    }
  }
  if (error) {
    throw new Error(`Finish's conflict-resolution turn failed: ${error}`);
  }
}

/**
 * Land a local-mode conversation's citadel-data worktree on main (S-41): commit everything in
 * it, committed or not, rebase onto main — resolving a conflict with one Claude turn (S-42) —
 * then fast-forward the live checkout's main onto the branch, rebasing again rather than
 * merging when live main raced ahead in between (S-49). Once it lands, remove both worktrees
 * and both local branches (S-48); a pushed citadel branch and its PR are untouched.
 * Idempotent: a conversation with no worktrees — never started locally, or already finished —
 * is a no-op, the same shape as `deleteConversation` removing a file that is not there.
 *
 * Takes the thread lock so a run and a Finish never overlap (`acquireThread`), except while the
 * conflict turn itself runs — that turn takes the lock on its own, so `finishConversation`
 * drops it first and re-takes it once the turn is done.
 */
export async function finishConversation(
  threadId: string,
  opts: FinishConversationOptions = {}
): Promise<void> {
  const citadelDir = opts.citadelDir ?? CITADEL_DIR;
  const citadelDataDir = opts.citadelDataDir ?? WORKSPACE_DIR;
  const worktreesDir = opts.worktreesDir ?? WORKTREES_DIR;
  const paths = worktreePaths(worktreesDir, threadId);

  let release = await acquireThread(threadId);
  try {
    if (!(await hasWorktrees(paths))) {
      return;
    }
    await commitAll(paths.citadelData, `ask/${threadId}: finish`);
    const branch = branchOf(threadId);
    for (;;) {
      const { conflict } = await rebaseOntoMain(paths.citadelData);
      if (conflict.length > 0) {
        release();
        try {
          await resolveConflictTurn(
            threadId,
            paths.citadelData,
            conflict,
            opts
          );
        } finally {
          release = await acquireThread(threadId);
        }
        continue;
      }
      if (await fastForwardMain(citadelDataDir, branch)) {
        break;
      }
      // Live main moved between the rebase and the fast-forward (S-49) — rebase again.
    }
    await removeWorktrees(paths, { citadelDataDir, citadelDir, threadId });
  } finally {
    release();
  }
}
