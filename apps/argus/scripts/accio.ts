#!/usr/bin/env bun
/**
 * accio — summon the API surface of the alden-portal.
 *
 * Answers "which backend endpoint backs this UI element?" from an index built off the
 * backend team's OpenAPI spec joined to the frontend's own AST — routes, imports, calls,
 * render graph, and the words visible on screen.
 *
 *   accio "status select"          summon what backs a thing  (default command)
 *   accio project --in tasks       scope the summon to one feature
 *   accio list                     mapped features
 *   accio map                      derive/refresh the feature manifest from the route tree
 *   accio sync                     refetch the spec, reanalyze, regenerate docs + index
 *   accio audit                    hold the docs to what code and spec actually back
 *
 * Subcommands dispatch by rewriting argv and importing the command module, so each
 * command file also still runs standalone (`bun scripts/commands/sync.ts`).
 */

const COMMANDS = {
  find: { module: "./commands/find.ts", blurb: "summon the APIs behind a component or UI element" },
  map: { module: "./commands/map.ts", blurb: "derive the feature manifest from the route tree" },
  sync: { module: "./commands/sync.ts", blurb: "refetch the spec, reanalyze the frontend, regenerate docs" },
  audit: { module: "./commands/audit.ts", blurb: "check the docs against code and spec" },
  stale: { module: "./commands/stale.ts", blurb: "which features' docs drifted from the code, and why" },
  journal: { module: "./commands/journal.ts", blurb: "day view over per-landing journal entries" },
} as const;

const HELP = `accio — summon the API surface

  accio <what you are looking for>      what backs this thing?
  accio <subject> --in <feature>        scope to one feature (put the PLACE here, not the query)
  accio <endpoint> --endpoints          reverse: which feature calls this endpoint?
  accio list [--in <feature>]           mapped features / one feature's components
  accio map [--dry]                     derive/refresh the feature manifest
  accio sync [--offline|--check|--feature <id>]
  accio audit
  accio stale [--json] [--all]          which features' docs drifted (tiers / fe-core / be-handlers / journal)
  accio journal [YYYY-MM-DD | --day <d> | --since <d>]   day view over landings (default: today)

Examples
  accio "status select"                 → PUT /api/v1/tasks/{taskId}/status/{status}
  accio project --in tasks              → GET /api/v1/projects/entity/{entityId}
  accio tasks/{taskId}/status --endpoints

Name the SUBJECT, not the location: \`accio project --in tasks\` beats
\`accio "task detail project"\`, which ranks the location words above the thing asked about.
`;

const argv = process.argv.slice(2);
const first = argv[0];

if (!first || first === "help" || first === "--help" || first === "-h") {
  console.log(HELP);
  process.exit(first ? 0 : 1);
}

/** `accio list` is `find --list`; anything not a known verb is a search term. */
let command: keyof typeof COMMANDS = "find";
let rest = argv;
if (first in COMMANDS) {
  command = first as keyof typeof COMMANDS;
  rest = argv.slice(1);
} else if (first === "list") {
  rest = ["--list", ...argv.slice(1)];
}

// spawn rather than import: command files guard on import.meta.main so they stay
// standalone (`bun scripts/commands/sync.ts`), which an import would never trigger
const mod = new URL(COMMANDS[command].module, import.meta.url).pathname;
const proc = Bun.spawnSync([process.execPath, mod, ...rest], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(proc.exitCode ?? 0);
