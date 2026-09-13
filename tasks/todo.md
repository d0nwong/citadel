# Todo: CTD-170 — PR watcher

Plan: `tasks/plan.md`.

- [x] **T1: Schema + migrations.** `jobs.follow_up`, `pr_watches`, the "Fix failing check" seed.
- [x] **T2: PR readers.** GitHub via `gh`, Bitbucket via REST; failed-step logs; review bodies in the comments block.
- [x] **T3: Watcher.** Tick, transaction, loop, `FOUNDRY_PR_POLL` / `FOUNDRY_PR_RETRIES` / `FOUNDRY_PR_WATCH=0`.
- [x] **T4: Runner + store.** Check task at preflight; `followUpJob(kind, reason)`; rerun and purge.
- [x] **T5: UI, docs, tests.** Detail sheet trigger label; web README; watcher, parser and seed tests.
- [ ] **T6: Prove on a PR.** AC1 (a review launches one job), AC2 (a red check launches one with the log), AC3 (no double launch), AC4 (retries stop and the ledger says so).
