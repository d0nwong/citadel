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
 *   accio point <group>/<slug>     everything the blackboard holds about one Needs-you point
 *   accio ticket LIA-nn            the same, keyed by ticket (then read the body via Linear MCP)
 *   accio arc <slug>               the running story of one initiative, and what is behind it
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
  point: { module: "./commands/point.ts", blurb: "one Needs-you point: record, report lines, decision, journal, rules, files" },
  arc: { module: "./commands/arc.ts", blurb: "one initiative's running story: where we are, what landed, what is open" },
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
  accio point <group>/<slug>            one Needs-you point (reports/points.json id): record, report
                                        lines, decision, journal entries, rule ids, files + git log
  accio ticket LIA-nn                   open points + journal entries + rule ids for a ticket; the
                                        body is read next with the Linear MCP (no key lives here)
  accio arc [<slug>]                    one initiative's running story (arcs/<slug>.md): frontmatter,
                                        "Where we are", the journal entries, points and tickets its
                                        seeds name; no slug lists every arc and its last rewrite

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

/** `accio list` is `find --list` and `accio ticket X` is `point --ticket X`; anything not a known verb is a search term. */
let command: keyof typeof COMMANDS = "find";
let rest = argv;
if (first in COMMANDS) {
  command = first as keyof typeof COMMANDS;
  rest = argv.slice(1);
} else if (first === "list") {
  rest = ["--list", ...argv.slice(1)];
} else if (first === "ticket") {
  command = "point";
  rest = ["--ticket", ...argv.slice(1)];
}

// spawn rather than import: command files guard on import.meta.main so they stay
// standalone (`bun scripts/commands/sync.ts`), which an import would never trigger
const mod = new URL(COMMANDS[command].module, import.meta.url).pathname;
const proc = Bun.spawnSync([process.execPath, mod, ...rest], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(proc.exitCode ?? 0);
