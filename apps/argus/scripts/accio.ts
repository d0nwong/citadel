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
 * The API surface and the arch docs are all of it. Where the work stands is each
 * feature's `ledger.json`, kept by `argus`.
 *
 * Subcommands dispatch by rewriting argv and importing the command module, so each
 * command file also still runs standalone (`bun scripts/commands/sync.ts`).
 */

const COMMANDS = {
  find: { module: "./accio/find.ts", blurb: "summon the APIs behind a component or UI element" },
  map: { module: "./accio/map.ts", blurb: "derive the feature manifest from the route tree" },
  sync: { module: "./accio/sync.ts", blurb: "refetch the spec, reanalyze the frontend, regenerate docs" },
  audit: { module: "./accio/audit.ts", blurb: "check the arch docs against code and spec, and every ledger" },
  stale: { module: "./accio/stale.ts", blurb: "which features' docs drifted from the code, and why" },
} as const;

const HELP = `accio — summon the API surface

  accio <what you are looking for>      what backs this thing?
  accio <subject> --in <feature>        scope to one feature (put the PLACE here, not the query)
  accio <endpoint> --endpoints          reverse: which feature calls this endpoint?
  accio list [--in <feature>]           mapped features / one feature's components
  accio map [--dry]                     derive/refresh the feature manifest
  accio sync [--offline|--check|--feature <id>]
  accio audit [--area <id>]
  accio stale [--json] [--all] [--area <id>]   which features' docs drifted (tiers / fe-core / be-handlers / journal)

accio is the API surface and the docs. Where the work stands is a feature's record:
\`argus show <feature>\`, or Pensieve's feature page.

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

/**
 * Four verbs accio no longer answers. A pointer, not a search result: someone typing
 * `accio arc` wants where the work stands, and the answer is one command away. They went
 * to `marauder` in CTD-161 and came back to the ledger when marauder was retired (79e3e79).
 */
const MOVED: Record<string, [command: string, why: string]> = {
  journal: ["argus show <feature>", "what changed is on the record of the feature it changed"],
  point: ["argus tracker list --mine", "what needs you; Pensieve shows the rest"],
  ticket: ["argus show <feature>", "a ticket is on the record of the feature it is about now"],
  arc: ["argus show <feature>", "an arc is a feature's record now"],
};
if (first in MOVED) {
  const [command, why] = MOVED[first]!;
  console.error(`accio no longer answers \`${first}\` — ${why}: \`bun run ${command}\``);
  process.exit(1);
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
