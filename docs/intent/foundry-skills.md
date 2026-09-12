# Intent: role skills and a QA blueprint for Foundry (CTD-65)

Confirmed 2026-09-12. This is the first slice of the CTD-65 series; the spec says how.

## Outcome

Foundry-owned Claude Code skills, shipped in the forge image next to `work`, adapted from the
addy `agent-skills` plugin for headless runs — and a QA blueprint that uses them:

1. **spec** — read the Linear ticket (its Acceptance Criteria) and the feature's arch doc, then
   write a testable spec to a handoff file: numbered, checkable criteria.
2. **plan** — write and self-review a plan against the spec. No human gate.
3. **test cases** — one test per criterion, traceable back to the spec. Unit and integration
   tests that can run in the forge; e2e tests written for CI to run.
4. **implement** — follow the plan; run typecheck, lint and the in-forge suite until green.
5. **verify and report** — re-run everything, tighten tests that would pass any implementation,
   and put a QA report in the PR body: what is covered, what is not and why, what the e2e
   tests will check in CI.

## User

The repo owner, igniting unattended forge jobs and wanting the PR that arrives to already be
QA'd.

## Why now

Blueprints work but carry hand-written inline prompts. The `agent-skills` plugin proved the
role-skill pattern in interactive sessions; the leverage is in porting it to headless steps.

## Success

A job ignited from a ticket with acceptance criteria opens a PR whose tests trace to the spec,
whose in-forge checks are green, and whose e2e tests run in CI on the PR.

## Constraints

- Everything runs under headless `claude -p`. Planning is a step that writes and self-reviews a
  plan; no plan mode, no clarifying questions. Open questions become stated assumptions in the
  plan and the PR body, as `work` already does.
- Skills are copied and adapted, not the plugin installed verbatim: its skills assume a person is
  present.
- No browser and no app boot inside the forge image. e2e runs in the repo's CI on the PR.
- Thin acceptance criteria are not invented around: the spec step says what is missing rather
  than making criteria up.

## Out of scope — own tickets in the series

- **Job statuses** (`Ready For QA`, `QA Failed`, `QA Pass`, `PR Ready`) and a paused-for-approval
  state.
- **PR watcher**: polling an open PR from the host and auto-launching the existing follow-up
  job on a submitted review or a failed check, with the failing log as the task. The launch side
  exists today; only the trigger and the log fetch are missing.
- **Designer skill**: a guardian for the target repo's design language. Waits on that repo's FE
  cleanup and a written design-language doc.
