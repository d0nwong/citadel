# Plan: forge-simplify and the "Simplify" blueprint (CTD-175, slice 4 of CTD-65)

Ticket: CTD-175. Stacked on the skills trim (PR #12) and CTD-174 (PR #10).

## Overview

A refactor ticket's criteria are that behaviour is unchanged and the named complexity is
gone. `forge-spec` gains a refactor mode (`C1` the unchanged suite with the base count, one
`C<n>` per named simplification, Blocked when nothing is named); `forge-simplify` checks why
each piece exists, writes `~/plan.md`, then removes what the ticket names one change at a
time with the suite as the oracle and never touches a test; `forge-verify` reads a refactor
diff for whether the reader holds fewer concepts and names the one simplification left
unmade. Seeded as "Simplify": spec → simplify → verify.

## Architecture decisions

- **Survey is `forge-spec`, not a first half of `forge-simplify`** (the ticket's
  recommendation): one writer of `~/spec.md`.
- **`forge-simplify` writes `~/plan.md`** before editing, in the plan's shape, so verify's
  Handoff and the guard test's heading contract hold; `Not doing` is where the deliberately
  unmade simplification lives, and the PR body's Summary carries it.
- **A change that would need a test to change is reverted, not the test** — the rule from
  `forge-implement`, inherited verbatim.

## Task list

- T1: `forge-simplify` skill (trimmed anatomy, ~1,000 words).
- T2: `forge-spec` refactor mode; `forge-verify` whole-diff readability line and the
  `Not doing` line in the Summary.
- T3: `SIMPLIFY_BLUEPRINT_ID` (…0005), migration 0016, store test row, README row.
- T4: `foundry build`; prove AC1 and AC2 on one Simplify job against a citadel refactor
  ticket that names two real simplifications and one that is a behaviour change in disguise.
