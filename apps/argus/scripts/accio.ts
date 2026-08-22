#!/usr/bin/env bun
/**
 * accio — summon the API surface of the alden-portal.
 *
 * Answers "which backend endpoint provides the data for this component?" from docs
 * generated out of the backend team's OpenAPI spec and the frontend's own import graph.
 *
 *   accio "status select"          summon what backs a thing  (default command)
 *   accio project --in tasks       scope the summon to one feature
 *   accio sync                     refetch the spec and regenerate every api.md
 *   accio list                     every mapped component
 *
 * Subcommands dispatch by rewriting argv and importing the command module, so each
 * command file also still runs standalone (`bun scripts/commands/sync.ts`).
 */

const COMMANDS = {
  find: { module: "./commands/find.ts", blurb: "summon the APIs behind a component or UI element" },
  sync: { module: "./commands/sync.ts", blurb: "refetch the OpenAPI spec, diff it, regenerate every api.md" },
} as const;

const HELP = `accio — summon the API surface

  accio <what you are looking for>      what backs this thing?
  accio <subject> --in <feature>        scope to one feature (put the PLACE here, not the query)
  accio <endpoint> --endpoints          reverse: which component calls this endpoint?
  accio list                            every mapped component
  accio sync [--offline|--check]        regenerate the docs
  accio sync --project <name>           regenerate one feature

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

process.argv = [process.argv[0], process.argv[1], ...rest];
await import(COMMANDS[command].module);
