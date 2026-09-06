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
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(bun run accio:*)',
  'Bash(bun scripts/accio.ts:*)',
] as const

/** `accio sync` and `accio map` write `.state/` and the manifest — denied under the allow above. */
export const ACCIO_WRITE_VERBS = ['Bash(bun run accio sync:*)', 'Bash(bun run accio map:*)', 'Bash(bun scripts/accio.ts sync:*)', 'Bash(bun scripts/accio.ts map:*)'] as const

/** Harness tools that write or reach the network. Never even reach the permission check. */
export const HARNESS_WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'] as const

const linear = (names: ReadonlyArray<string>) => names.map((n) => `mcp__linear__${n}`)

/** The hosted Linear MCP server's read tools — a ticket question is answered from Linear, not relayed. */
export const LINEAR_READ_TOOLS = linear([
  'get_issue',
  'list_issues',
  'list_comments',
  'get_project',
  'list_projects',
  'get_document',
  'list_documents',
  'list_issue_labels',
  'list_issue_statuses',
  'list_users',
  'get_team',
  'get_milestone',
  'list_milestones',
  'search_documentation',
])

/**
 * Everything on that server that writes, plus the diff and release tools, by name (no
 * wildcard, so a rule never matches more than it says). Ask stays read-only: ticket edits
 * are the sweep's ticket pass, sending a point is the Points page.
 */
export const LINEAR_WRITE_TOOLS = linear([
  'save_issue',
  'save_comment',
  'save_document',
  'delete_comment',
  'create_attachment',
  'create_attachment_from_upload',
  'delete_attachment',
  'create_issue_label',
  'save_issue_label',
  'save_project',
  'save_project_label',
  'save_milestone',
  'save_status_update',
  'delete_status_update',
  'share_issue',
  'unshare_issue',
  'mark_notification',
  // diffs
  'get_diff',
  'get_diff_threads',
  'list_diffs',
  'delete_diff_comment',
  'save_diff_comment',
  'merge_diff',
  'resolve_diff_thread',
  'submit_diff_review',
  // releases
  'get_release',
  'get_release_note',
  'list_release_notes',
  'list_release_pipelines',
  'list_releases',
  'save_release',
  'save_release_note',
])

/** The two git read verbs for one checkout path, spelled exactly as the session will type it. */
export const gitReadRules = (checkout: string): Array<string> => [`Bash(git -C ${checkout} log:*)`, `Bash(git -C ${checkout} show:*)`]

/**
 * Every tool name the page may see as a tool-call part: the allowlist, the denied names
 * (a denial arrives as a result on the same part), and the harness tools a run can still
 * name. The `Bash(...)` rules collapse to `Bash`.
 */
export const ASK_TOOL_PART_NAMES: ReadonlyArray<string> = [
  ...new Set([
    ...BASE_TOOLS.map((t) => t.replace(/\(.*$/, '')),
    ...HARNESS_WRITE_TOOLS,
    'LS',
    'TodoWrite',
    // Claude Code loads its deferred tools (the MCP ones included) through this one first.
    'ToolSearch',
    ...LINEAR_READ_TOOLS,
    ...LINEAR_WRITE_TOOLS,
  ]),
]
