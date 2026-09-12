# Plan: Foundry role skills and the "Spec → QA" blueprint (CTD-65, slice 1)

Spec: `docs/spec/foundry-skills.md`. Intent: `docs/intent/foundry-skills.md`.
Replaces the finished consolidation plan (in git history at `1c362a3`).

## Overview

Five skills go into the forge image, one seeded blueprint chains them, two tests guard the
seams. The one thing that could change the shape of every skill is whether a headless
`claude -p` prompt starting with `/forge-spec` actually loads the skill, so that is checked
first with a stub. Skills are then written in pipeline order, because each one's Handoff
section is the next one's input. The blueprint seed comes last, since its prompts name the
skills and the guard test cross-checks them. Nothing here touches `work`, the two existing
seeded blueprints, `forge-run.sh` or the Dockerfile.

## Architecture decisions

- **Skill invocation is by slash command in the step prompt.** If T1 shows `claude -p` does
  not expand a user-scope skill, the fallback is a small addition to `forge-run.sh`: when a
  step prompt starts with `/<name>` and `~/.claude/skills/<name>/SKILL.md` exists, prepend the
  file body. That is an ask-first change per the spec, so T1 reports back before anything
  else is written.
- **Skill frame is the `agent-skills` one** (Overview, When to Use, numbered steps with
  examples, Common Rationalizations, Red Flags, Verification) plus Handoff and Finish. A
  shared reference file `apps/foundry/image/skills/FRAME.md` is not created: five files is
  few enough to keep in step by hand, and the guard test checks the section headings.
- **Handoff files live in `$HOME`**: `~/spec.md`, `~/plan.md`, `~/qa-report.md`. Criteria carry
  ids `C1…Cn`; tests are named `C3: …`; the report is a per-criterion table.
- **The migration is generated with `drizzle-kit generate --custom`** so the journal entry
  and the snapshot copy match what 0007 got, then the SQL is written by hand in 0007's style.
- **Verify runs on opus, medium.** Different model from implement, on purpose. Editable.

## Task list

### Phase 1: De-risk and foundation

- T1: Prove slash-command skill loading under `claude -p` in a forge (stub skill).
- T2: Guard test for skills: frontmatter, section headings, seed prompts name real skills.
- T3: `forge-spec` skill.

### Checkpoint: Foundation

T1 answered either way and recorded in the spec. T2 runs green against `work` and
`forge-spec`. `forge-spec` read end to end against the frame and the `~/spec.md` shape in
the spec. Both `~/spec.md` paths exercised in thought: criteria found, and `## Blocked`.

### Phase 2: The remaining skills

- T4: `forge-plan` skill.
- T5: `forge-test` skill.
- T6: `forge-implement` skill.
- T7: `forge-verify` skill.

### Checkpoint: Skills

Read the five in pipeline order as one run would: every file a skill reads is written by an
earlier one; every Finish ends on a statement; every Blocked path stops with no edits. T2
green.

### Phase 3: The blueprint

- T8: `QA_BLUEPRINT_ID` constant and migration 0013 with its revision row.
- T9: Blueprint store test against the real database.
- T10: README: the blueprints table and the skills paragraph.

### Checkpoint: Complete

`bun run --filter foundry-web typecheck`, `check`, `db:migrate`, `test`, and
`bun test apps/foundry/image` all green. Then T11.

### Phase 4: Prove it on a job

- T11: `foundry build`, ignite a job with "Spec → QA" on a small repo with a real runner and a
  ticket with acceptance criteria; a second job on a ticket with none. Record both job ids in
  the PR body.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `claude -p "/forge-spec …"` does not load the skill | T1 first; fallback inlines the skill body in forge-run.sh (ask first) |
| Skills too long for a step's context, or too short to be effective | 150–250 lines each; T11 is the real measure, and the second job run reads the ledger for lost instructions |
| `forge-test` cannot make a test fail red because implement has not run | It runs the suite once, records the failing names in its Finish, and `forge-implement` starts by re-running them |
| The e2e runner detection is wrong for a repo | `forge-spec` writes the exact e2e command into `~/spec.md` or "none configured"; every later skill trusts that line, so one place to fix |
| A user has already hand-made a blueprint named "Spec → QA" | `ON CONFLICT DO NOTHING`, as 0007; the seeded row is then simply absent and the store test says so |
| Migration test needs a migrated DB | Same as `job-api.test.ts`: `just up postgres`, `db:migrate`, documented in the test header |

## Open questions

Carried from the spec, none blocking: arch doc into the forge (Pensieve inlines it, own
ticket); verify's model; whether "Plan → Execute" should gain a verify step.

## Parallelization

T4–T7 could be written in parallel once T3 fixes the `~/spec.md` shape, but each one's
Handoff quotes the previous one's Finish, so sequential is safer and the files are small.
T8 and T10 do not depend on the skills' text, only their names, and can go alongside T5–T7.
