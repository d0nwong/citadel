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

/**
 * `argus`'s read verbs, each named in full. The allowlist is a command *prefix* match,
 * so `Bash(argus:*)` would allow `argus close` and `argus confirm` with
 * it — and a correction is the user's, proposed on a card and never run by the session
 * (LIA-162 AC4). Listing the four read verbs one by one is what keeps the write verbs out.
 *
 * Every spelling, because a rule is literal: `argus show …` is what the `ask` skill
 * writes, `bun scripts/argus.ts …` is what a path-qualified call would be.
 */
const ARGUS_READ_VERBS = ["show", "validate"] as const;

/** argus's read verbs, in both spellings a session might use; the write verbs are never listed */
export const argusReadRules = (): string[] =>
  ARGUS_READ_VERBS.flatMap((v) => [
    `Bash(argus ${v}:*)`,
    `Bash(bun scripts/argus.ts ${v}:*)`,
    `Bash(bun run argus ${v}:*)`,
  ]);

/**
 * `argus tracker`'s two read verbs (CTD-200, CTD-209): a ticket, or the open ones, from
 * whichever provider its key names — Linear for `CTD`/`ALD`, Trello for `AP` — in place of
 * the Linear MCP read tools, which cannot reach Trello. Listed one by one for the same reason
 * as `ARGUS_READ_VERBS`: a bare `argus tracker` rule would carry `create` and `edit` with it.
 */
const TRACKER_READ_VERBS = ["show", "list"] as const;

/** argus tracker's read verbs, in both spellings a session might use; create/edit are never listed */
export const trackerReadRules = (): string[] =>
  TRACKER_READ_VERBS.flatMap((v) => [
    `Bash(argus tracker ${v}:*)`,
    `Bash(bun scripts/argus.ts tracker ${v}:*)`,
    `Bash(bun run argus tracker ${v}:*)`,
  ]);

export const BASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Skill",
  // The open web, read-only: a link in a question, or docs the answer needs.
  "WebFetch",
  "WebSearch",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(bun run accio:*)",
  "Bash(bun scripts/accio.ts:*)",
  "Bash(accio:*)",
  ...argusReadRules(),
  ...trackerReadRules(),
] as const;

/** `accio sync` and `accio map` write `.state/` and the manifest — denied under the allow above. */
export const ACCIO_WRITE_VERBS = [
  "Bash(bun run accio sync:*)",
  "Bash(bun run accio map:*)",
  "Bash(bun scripts/accio.ts sync:*)",
  "Bash(bun scripts/accio.ts map:*)",
] as const;

/** `argus tracker create` and `edit` write a ticket on its provider — denied under the allow above. */
export const TRACKER_WRITE_RULES = (["create", "edit"] as const).flatMap(
  (v) => [
    `Bash(argus tracker ${v}:*)`,
    `Bash(bun scripts/argus.ts tracker ${v}:*)`,
    `Bash(bun run argus tracker ${v}:*)`,
  ]
);

/**
 * What a `/scope` conversation may write on top of Ask's reads: files under the data's
 * `revisions/` and nowhere else, the revision verbs that make and file one (never `drop`),
 * and — for step 5 — `argus tracker create` and `edit`. The skill waits for the user's yes
 * in the chat before each; these rules only say where a write may land.
 */
const REVISION_VERBS = ["new", "show", "file"] as const;

/**
 * Each write verb in every spelling a scope run types: bare, as the skill's `ARGUS_ROOT=<data>`
 * prefix (the skill's examples carry it, and the model follows them over the prompt), and
 * through the script's absolute path. A rule is a literal prefix, so every spelling still ends
 * in exactly that verb; pipes and redirects stay denied.
 */
const writeVerbRules = (verbs: string[], workspace: string, argusDir: string) =>
  verbs.flatMap((cmd) =>
    [
      `argus ${cmd}`,
      `bun scripts/argus.ts ${cmd}`,
      `bun run argus ${cmd}`,
      `bun ${argusDir}/scripts/argus.ts ${cmd}`,
    ].flatMap((c) => [`Bash(${c}:*)`, `Bash(ARGUS_ROOT=${workspace} ${c}:*)`])
  );

export const scopeWriteRules = (
  workspace: string,
  argusDir = "/app/apps/argus"
): string[] => [
  // `//` makes a permission path absolute
  `Edit(/${workspace}/revisions/**)`,
  `Write(/${workspace}/revisions/**)`,
  ...new Set([
    ...writeVerbRules(
      [
        ...REVISION_VERBS.map((v) => `revision ${v}`),
        "tracker create",
        "tracker edit",
      ],
      workspace,
      argusDir
    ),
    ...TRACKER_WRITE_RULES,
  ]),
];

/** The denied names a `/scope` run lifts: its path-scoped Edit/Write and the tracker writes stand in for them. */
export const SCOPE_LIFTED: readonly string[] = [
  "Edit",
  "Write",
  ...TRACKER_WRITE_RULES,
];

/** Harness tools that write. Never even reach the permission check. */
export const HARNESS_WRITE_TOOLS = [
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "Task",
] as const;

const linear = (names: readonly string[]) =>
  names.map((n) => `mcp__linear__${n}`);

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

const slack = (names: readonly string[]) =>
  names.map((n) => `mcp__slack__slack_${n}`);

/**
 * Slack's hosted MCP server, which argus's `.mcp.json` reaches through the local gateway
 * like Linear's: the read tools, so a permalink in a question is read rather than relayed.
 */
export const SLACK_READ_TOOLS = slack([
  "read_thread",
  "read_channel",
  "read_canvas",
  "read_file",
  "read_list",
  "read_user_profile",
  "get_reactions",
  "list_channel_members",
  "list_user_channels",
  "search_public",
  "search_public_and_private",
  "search_channels",
  "search_users",
  "search_emojis",
]);

/** Everything on that server that posts, reacts, uploads or edits, by name: Argus never writes to Slack. */
export const SLACK_WRITE_TOOLS = slack([
  "send_message",
  "send_message_draft",
  "schedule_message",
  "add_reaction",
  "create_canvas",
  "update_canvas",
  "create_conversation",
  "create_list",
  "update_list",
  "add_list_record",
  "update_list_record",
  "get_file_upload_url",
  "complete_file_upload",
]);

// ── the bridged tools ───────────────────────────────────────────────────────────

/**
 * Tools Pensieve bridges into the run through `chat({ tools })` (LIA-111, LIA-113).
 * The adapter provisions them as an MCP server named `tanstack`, so the session sees them prefixed —
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
    ...LINEAR_WRITE_TOOLS,
    ...SLACK_READ_TOOLS,
    ...SLACK_WRITE_TOOLS,
  ]),
];
