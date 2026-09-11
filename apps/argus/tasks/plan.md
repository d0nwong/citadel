# Implementation Plan: Argus and Pensieve, rebuilt around the ledger

Spec: `SPEC.md`. Tasks: `tasks/todo.md`. Written 2026-09-10; brought up to date 2026-09-11,
after all seven phases were built and merged to `main` in both repos.

**Where it stands.** Every task is done. The first real sweep ran on a scratch clone and its
ledgers are on `main` (commit `bc8077b`). What is left is yours: start the loop, try the two
outward-facing clicks (File and Send) for real, and decide the two leftovers listed under
Open Questions.

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
- **The reader returns a patch, code applies it.** Changed in Phase 3: returning the whole
  ledger cost $1.30 a call, took minutes, and failed the schema every time. The reader
  now returns the shape in `skills/sweep/shapes.md`; `applyPatch` builds the next ledger
  and `argus write` validates the whole. A patch can add, update, block and link; it
  cannot delete or renumber.
- **Code owns the landings.** `argus place` puts a slice's landings on the ledger; the
  reader only links them to asks. That removed a whole class of shape refusals.
- **Asks carry blockers, like tickets.** "Let me know when merged" is a landing blocker
  on the ask; `argus reconcile` clears it and the home page lists the ask as unblocked.
- **A live backend with no frontend on it proposes the ticket.** The reader's rule, from
  the user's request; the proposal waits for File.
- **Validation is the policy.** Evidence on every claim, the style rules, the caps and
  the id scheme are code in `validate.ts`, so the skills do not have to say them. A
  skill line exists only where the model has to judge.
- **Two deterministic joins, nothing more.** Changed files to features through the
  manifest, replies to their thread root through `state/threads.json`. Ticket keys and PR
  numbers in text join to the ledger that lists them. Everything else is the model's
  call or unplaced. No vocabulary, no aliases beyond the manifest. A file four or more
  features list is shared plumbing and only attaches a landing when nothing specific
  matched (added after the first real run spread backend landings over a dozen features).
  Attribution may name two features for a thread that straddles them.
- **Deployed means the dev pipeline succeeded.** The dev swagger has no build marker;
  Bitbucket's pipelines API reports each merge commit's deploy, read with the credentials
  `bb` keeps. The frontend's signal is undecided.
- **Unplaced is a state, not a failure.** `place` writes `state/unplaced.json`; the sweep
  reads it once with the feature summaries; whatever is left is Pensieve's list. A click
  runs `argus place <id> <feature>` and records the thread.
- **The eval harness runs the real prompts.** `evals/replay.ts` calls `claude -p` with
  `reader.md` over recorded batches, so a change to the prompt is measured the same way a
  change to `place.ts` is. The run and the replay share `scripts/argus/reader.ts`, so the
  prompt the sweep prints with `argus prompt` is the prompt the score was measured on.
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
- [x] Review with the user (reviewed with the gate page, 2026-09-11)

### Phase 2: Pull, place, replay
- [x] Task 7: Move `slack-pull.ts` under `scripts/argus/`, cursor to `state/`
- [x] Task 8: Move `pr-facts.ts` under `scripts/argus/`, features from the manifest lib
- [x] Task 9: `argus pull` writes one batch file
- [x] Task 10: `argus place <batch>` does the deterministic joins
- [x] Task 11: Record 14 days of fixtures; the user places the expectations once
- [x] Task 12: `bun run evals` scores deterministic attribution

### Checkpoint: Deterministic attribution
- [x] A batch replays to the same per-feature split twice
- [x] The deterministic score is printed and written to `evals/scores.md` (45% before any thread is learned)
- [x] Review with the user: 129 roots placed by hand, 148 marked as belonging nowhere

### Phase 3: The reader
- [x] Task 13: `reader.md`, the rewrite subagent's prompt and rules
- [x] Task 14: Seed `admin/invoicing` and `admin/usage` ledgers
- [x] Task 15: Model attribution and rewrite in the replay harness
- [x] Task 16: Closure cases and the gate

### Checkpoint: The gate
- [x] Attribution ≥ 0.8 on the 14-day replay (85%, 2026-09-11)
- [x] Due-on-invoice closes on the acknowledgement; three more named cases pass (one case was the old board's stale item; the reader had it right)
- [x] A ticket with a `landing` blocker flips ready on the landing's batch (unit-tested in Task 27; not yet seen on a real merge)
- [x] The user read the three replayed ledgers on the gate page and continued
- [x] The gate passed; nothing below was built before it did

### Phase 4: Seed and docs
- [x] Task 17: Seed every feature's ledger
- [x] Task 18: `feature-docs` becomes arch-only under the caps
- [x] Task 19: Trim `accio` to find, stale, sync for the arch tier
- [x] Task 20: Bring every `arch.md` under 250 lines

### Checkpoint: Every feature validates
- [x] `argus validate` passes for every feature
- [x] `accio stale` reports nothing after Task 20
- [x] The user confirmed and contradicted rules across 22 features from Pensieve (commit `c9fe118`)

### Phase 5: Pensieve
- [x] Task 21: `server/ledger.ts` reads ledgers and derives on-you, ready, unplaced
- [x] Task 22: `server/argus.ts` spawns the CLI
- [x] Task 23: Home: Needs-me, Ready, Unplaced
- [x] Task 24: Feature page: the five questions, requirements, asks, tickets, landings
- [x] Task 25: Ask over the ledger

### Checkpoint: Stories 1, 2, 5, 6, 7
- [x] 5 (statuses with who and when) and 7 (place from Unplaced) exercised by the user; 1, 2 and 6 need a ledger the loop has written, which `bc8077b` now provides
- [x] Pensieve `bun test`, `typecheck`, `check` clean (133 tests)

### Phase 6: Tickets
- [x] Task 26: Proposals and `argus file` / `argus ticket`
- [x] Task 27: Blockers, the deploy check, ready
- [x] Task 28: `argus send` and the Send button

### Checkpoint: Stories 3 and 8 (still yours)
- [ ] A proposal files to Linear and its key lands on the ledger: two proposals wait on the usage and team-management pages
- [ ] A `landing` blocker clears from a real `origin/dev` merge plus the pipeline check (the deploy check is live against Bitbucket; the first blocker the reader writes will test it)
- [ ] Send reaches Foundry with the ticket key as the idempotency key

### Phase 7: Retire
- [x] Task 29: Rewrite the sweep skill under 120 lines in the agreed shape
- [x] Task 30: Delete the retired list in argus
- [x] Task 31: Rewrite README and CLAUDE.md
- [x] Task 32: Delete the retired routes and server code in Pensieve
- [x] Task 33: One full `/sweep` on a copy, then merge and run for real

### Checkpoint: Complete
- [x] `git grep marauder` empty outside `docs/`
- [x] Every skill under its cap; the cap test is green
- [x] One full sweep on a copy: 20 readers, every patch first try, 80 story texts, 4 asks, 2 proposals; carried over as `bc8077b`
- [ ] `bun run sweep` runs a working day with no false Needs-me (the user starts the loop)

## Risks, and how each turned out

| Risk | Outcome |
|---|---|
| Attribution below 0.8 on the replay | 85% on 14 days, after manifest names and aliases went into the prompt and threads were grouped |
| The model closes asks that are not closed | 4 of 4 closure cases right; one of the user's own cases was the old board's stale item, and the reader had it right |
| Ledger plus batch exceeds one affordable call | Whole-ledger replies cost $1.30 and failed the schema; a patch reply with the ledger compacted costs about $0.40 |
| Slack canvases need a scope the token lacks | 16 of 17 huddle posts came back with their notes; mentions inside them now resolve to names |
| The deploy check has no clean signal | The swagger has none; Bitbucket's pipelines API does, per merge commit, with `bb`'s credentials |
| `ask.ts` coupled to marauder tools | Retargeted the tool list, the allowlist, the card and the prompt; the adapter stayed |
| The user's time to place 14 days of expectations | 129 roots, replies inherit, done in one sitting |
| Shared working trees with the sweep committing | Old loop stopped; all work on `rebuild/ledger`; merged fast-forward |
| Not foreseen: backend landings spread over a dozen features | Shared files (listed by four or more features) now yield to a feature's own files |
| Not foreseen: an ask that arrives and closes in one batch | A new ask may carry `status` and `history` |

## Parallelization

- Tasks 2 to 6 and Tasks 7 to 10 are independent until Task 10 reads ledgers.
- Tasks 21 and 22 can start on fixtures once Phase 1 is done.
- Tasks 18 and 19 are independent.
- Everything in Phase 3 is sequential and gated.

## Open Questions

- Pensieve's `src/routes/journal/*` carry the user's uncommitted edits and read a journal
  that no longer exists. Keep or delete is the user's call.
- The pensieve and foundry apps keep their `product.md` and have no ledgers; whether they
  get ledgers is a later phase.
- The frontend's deploy signal (Netlify) is undecided; a frontend landing blocker waits
  for a person until it is.
- Fourteen arch docs are behind the code per `accio stale`; the sweep's docs step works
  them off three per run, or one `feature-docs stale` does it at once.
- Reader cost is dominated by the ledger's size in the prompt; closed asks and retired
  rules are already compacted, and the next lever is dropping requirements' evidence.
