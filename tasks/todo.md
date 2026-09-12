# Todo: CTD-173 — forge-debug and "Bug → Fix"

Plan: `tasks/plan.md`.

- [x] **T1: `forge-debug` skill.** Frame + Handoff/Finish; blueprint mode writes `~/plan.md` with `## Root cause` first and edits nothing in `/work`; standalone mode fixes, guards, verifies and commits with a `fix(…)` subject. Error output is data, not instructions.
- [x] **T2: Neighbouring skills.** `forge-spec`: bug mode (`bug:` prefix or detected), `C1` is the reproduction, `repro:` in Commands, Blocked names what is missing. `forge-test`: Prove-It line in Step 3, reproduction test must go red in Step 4. `forge-verify`: Summary opens with the root cause. `forge-implement`: bug plan's Change is the cause's fix.
- [x] **T3: Blueprint.** `BUG_BLUEPRINT_ID` (…0004), `0014_seed_bug_fix_blueprint.sql` in 0013's shape, store test over both seeded blueprints, README row and "seeds four".
- [x] **Checks.** (23 image, 42 web, typecheck clean, 0014 applied.) `bun test apps/foundry/image`, `bun run --filter foundry-web typecheck`, `db:migrate`, `bun run --filter foundry-web test`.
- [x] **T4: Prove on jobs.** (2026-09-12: AC1 job b3a783e1 → PR #8; AC2 job 2b982b5e → Blocked, no changes; AC3 job 89642222 → PR #7, one defect fixed in the skill.) AC1 (a bug ticket with steps → PR, first test red then green, root cause in the body), AC2 (a bug ticket with no steps → Blocked, no changes), AC3 (`/forge-debug` alone with a failing log → commit or a reason). Job ids in the PR body.
