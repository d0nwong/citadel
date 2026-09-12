# Plan: forge-debug and the "Bug → Fix" blueprint (CTD-173, slice 2 of CTD-65)

Ticket: CTD-173. Replaces the finished slice-1 plan (in git history at `2644b59`).

## Overview

One new skill, `forge-debug`, takes `forge-plan`'s slot for a bug: reproduce, localise,
reduce, then write `~/plan.md` with a `## Root cause` section first. Everything after it
is the Spec → QA pipeline unchanged, so the reproduction is the first test written red
and the fix is proven against it. The same skill, handed a failing log with no spec and
no later steps, carries the triage through to the fix, a guard test and a commit — the
CTD-170 follow-up case. The bug shape enters through `forge-spec`'s new bug mode (the
reproduction is `C1`, `repro:` joins Commands, no steps and no failing check is Blocked).

## Architecture decisions

- **Debug and implement stay two steps**, as the ticket recommends: localise on fable,
  fix on sonnet. `forge-debug` edits nothing under `/work` in blueprint mode, like
  `forge-plan`; scratch goes under `~/debug/`.
- **The root cause reaches the PR body through the plan.** `forge-verify` opens the
  Summary with the plan's `## Root cause` sentence when it exists. One clause added.
- **Bug mode is explicit in the blueprint** (`/forge-spec bug: {{task}}`) and also
  detected from the ticket (Bug label, reproduction steps, a failing check), so a bug
  ignited on Spec → QA still gets its reproduction as the criterion.
- **Standalone mode inlines the later skills' rules** rather than reading their files:
  a follow-up job has one step and one skill loaded.

## Task list

- T1: `forge-debug` skill (two modes).
- T2: `forge-spec` bug mode; `forge-test` Prove-It line; one clause each in
  `forge-verify` and `forge-implement`.
- T3: `BUG_BLUEPRINT_ID`, migration 0014 via `drizzle-kit generate --custom`, store test
  parametrised over both seeded skill blueprints, README row.
- T4: `foundry build`; prove AC1–AC3 on real jobs and record the ids in the PR body.

## Risks

| Risk | Mitigation |
|---|---|
| A bug the forge cannot reproduce (browser-only) | Step 1 reproduces one level down and says the browser path is unproven; never fixes blind |
| `git bisect` leaves `/work` on a detached commit | The skill names `git bisect reset` in the same line; Red Flag for bisect left in progress |
| Standalone mode edits beyond the cause | "Only the files the root cause names"; a second bug is a Finish line, not an edit |
