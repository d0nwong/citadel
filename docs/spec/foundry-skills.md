# Spec: Foundry role skills and the "Spec → QA" blueprint (CTD-65, slice 1)

Status: draft for review. Intent: `docs/intent/foundry-skills.md` (confirmed 2026-09-12).
Slices 2 and 3 (CTD-170 PR watcher, CTD-171 Designer skill) get their own specs once this lands.

## Objective

Give a forge job a QA pipeline it runs on its own: five Foundry-owned skills, each doing one
role in a headless `claude -p` step, and a seeded blueprint that chains them. When this is done:

- Igniting a job with the "Spec → QA" blueprint on a ticket that has acceptance criteria opens a
  PR whose tests trace one-to-one to a written spec, whose in-forge checks (typecheck, lint, unit
  and integration suite) are green, and whose PR body carries a QA report.
- e2e tests are written into the target repo's existing e2e setup and run in that repo's CI on
  the PR. The forge never boots the app or a browser.
- The skills are reusable: any blueprint step can invoke one, the way "Plan → Execute" could end
  with the verify step.

## Assumptions

1. **Skills are copied and adapted from the addy `agent-skills` plugin, not installed.** The
   plugin's skills enter plan mode, ask questions and wait for approval; a forge step has nobody
   to answer. Each ported skill keeps the checklists and the shape, drops every interactive gate,
   and carries an MIT attribution line to the source skill.
2. **One skill per role, prefixed `forge-`.** Five small skills rather than one skill with
   phases (the way `work` is split), so a step loads only what it needs and a skill can be reused
   in another blueprint. The prefix keeps them clear of the plugin's names and of anything a
   target repo ships in its own `.claude/skills/`.
3. **A step prompt invokes its skill by slash command,** e.g. `/forge-spec` followed by the
   task text. The skill's body is the step's instructions; the blueprint prompt stays one line.
   Verified 2026-09-12 in a throwaway forge on Claude Code 2.1.252: a stub skill under
   `~/.claude/skills/forge-probe/` answered its token to `claude -p "/forge-probe hello"`, and a
   plain prompt did not, so the slash prefix is what loads it. Nothing else today invokes
   `/work` this way (ticket jobs get plain text, the seeded blueprints inline their prompts);
   this blueprint is the first to rely on it.
4. **Handoff between steps is files in `$HOME`, never `/work`.** `~/plan.md` is the existing
   convention; this adds `~/spec.md` and `~/qa-report.md`. The home directory is outside the
   workspace, so the commit sweep can never pick them up.
5. **The forge reads the ticket, not the arch doc.** The Linear MCP server is registered in every
   forge, so `forge-spec` fetches the ticket itself. The arch docs live in the `citadel-data`
   repo, which a forge cannot see. In this slice the arch doc reaches the spec step only if the
   task text inlines it (see Open Questions).
6. **No Acceptance Criteria section stops the job.** Criteria come only from the ticket's
   Acceptance Criteria; the Summary and Scope inform their wording but never add rows. When the
   section is missing or empty, or none of its lines can be grounded, `forge-spec` writes
   `~/spec.md` with a `## Blocked` section and stops. (Decided 2026-09-12 after the first
   ALD-52 run derived eleven criteria from a detailed Summary with the section removed.) Every
   later skill starts by reading `~/spec.md`; on `Blocked` it makes no edits and ends with the
   reason. The job settles as no-changes with the reason in its final message.
7. **e2e means the repo's own e2e runner.** `forge-test` writes e2e tests only where the repo
   already has one configured (Playwright, Cypress or similar found in `package.json`); it never
   adds a runner. `forge-verify` proves those files parse (typecheck, or the runner's `--list`)
   and reports them as CI-run.
8. **The seed follows migration 0007.** A fixed id, `ON CONFLICT DO NOTHING`, plus the v1 row in
   `blueprint_revisions` with `source = 'seed'` that 0008 now requires. The two existing seeded
   blueprints are not touched.
9. **Skills need an image rebuild.** They are `COPY`'d into `/opt/foundry/skills` and synced by
   `box-init` on start; unlike `forge-run.sh` they are not bind-mounted. `foundry build` after
   changing one, and `foundry recreate` for a long-lived forge. Bind-mounting skills into job
   containers is a nice-to-have, not in this slice.

→ Correct any of these now; otherwise they stand.

## Tech stack

- Skills: markdown with YAML frontmatter, as `apps/foundry/image/skills/work/SKILL.md`.
- Blueprint seed: a hand-written SQL migration in `apps/foundry/web/src/db/migrations/`, run by
  drizzle's migrator (`bun run --filter foundry-web db:migrate`), registered in `meta/_journal.json`
  the way 0007 is.
- Tests: `bun test`, Postgres 18 for the migration test (CI already provisions it).
- No new dependencies. No image dependencies.

## Commands

```sh
# foundry web — run from the repo root
bun run --filter foundry-web typecheck
bun run --filter foundry-web check          # ultracite (Biome)
bun run --filter foundry-web fix
bun run --filter foundry-web db:migrate     # needs DATABASE_URL, see justfile
bun run --filter foundry-web test           # migration + store tests need the DB migrated first

# the skills' own test (frontmatter, and that seeded prompts name skills that exist)
bun test apps/foundry/image

# ship the skills into the forge image
apps/foundry/bin/foundry build
apps/foundry/bin/foundry recreate <forge>   # long-lived forges only; job containers are fresh

# manual end-to-end: ignite a job on a sample repo with the "Spec → QA" blueprint from the
# web UI (:3777) or POST /api/jobs with blueprintId 5eeded00-0000-4000-8000-000000000003
```

## Project structure

```
apps/foundry/
  image/
    skills/
      work/SKILL.md                 existing — untouched in this slice
      forge-spec/SKILL.md           ticket + repo → ~/spec.md            (from spec-driven-development)
      forge-plan/SKILL.md           ~/spec.md → ~/plan.md, self-reviewed (from planning-and-task-breakdown
                                                                          + doubt-driven-development)
      forge-test/SKILL.md           ~/spec.md → one test per criterion   (from test-driven-development)
      forge-implement/SKILL.md      ~/plan.md → code, suite green        (from incremental-implementation)
      forge-verify/SKILL.md         review + ~/qa-report.md → PR body    (from code-review-and-quality)
    skills.test.ts                  frontmatter name == directory; seeded prompts reference real skills
    Dockerfile                      unchanged — already COPYs skills/
  web/src/
    db/migrations/
      0013_seed_qa_blueprint.sql    the "Spec → QA" blueprint + its v1 revision
      meta/_journal.json            + entry for 0013
    features/blueprints/
      types.ts                      + QA_BLUEPRINT_ID constant, beside DEFAULT_BLUEPRINT_ID
      server/blueprint-store.test.ts  new: the seed exists, validates, has a seed revision
docs/
  intent/foundry-skills.md
  spec/foundry-skills.md            this file
```

## The skills

Every skill has the same frame, the `agent-skills` one described under Code style, plus a
**Handoff** section naming what it reads and writes and a **Finish** section saying what its
final message must contain. Every skill begins by reading `~/spec.md` when it exists and stops
on `## Blocked`.

| Skill | Reads | Writes | Must not |
|---|---|---|---|
| `forge-spec` | ticket (Linear MCP or task text), repo, `CLAUDE.md`, test setup | `~/spec.md` | edit `/work` |
| `forge-plan` | `~/spec.md`, repo | `~/plan.md` | edit `/work` |
| `forge-test` | `~/spec.md`, `~/plan.md`, repo test setup | test files, fixtures, test config | touch production code |
| `forge-implement` | `~/plan.md`, the failing tests | production code; fixes to tests only when the test is wrong | re-plan; skip a failing test |
| `forge-verify` | `git diff` vs base, `~/spec.md`, the suite | `~/qa-report.md`, `/work/.git/PR_BODY.md`, small fixes | add features; rewrite the plan |

**`~/spec.md` shape** — what `forge-spec` writes and every other skill parses:

```markdown
# Spec: <ticket id> — <title>

## Objective
<one paragraph, the change in the ticket's words>

## Criteria
- C1 — <one observable outcome, worded as the check: the state to set up and what must be observed>
- C2 — …

## Commands
test: <exact command found in the repo>   typecheck: <…>   lint: <…>   e2e: <exact command, or "none configured">

## Out of scope
- <what the ticket says or implies is not this change>

## Assumptions
- <every gap in the ticket, and what was decided>

## Blocked            ← no Acceptance Criteria section, or none groundable
<what the ticket is missing>
```

Criteria carry ids so `forge-test` can name each test after the criterion it pins (`C3: …`) and
`forge-verify` can report coverage per criterion. Where the ticket follows the house format its
`AC1…` lines map straight onto `C1…`.

**`~/qa-report.md` shape** — copied by `forge-verify` into the PR body's "How verified" section:

```markdown
| Criterion | Test | Level | Ran in forge | Result |
|---|---|---|---|---|
| C1 | src/x.test.ts › "C1: …" | unit | yes | pass |
| C4 | e2e/checkout.spec.ts › "C4: …" | e2e | no — runs in CI | written, parses |

Not covered: <criterion and why>. Bugs found and left alone: <…>. Assumptions carried: <…>.
```

## The blueprint

Seeded as "Spec → QA", id `5eeded00-0000-4000-8000-000000000003`, description "Spec the ticket,
test the spec, implement to green, verify and report — the QA default for a ticket with acceptance
criteria." Not the ignite default; "Plan → Execute" keeps that.

| # | name | model | effort | prompt |
|---|---|---|---|---|
| 1 | spec | fable | high | `/forge-spec` + `{{task}}` |
| 2 | plan | fable | high | `/forge-plan` |
| 3 | test | sonnet | — | `/forge-test` |
| 4 | implement | sonnet | — | `/forge-implement` |
| 5 | verify | opus | medium | `/forge-verify` |

Models and efforts are a starting point, editable in the UI like any blueprint. Verify runs on a
different model from implement on purpose (the plugin's multi-model review pattern).

Each prompt is one line plus the `{{task}}` placeholder where the skill needs it; the runner
substitutes it and the session carries everything else. A step that ends on a question ends the
job, so every skill's Finish section ends on a statement.

## Code style

Skills follow the addy `agent-skills` shape, which is what makes them effective: a short **Overview** that states the principle, **When to Use** with a "When NOT to use", a numbered process with one concrete example per step, then **Common Rationalizations** (a two-column table of the excuse and the reality), **Red Flags** and a **Verification** checklist. Two Foundry-specific sections are added to that frame: **Handoff** (what the skill reads and writes, and the `## Blocked` stop) right after When to Use, and **Finish** (what the final message must contain, always a statement) right before Common Rationalizations. Headless constraints are content inside the frame, phrased the way the plugin phrases them: as rationalizations to reject and red flags to catch, not as a separate rulebook.

Prose is unwrapped, one line per paragraph and bullet, the rule `work` documents for itself. Length target is 150–250 lines: shorter than the plugin's originals, which cover interactive use too, but long enough for the examples that make them work. One snippet shows the frame:

```markdown
---
name: forge-test
description: Writes one test per criterion in ~/spec.md, red first, with the repo's own runner. Use as a blueprint step after forge-spec and forge-plan, or whenever a spec exists and its tests do not. Never adds a test framework.
---

# forge-test — tests from the spec

## Overview

Every criterion in the spec becomes a test that fails before the code exists and passes after. A test that passes on first run proves nothing; a criterion with no test is a promise nobody checked. Adapted from `test-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run.

## When to Use

- As the third step of the "Spec → QA" blueprint
- Whenever `~/spec.md` exists and its criteria have no tests yet

**When NOT to use:** no `~/spec.md` (run `forge-spec` first); a task with no behaviour change, such as docs or config only.

## Handoff

Reads `~/spec.md` and `~/plan.md`. Writes test files, fixtures and test config only. If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message.

## Step 1: Find the runner before writing a line

…

## Finish

End with the tests written, keyed by criterion, the exact command that runs them, and which are e2e and will run in CI instead. Never end on a question — nobody answers, and the run ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The criterion is obvious, I'll test it after the code" | Then it tests the implementation, not the behaviour. Red first. |
| "The repo has no e2e runner, I'll add Playwright" | Adding a runner is a dependency decision nobody approved. Write the e2e case as a unit-level test and say so in the report. |
| "I should ask which cases matter most" | Nobody will answer. Cover every criterion; note in Finish which you would have asked about. |

## Red Flags

- A test whose name does not start with a criterion id
- A test that passed on the first run
- A change to a file outside tests, fixtures and test config
- A final message that ends on a question

## Verification

- [ ] Every criterion in `~/spec.md` has at least one test named after it
- [ ] Each test was seen failing before the implement step
- [ ] The suite command in `~/spec.md` runs them
- [ ] No production file changed
```

SQL follows 0007's comment style: say why the id is fixed and why `ON CONFLICT DO NOTHING`. TypeScript follows ultracite; the migration test mirrors `job-api.test.ts`'s real-database setup.

## Testing strategy

- **`apps/foundry/image/skills.test.ts`** (bun, no DB): for every `skills/*/SKILL.md`, the
  frontmatter `name` equals the directory and `description` is non-empty; and every `/forge-…`
  token in `0013_seed_qa_blueprint.sql` names a directory that exists. This is the guard against
  a blueprint step silently running as plain prompt text because its skill was renamed.
- **`blueprint-store.test.ts`** (bun, real Postgres, after `db:migrate`): the QA blueprint row
  exists with five steps; `validate()` accepts it unchanged; its `blueprint_revisions` v1 row has
  `source = 'seed'`; `DEFAULT_BLUEPRINT_ID` still resolves to "Plan → Execute".
- **Manual, once, before merge:** `foundry build`, then ignite a job with the blueprint on a
  small repo with a real test runner and a ticket with acceptance criteria. Read the ledger:
  five steps ran, `~/spec.md` had criteria, tests are named by criterion, the PR body has the
  report. Record the job id in the PR.
- No tests run inside skills' markdown beyond the above; the skills are verified by the job.

## Boundaries

- **Always:** run `typecheck`, `check` and `test` for foundry-web before a commit. Keep handoff
  files under `$HOME`, never `/work`. Give every ported skill its MIT attribution line. Keep every
  skill's Finish section ending on a statement. Add the `_journal.json` entry with the migration.
- **Ask first:** changing the `forge-run.sh` contract or the `UNATTENDED` prompt; editing the
  `work` skill or either existing seeded blueprint; adding anything to the Dockerfile; making
  "Spec → QA" the ignite default; bind-mounting skills into job containers.
- **Never:** install the `agent-skills` plugin into the image; add a browser or an e2e runner to
  the image; let a skill push, open a PR or enter plan mode; put a handoff file in the workspace;
  invent acceptance criteria the ticket does not support.

## Success criteria

1. `bun test apps/foundry/image` and `bun run --filter foundry-web test` pass, including the
   two new test files.
2. A fresh database after `db:migrate` lists three blueprints; a database that already had the
   QA blueprint is unchanged by a second migration run.
3. The manual job above opens a PR where every test's name starts with a criterion id from the
   spec, and the PR body's "How verified" section holds the QA report table.
4. The same job on a ticket with no acceptance criteria settles as no-changes with the missing
   criteria named in its final message.
5. No file under `apps/foundry/image/skills/work/` or the Dockerfile changes in the PR.

## Open questions

1. **Arch doc into the forge.** The spec step wants the feature's arch doc, which lives in the
   data repo. Options: Pensieve inlines it into the task when it ignites a job
   (`apps/pensieve/src/server/foundry.ts`), or Foundry gains a per-job "context" field. Either is
   its own small ticket; this slice reads what the task text carries.
2. **Verify's model.** Opus at medium is a guess at cost versus rigour for a review step.
   Fable would be stricter and pricier; sonnet would share implement's blind spots.
3. **Reusing `forge-verify` in "Plan → Execute".** Appending it there would give every job a
   report, but that blueprint is seeded content a user may have edited. Left alone here.
