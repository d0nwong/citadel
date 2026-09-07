/**
 * Ask's tool names, shared by the server (the adapter's allow / deny lists, LIA-104) and
 * the chat UI (which renders a tool-call part only when its name is registered). No node
 * imports: this file is bundled for the browser too.
 *
 * Claude Code checks deny rules before allow rules, so an allow prefix and a narrower
 * deny prefix can coexist (`bun run accio:*` allowed, `bun run accio sync:*` denied). A
 * `Bash(...)` rule is a literal command prefix: `git -C <path> log …` is not `git log …`,
 * so the per-checkout rules are built at startup from the resolved paths (`gitReadRules`).
 */

/** The harness's own read-only set, plus the accio read verbs and the `ask` skill. */
export const BASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Skill",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(bun run accio:*)",
  "Bash(bun scripts/accio.ts:*)",
] as const;

/** `accio sync` and `accio map` write `.state/` and the manifest — denied under the allow above. */
export const ACCIO_WRITE_VERBS = [
  "Bash(bun run accio sync:*)",
  "Bash(bun run accio map:*)",
  "Bash(bun scripts/accio.ts sync:*)",
  "Bash(bun scripts/accio.ts map:*)",
] as const;

/** Harness tools that write or reach the network. Never even reach the permission check. */
export const HARNESS_WRITE_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
] as const;

const linear = (names: readonly string[]) =>
  names.map((n) => `mcp__linear__${n}`);

/** The hosted Linear MCP server's read tools — a ticket question is answered from Linear, not relayed. */
export const LINEAR_READ_TOOLS = linear([
  "get_issue",
  "list_issues",
  "list_comments",
  "get_project",
  "list_projects",
  "get_document",
  "list_documents",
  "list_issue_labels",
  "list_issue_statuses",
  "list_users",
  "get_team",
  "get_milestone",
  "list_milestones",
  "search_documentation",
]);

/**
 * Everything on that server that writes, plus the diff and release tools, by name (no
 * wildcard, so a rule never matches more than it says). Argus stays read-only: ticket edits
 * are the sweep's ticket pass, and a verdict on a point or a new ticket is proposed through
 * a bridged tool below and written only when Liam confirms it. `save_issue` stays here for
 * that reason — the session drafts a ticket with every read tool and can never file one.
 */
export const LINEAR_WRITE_TOOLS = linear([
  "save_issue",
  "save_comment",
  "save_document",
  "delete_comment",
  "create_attachment",
  "create_attachment_from_upload",
  "delete_attachment",
  "create_issue_label",
  "save_issue_label",
  "save_project",
  "save_project_label",
  "save_milestone",
  "save_status_update",
  "delete_status_update",
  "share_issue",
  "unshare_issue",
  "mark_notification",
  // diffs
  "get_diff",
  "get_diff_threads",
  "list_diffs",
  "delete_diff_comment",
  "save_diff_comment",
  "merge_diff",
  "resolve_diff_thread",
  "submit_diff_review",
  // releases
  "get_release",
  "get_release_note",
  "list_release_notes",
  "list_release_pipelines",
  "list_releases",
  "save_release",
  "save_release_note",
]);

// ── the bridged tools ───────────────────────────────────────────────────────────

/**
 * Tools Pensieve bridges into the run through `chat({ tools })` (LIA-111, LIA-113). The adapter
 * provisions them as an MCP server named `tanstack`, so the session sees them prefixed —
 * that is the spelling the allowlist needs, since an MCP tool absent from `--allowedTools`
 * is denied under `permissionMode: 'default'`. The adapter strips the prefix on the way
 * back, so the tool-call part the page renders carries the bare name.
 */
export const PROPOSE_DECISION = "propose_decision";
/** LIA-113: the same shape for a new Linear issue — it checks a draft, File writes it. */
export const PROPOSE_TICKET = "propose_ticket";
export const BRIDGED_TOOLS = [PROPOSE_DECISION, PROPOSE_TICKET] as const;
export const BRIDGED_MCP_PREFIX = "mcp__tanstack__";

/** The bridged names as the session sees them — what goes on `--allowedTools`. */
export const bridgedToolRules = (): string[] =>
  BRIDGED_TOOLS.map((n) => `${BRIDGED_MCP_PREFIX}${n}`);

/** The two git read verbs for one checkout path, spelled exactly as the session will type it. */
export const gitReadRules = (checkout: string): string[] => [
  `Bash(git -C ${checkout} log:*)`,
  `Bash(git -C ${checkout} show:*)`,
];

/**
 * Every tool name the page may see as a tool-call part: the allowlist, the denied names
 * (a denial arrives as a result on the same part), the harness tools a run can still name,
 * and the bridged tool bare (the adapter strips its prefix). The `Bash(...)` rules collapse
 * to `Bash`.
 */
export const ASK_TOOL_PART_NAMES: readonly string[] = [
  ...new Set([
    ...BASE_TOOLS.map((t) => t.replace(/\(.*$/, "")),
    ...BRIDGED_TOOLS,
    ...HARNESS_WRITE_TOOLS,
    "LS",
    "TodoWrite",
    // Claude Code loads its deferred tools (the MCP ones included) through this one first.
    "ToolSearch",
    ...LINEAR_READ_TOOLS,
    ...LINEAR_WRITE_TOOLS,
  ]),
];
