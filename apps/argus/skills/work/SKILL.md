---
name: work
description: Read a Linear issue and implement it
---

Implement Linear issue $ARGUMENTS:

1. Read the full issue using the Linear MCP tool — title, description, acceptance criteria, and comments
2. Identify which service(s) under `services/` and/or packages under `packages/` need to change
3. **Enter plan mode now** — call the `EnterPlanMode` tool immediately if not already in plan mode. Then explore the relevant code and draft a concrete implementation plan with file paths. Once the plan is written, run `/audit-plan` before exiting plan mode: identify the key assumptions in the plan, verify what you can by reading files directly, then use `AskUserQuestion` to resolve the rest interactively. Update the plan file with the confirmed information before calling ExitPlanMode.
4. **Before writing any code — create the working branch**:
   - If on `main`: create the branch now (`git checkout -b <branch-name>`)
   - If not on `main`: `git checkout main && git pull origin main`, then create the branch
   - Branch name format: `<your-username>/pul-<number>-<short-description>`
5. Implement — applying these standards throughout:
   - **DRY**: if a shape, value, or pattern appears twice, extract it first
   - **Parallelise** independent async operations with `Promise.all`
   - **No redundant DB queries**: pass pre-fetched data down rather than re-querying in the same transaction
   - **Named destructured params** for any function with 2+ related arguments
   - **Handle all lifecycle states**: consider fresh/unpaired/empty entities, not just the happy path
   - **Return values over mutation**: prefer pure functions; document when mutation is chosen for perf
   - **Full data contract**: understand what the caller/consumer reads — don't return empty for relied-upon fields
   - **No unreachable guards**: only add null checks that can actually trigger given the preceding logic
6. Format only the files you changed: `bunx prettier --write <file1> <file2> ...` — never run `bun run fmt` globally as it reformats the entire repo
7. Write or update `bun test` tests that verify each acceptance criterion
   - Unit tests: `bun --filter <service> test:unit`
   - Integration tests: **must be run from inside the service directory** — integration tests resolve path aliases against `dist/`, so build first:
     `cd services/<service> && bun run build && bun run test:integration`
8. **Before pushing — run ci:test from inside the service directory and fix any failures**:
   `cd services/<service> && bun run ci:test`
   This runs unit + integration combined. Do not push until this passes. Never skip this step.
9. **Version bump** — run the `/changeset` skill to generate a `.changeset/*.md` file for the
   affected packages. It picks the bump level per package (`major`/`minor`/`patch`) from the
   nature of the change and writes the frontmatter + summary. Do **not** run
   `bun --filter <name> version <bump>` — versioning goes through changesets, which the release
   flow consumes. After it runs, confirm to the user which modules were bumped and why.

10. Commit with the issue number in the message (e.g. "PUL-123: description")
11. Ask the user: "Are you happy with the changes?"
    - **Yes → Create PR**: Create a GitHub pull request
    - **No → Request changes**: Ask what they'd like changed and go back to step 5
12. If the changes contain database migrations, check if the `database/RLS_ROLES.md` needs an update due to policy/role/RLS changes.
