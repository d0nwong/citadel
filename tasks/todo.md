# Todo: Foundry role skills and the "Spec → QA" blueprint (CTD-65, slice 1)

See `tasks/plan.md` for the order and the checkpoints. Branch: `yickkiuleung/ctd-65-create-skills`.

## Phase 1: De-risk and foundation

- [x] **T1: Prove a `claude -p` prompt starting with `/forge-probe` loads a user-scope skill in a forge.** (S)
  - Acceptance: a throwaway skill `~/.claude/skills/forge-probe/SKILL.md` in a running forge whose body says "reply with exactly FORGE-SKILL-LOADED and nothing else"; `claude -p "/forge-probe hello" --output-format json` replies with that token. If it does not, the fallback (forge-run.sh inlining the skill body) is written into the spec's assumption 3 and raised before T3.
  - Verify: the command above, run with `foundry exec <forge> …` or inside `foundry shell`; result recorded in `docs/spec/foundry-skills.md` assumption 3.
  - Files: `docs/spec/foundry-skills.md`. The stub skill is not committed.
  - Done 2026-09-12: forge `ctd65-probe` on Claude Code 2.1.252 returned FORGE-SKILL-LOADED for the slash prompt and "pong" for the control; forge removed. No forge-run.sh change needed.
- [x] **T2: Guard test for the image's skills.** (S)
  - Acceptance: `apps/foundry/image/skills.test.ts` asserts, for every `skills/*/SKILL.md`: frontmatter `name` equals the directory, `description` is non-empty; and for every directory named `forge-*`: the headings Overview, When to Use, Handoff, Finish, Common Rationalizations, Red Flags, Verification are present in that order. A second test reads every `db/migrations/*.sql`, collects `/forge-[a-z-]+` tokens, and asserts each names a directory. Runs with no database.
  - Verify: `bun test apps/foundry/image` green against `work` alone (the forge-* checks vacuously pass; the seed check finds no tokens yet).
  - Files: `apps/foundry/image/skills.test.ts`.
- [x] **T3: `forge-spec` skill.** (M)
  - Acceptance: `apps/foundry/image/skills/forge-spec/SKILL.md` in the agent-skills frame, adapted from `spec-driven-development` with MIT attribution. Reads the ticket via the Linear MCP when the task names one, else the task text; finds the repo's test, typecheck, lint and e2e commands; writes `~/spec.md` in the spec's shape with `C1…Cn` criteria; writes `## Blocked` instead when no criterion can be grounded; edits nothing in `/work`. Rationalizations table includes "I'll ask what they meant", "I'll add a reasonable criterion they forgot" and "no e2e runner, I'll assume Playwright". 150–250 lines.
  - Verify: T2 green; read against the `~/spec.md` shape in the spec.
  - Files: `apps/foundry/image/skills/forge-spec/SKILL.md`.

## Checkpoint: Foundation

- [x] T1 answered and recorded; T2 green; `forge-spec` read end to end for both the criteria path and the Blocked path.

## Phase 2: The remaining skills

- [x] **T4: `forge-plan` skill.** (M)
  - Acceptance: adapted from `planning-and-task-breakdown` and the reviewer half of `doubt-driven-development`. Reads `~/spec.md` (stops on Blocked); explores the code each criterion touches; writes `~/plan.md` with files to touch, order, the test command, and one line per criterion saying where it will be satisfied; then re-reads it as a sceptical reviewer in the same turn and fixes it; edits nothing in `/work`. Never enters plan mode.
  - Verify: T2 green; every criterion id in the spec shape has a line in the plan template.
  - Files: `apps/foundry/image/skills/forge-plan/SKILL.md`.
- [x] **T5: `forge-test` skill.** (M)
  - Acceptance: adapted from `test-driven-development`. Reads `~/spec.md` and `~/plan.md`; uses the runner named in the spec; one test per criterion named `C<n>: <behaviour>`; runs the suite once and lists the red names in Finish; e2e tests only into an existing e2e runner, else the case is written at the level the repo can run and the report says so; touches tests, fixtures and test config only.
  - Verify: T2 green; the Handoff section quotes what `forge-plan`'s Finish produces.
  - Files: `apps/foundry/image/skills/forge-test/SKILL.md`.
- [x] **T6: `forge-implement` skill.** (M)
  - Acceptance: adapted from `incremental-implementation`. Reads `~/plan.md` and the red test list; implements one criterion at a time to green; fixes a test only when the test contradicts the spec, and says so; runs typecheck, lint and the suite before finishing; never re-plans beyond what the code forces; never skips or deletes a failing test.
  - Verify: T2 green.
  - Files: `apps/foundry/image/skills/forge-implement/SKILL.md`.
- [x] **T7: `forge-verify` skill.** (M)
  - Acceptance: adapted from `code-review-and-quality`. Reviews `git diff <base>..HEAD` on the five axes; runs the suite, typecheck and lint once more; proves e2e files parse; tightens or deletes a test that would pass any implementation; writes `~/qa-report.md` in the spec's table shape and `/work/.git/PR_BODY.md` from the repo's PR template or foundry's, with the report under "How verified" and a `Closes <ticket>` line; small fixes only, no features.
  - Verify: T2 green; the PR body section list matches `apps/foundry/image/pr-template.md`.
  - Files: `apps/foundry/image/skills/forge-verify/SKILL.md`.

## Checkpoint: Skills

- [x] Read all five in order as one run; every Finish ends on a statement; every Blocked path stops with no edits; T2 green.

## Phase 3: The blueprint

- [x] **T8: `QA_BLUEPRINT_ID` and migration 0013.** (S)
  - Acceptance: `QA_BLUEPRINT_ID = '5eeded00-0000-4000-8000-000000000003'` in `features/blueprints/types.ts` beside `DEFAULT_BLUEPRINT_ID`, with a comment saying it is not the ignite default. Migration generated with `bun run --filter foundry-web db:generate -- --custom --name seed_qa_blueprint` (journal entry and snapshot copy come with it), SQL written in 0007's style: the five steps from the spec's table, `ON CONFLICT DO NOTHING`, and an `INSERT` of the v1 `blueprint_revisions` row with `source = 'seed'` and note "Shipped with CTD-65.", also `ON CONFLICT DO NOTHING`. `DEFAULT_BLUEPRINT_ID` unchanged.
  - Verify: `db:migrate` twice on the local DB; `psql` shows three blueprints and one revision for the new id; T2's seed check passes.
  - Files: `apps/foundry/web/src/features/blueprints/types.ts`, `apps/foundry/web/src/db/migrations/0013_seed_qa_blueprint.sql`, `meta/_journal.json`, `meta/0013_snapshot.json`.
- [x] **T9: Blueprint store test.** (S)
  - Acceptance: `features/blueprints/server/blueprint-store.test.ts` against the real DB (header as `job-api.test.ts`): `getBlueprintRow(QA_BLUEPRINT_ID)` returns five steps whose prompts start with `/forge-`; `validate()` returns them unchanged; the revision list for that id has one entry with `source === 'seed'`; `getBlueprintRow(DEFAULT_BLUEPRINT_ID)` is still "Plan → Execute".
  - Verify: `bun run --filter foundry-web test` green after `db:migrate`.
  - Files: `apps/foundry/web/src/features/blueprints/server/blueprint-store.test.ts`.
- [x] **T10: README.** (S)
  - Acceptance: the blueprints table in `apps/foundry/README.md` gains the "Spec → QA" row, and the `/work` paragraph mentions the five `forge-*` skills in one sentence. `just migrate seeds two` becomes three.
  - Verify: read.
  - Files: `apps/foundry/README.md`.

## Checkpoint: Complete

- [x] `bun run --filter foundry-web typecheck && bun run --filter foundry-web test && bun test apps/foundry/image` green (2026-09-12: typecheck clean, 38 + 19 pass). `check` is red on main already — 1244 pre-existing ultracite errors, and CI does not run it — so the new files match the surrounding style rather than the linter.

## Phase 4: Prove it on a job

- [x] **T11: Two real jobs.** (M)
  - Acceptance: `foundry build`; ignite with "Spec → QA" on a small repo with a real runner and a ticket with acceptance criteria: five steps ran, tests are named by criterion, the PR body carries the report table. Second job on a ticket with no criteria: settles no-changes, final message names what is missing. Both job ids in the PR body under "How verified".
  - Verify: the ledger and the PR.
  - Files: none in the repo beyond the PR body.
  - Done 2026-09-12:
    - CTD-172 on citadel@main, job `a8518064` — 24 min, five steps, PR https://github.com/d0nwong/citadel/pull/4: 10 files, tests named `C1…C5`, C6 documentation-only, QA table in the PR body, 148 pass. Verify reverted the `linearSources()` wiring, saw the suite stay green, and added a guard test. Conflicts with `bc79b77` (the team rename committed on this branch) once both merge.
    - ALD-52 on alden-portal-fe@staging, first run job `9b33f72b` — cancelled at the plan step after the spec step derived 11 criteria from the Summary with the AC section removed; led to the "no AC section → Blocked" rule (`57d15d4`).
    - ALD-52 re-run job `953c8536` on the rebuilt image — 3 min, Blocked at step 1, every later step made no edits, settled succeeded with no changes and the missing criteria named.
