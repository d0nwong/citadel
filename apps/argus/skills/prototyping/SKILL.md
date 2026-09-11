---
name: prototyping
description: Read a Linear issue and implement it as a prototype — no tests written or run, only TS errors fixed along the way, one build check before the PR, business logic documented inline as it is written. Reuses the repo's design system through its Storybook MCP when one is configured. Use when the user says "prototype <issue>", "spike this", "quick implementation of ARG-N", or wants working code fast without the full test/changeset flow.
---

# prototyping — implement a Linear issue fast, leave the reasoning behind

Prototype Linear issue $ARGUMENTS in the current repo.

This is the lightweight sibling of a full-rigor implementation flow. Same shape — issue in,
PR out — but the gates are swapped: no tests, one build check, and the business rules get
written down in the code as they are decided so the prototype can be hardened later without
re-deriving them.

## Steps

1. **Read the issue.** Use the Linear MCP (`get_issue` with relations) — title, description,
   Acceptance Criteria, comments, and blockers. If the issue is blocked, or has open Pending
   items the code depends on (an unpublished endpoint, an undecided field name), stop and say
   so rather than guessing.

2. **Locate the code.** Identify the files and modules to touch in this repo and read them.
   No plan mode and no plan file — a two-to-three line "here is what I will touch" message to
   the user is enough before starting.

3. **Reuse the design system through the Storybook MCP (UI work only).** If the repo declares
   a `storybook` MCP server (check `.mcp.json`; alden-portal-fe points it at
   `http://localhost:6006/mcp`, served by `@storybook/addon-mcp`), use it before writing any
   new UI so the prototype is composed from existing components, not one-off markup.
   - Confirm it answers. If it does not, tell the user to start it (`bun run storybook`,
     port 6006) and wait until it responds — do not fall back to hand-rolled components
     silently.
   - `get-stories-by-component` finds the existing component and its documented variants and
     props; `get-storybook-story-instructions` gives the repo's story conventions. Compose
     these. If a genuinely new component is unavoidable, say so; add a story alongside it
     only when the repo convention calls for one (a story is documentation, not a test).
   - Never call `run-story-tests` — it is the test runner, and step 5 covers it.
   - No Storybook MCP in this repo: skip this step and read the component directory
     (`src/components` or equivalent) directly instead.

4. **Branch.** From the repo's base branch (`main`, or whatever the repo's own conventions
   name — alden-portal-fe branches from `staging`): if already on it, `git checkout -b`;
   otherwise switch to base, pull, then branch. Use the issue's `gitBranchName` when Linear
   provides one, else `<username>/<key-lower>-<slug>`.

5. **Implement.** Four rules, each stated here and nowhere else:
   - **Write no tests.** Do not add or modify `*.test.*` / `*.spec.*` files, even in repos
     that have them. The ticket's Acceptance Criteria are still the bar: run each as a
     manual check and tick it; one only an automated test could prove stays unticked and is
     named in the PR body as needing a test when hardening.
   - **Run no tests.** Do not invoke `bun test`, any `test:*` script, or any CI test script.
   - **Fix only TS errors during steps.** After each meaningful edit, typecheck — the repo's
     `typecheck` script if it has one, else `bunx tsc --noEmit`, scoped to the package in a
     monorepo. Fix the type errors you introduced. Do not chase lint warnings, formatting, or
     pre-existing TS errors unrelated to the change; note those to the user and move on.
   - **Document business logic along the way.** This is a deliberate exception to the usual
     no-comments default. Wherever the code encodes a business rule — a threshold, an
     ordering, a permission decision, an edge case the ticket implies — leave a one-line
     comment stating the rule and its source (the ticket, a Slack decision, a product doc).
     Not what the code does; which rule it enforces and why. These comments are what survives
     when the prototype is hardened.

   Keep the engineering defaults that cost nothing in a prototype: DRY, handle empty and
   unpaired states, no unreachable guards. Production-only concerns (parallelising async
   work, eliminating redundant DB queries) are out of scope — mention them in the PR as
   "worth doing when hardening" if you notice them.

6. **Format** only the files you changed (`bunx prettier --write <files>`) if the repo has a
   prettier config. Never repo-wide.

7. **Final build check before PR.** Run the repo's build — `bun run build`, or the
   package-scoped equivalent. This must pass; it is the one gate. If it fails on something
   pre-existing and unrelated to your change, report it and ask before proceeding.

8. **Commit** with the issue key in the message (e.g. `ARG-82: short description`).

9. **Confirm with the user** — "Happy with the prototype?"
   - Yes → open the PR. Title carries the issue key. Body: what was built, the business-logic
     comments rolled up as bullets, the ticket's Acceptance Criteria copied with the
     manually-checked ones ticked, and an explicit "Prototype — no tests" line so reviewers
     know the bar.
   - No → ask what to change and return to step 5.

## Not this skill

Production-grade work — tests written and run, CI green, changesets, migrations — is a
different flow. `prototyping` is for spikes, demos, and nav-hidden prototype pages, where
domain mismatches and mock data are expected iteration rather than findings. If the issue
asks for something that must ship behind a release gate, say so and stop.
