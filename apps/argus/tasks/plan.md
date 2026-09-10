# Implementation Plan: Argus and Pensieve, rebuilt around the ledger

Spec: `SPEC.md`. Tasks: `tasks/todo.md`. Written 2026-09-10.

## Overview

Replace the event-and-queue machinery with one `ledger.json` per feature, a small `argus`
CLI whose verbs are the only writers, a run skill that pulls Slack and landings, joins
what code can join, and has a model rewrite each affected ledger whole. Pensieve renders
the ledger and calls the verbs. Nothing is deleted until the new run has produced a
ledger the user trusts.

## Architecture Decisions

- **The ledger is written whole, by one verb.** `argus write` validates and replaces the
  file. There is no partial update path, so there is no merge logic and no lock. Pensieve
  and the sweep never hold the file open across a model call.
- **Validation is the policy.** Evidence on every claim, the style rules, the caps and
  the id scheme are code in `validate.ts`, so the skills do not have to say them. A
  skill line exists only where the model has to judge.
- **Two deterministic joins, nothing more.** Changed files to features through the
  manifest, replies to their thread root through `state/threads.json`. Ticket keys and PR
  numbers in text join to the ledger that lists them. Everything else is the model's
  call or unplaced. No vocabulary, no aliases beyond the manifest.
- **Unplaced is a state, not a failure.** `place` writes `state/unplaced.json`; the sweep
  reads it once with the feature summaries; whatever is left is Pensieve's list. A click
  runs `argus place <id> <feature>` and records the thread.
- **The eval harness runs the real prompts.** `evals/replay.ts` calls `claude -p` with
  `reader.md` over recorded batches, so a change to the prompt is measured the same way a
  change to `place.ts` is.
- **Pensieve reads files and spawns the CLI.** `src/server/ledger.ts` reads, `src/server/argus.ts`
  writes by spawning `bun scripts/argus.ts <verb>` in `WORKSPACE_DIR`. Nothing else in
  Pensieve touches the checkout.
- **Salvage by moving, not copying.** `slack-pull.ts` and `pr-facts.ts` move with their
  tests under `scripts/argus/`, lose their `marauder` and `queue/` couplings, and keep
  everything else.
- **Seed, do not migrate.** Requirement rows come from each `product.md`'s BR table with
  the mechanism column dropped, status `assumed`, code pointer from the Source column.
  Journal entries are not converted; the ask ledger starts from the 14-day replay.

## Dependency graph

```
schema.ts
  ├── validate.ts ── write.ts ── argus.ts (CLI) ── click verbs (close, confirm, place, ticket)
  │                                   │
  │                                   ├── seed.ts ──────────── all ledgers
  │                                   ├── file / send verbs ── Pensieve Ready + proposals
  │                                   └── Pensieve server/argus.ts ── home + feature page + Ask tools
  ├── slack-pull.ts ─┐
  └── pr-facts.ts ───┴── pull.ts ── place.ts ── evals/replay.ts ── reader.md ── sweep SKILL.md
                                       │
                                       └── state/unplaced.json ── Pensieve Unplaced
```

## Task List

### Phase 0: Freeze
- [x] Task 1: Tag, branch, commit the spec and plan

### Phase 1: Schema and verbs
- [x] Task 2: Ledger types, JSON schema, fixtures
- [x] Task 3: Validator with a refusal fixture per rule
- [x] Task 4: Read and write with id allocation and no-op detection
- [x] Task 5: The `argus` CLI skeleton, `bin`, `bun link`
- [x] Task 6: Click verbs: close, confirm, place, ticket

### Checkpoint: Foundation
- [x] `bun test` green, `bun run typecheck` clean
- [x] `argus validate` refuses every fixture violation by path
- [x] `argus write` on an unchanged ledger writes no byte
- [ ] Review with the user

### Phase 2: Pull, place, replay
- [x] Task 7: Move `slack-pull.ts` under `scripts/argus/`, cursor to `state/`
- [x] Task 8: Move `pr-facts.ts` under `scripts/argus/`, features from the manifest lib
- [x] Task 9: `argus pull` writes one batch file
- [x] Task 10: `argus place <batch>` does the deterministic joins
- [~] Task 11: Record 14 days of fixtures; the user places the expectations once (fixtures recorded, 129 roots await the user)
- [x] Task 12: `bun run evals` scores deterministic attribution

### Checkpoint: Deterministic attribution
- [x] A batch replays to the same per-feature split twice
- [x] The deterministic score is printed and written to `evals/scores.md` (45% before any thread is learned)
- [ ] Review with the user: is the unplaced list the size we expected?

### Phase 3: The reader
- [x] Task 13: `reader.md`, the rewrite subagent's prompt and rules
- [x] Task 14: Seed `admin/invoicing` and `admin/usage` ledgers
- [ ] Task 15: Model attribution and rewrite in the replay harness
- [ ] Task 16: Closure cases and the gate

### Checkpoint: The gate
- [ ] Attribution ≥ 0.8 on the 14-day replay
- [ ] Due-on-invoice closes on the acknowledgement; two more named cases pass
- [ ] A ticket with a `landing` blocker flips ready on the landing's batch
- [ ] The user reads both ledgers and says the story is one they would give
- [ ] If any line above fails, the design changes here. Nothing below starts.

### Phase 4: Seed and docs
- [ ] Task 17: Seed every feature's ledger
- [ ] Task 18: `feature-docs` becomes arch-only under the caps
- [ ] Task 19: Trim `accio` to find, stale, sync for the arch tier
- [ ] Task 20: Bring every `arch.md` under 250 lines

### Checkpoint: Every feature validates
- [ ] `argus validate` passes for every feature
- [ ] `accio stale` reports nothing after Task 20
- [ ] The user bulk-confirms one feature with `argus confirm <feature> --all`

### Phase 5: Pensieve
- [ ] Task 21: `server/ledger.ts` reads ledgers and derives on-you, ready, unplaced
- [ ] Task 22: `server/argus.ts` spawns the CLI
- [ ] Task 23: Home: Needs-me, Ready, Unplaced
- [ ] Task 24: Feature page: the five questions, requirements, asks, tickets, landings
- [ ] Task 25: Ask over the ledger

### Checkpoint: Stories 1, 2, 5, 6, 7
- [ ] Each passes by hand in the browser against the seeded ledgers
- [ ] Pensieve `bun test`, `typecheck`, `check` clean

### Phase 6: Tickets
- [ ] Task 26: Proposals and `argus file` / `argus ticket`
- [ ] Task 27: Blockers, the deploy check, ready
- [ ] Task 28: `argus send` and the Send button

### Checkpoint: Stories 3 and 8
- [ ] A proposal files to Linear and its key lands on the ledger
- [ ] A `landing` blocker clears from a real `origin/dev` merge plus the swagger check
- [ ] Send reaches Foundry with the ticket key as the idempotency key

### Phase 7: Retire
- [ ] Task 29: Rewrite the sweep skill under 120 lines in the agreed shape
- [ ] Task 30: Delete the retired list in argus
- [ ] Task 31: Rewrite README and CLAUDE.md
- [ ] Task 32: Delete the retired routes and server code in Pensieve
- [ ] Task 33: One full `/sweep` on a copy, then merge and run for real

### Checkpoint: Complete
- [ ] `git grep marauder` empty outside `docs/`
- [ ] Every skill under its cap; the cap test is green
- [ ] `bun run sweep` runs a working day with no false Needs-me

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Attribution below 0.8 on the replay | High: the Unplaced list becomes the board again | Phase 3 gate before any Pensieve work; the fallback is a richer per-feature summary in the prompt, then a manifest change, never vocabulary |
| The model closes asks that are not closed | High: a false close hides a promise | Closure needs an acknowledgement from the asker or the team, quoted in evidence; the eval names cases that must stay open as well as ones that must close |
| Ledger plus batch exceeds one affordable call | Medium | Measure in Task 15 on the busiest day; if over, the reader gets asks and requirements only, and landings by reference |
| Slack canvases (huddle notes) need a scope the token lacks | Medium: meetings vanish from the trail | `slack-pull` already fetches them; Task 7 keeps that path and tests it against a real canvas |
| The deploy check has no clean signal | Medium: ready flips late or never | Task 27 reads the dev swagger's build sha; if absent, a `deployed` flag the user sets on the ticket is the fallback |
| `ask.ts` in Pensieve is 1,100 lines coupled to marauder tools | Medium | Task 25 retargets the tool list and allowlist only; the adapter and persistence stay |
| The user's time to place 14 days of expectations | Low, but on the critical path | Task 11 pre-fills from the deterministic joins and the old `work.json` attachments; the user corrects rather than fills |
| Two checkouts share a working tree with the sweep committing | Medium | All work on `rebuild/ledger`; the old sweep loop is stopped for the duration |

## Parallelization

- Tasks 2 to 6 and Tasks 7 to 10 are independent until Task 10 reads ledgers.
- Tasks 21 and 22 can start on fixtures once Phase 1 is done.
- Tasks 18 and 19 are independent.
- Everything in Phase 3 is sequential and gated.

## Open Questions

- Which two closure cases beyond Due-on-invoice the user names for Task 16.
- Whether the dev swagger exposes a build sha (Task 27) or the fallback flag is needed.
- Whether `accio map` and `accio sync`'s product-tier half have any caller left after Task 19.
