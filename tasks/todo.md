# Todo: CTD-175 — forge-simplify and "Simplify"

Plan: `tasks/plan.md`.

- [x] **T1: `forge-simplify` skill.** Chesterton's fence, plan first, one change at a time, suite as oracle, never a test.
- [x] **T2: Neighbouring skills.** `forge-spec` refactor mode (`refactor:` prefix or a ticket naming files and what to remove; C1 unchanged suite; Blocked when nothing named). `forge-verify` whole-diff readability for a refactor; Summary names the `Not doing` line.
- [x] **T3: Blueprint.** `SIMPLIFY_BLUEPRINT_ID`, migration 0016, store test row, README row and "seeds five".
- [x] **Checks.** (57 image, store 12 pass, typecheck clean.) `bun test apps/foundry/image`, store test after `just migrate`, typecheck.
- [x] **T4: Prove on a job.** (2026-09-12: job a1c54410 → PR #14 made the disguised change, fixed in the skills; rerun b0327f27 → PR #15 left it unmade.) Simplify on the citadel refactor ticket: AC1 (same suite count, no test changed, PR body names each simplification and one left), AC2 (the disguised behaviour change left unmade with why).
