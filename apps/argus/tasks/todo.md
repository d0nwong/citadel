# Tasks: Argus and Pensieve, rebuilt around the ledger

Plan: `tasks/plan.md`. Spec: `SPEC.md`. Paths are relative to `~/git/citadel-data` unless they
start with `pensieve/`, which means `~/git/pensieve`.

## Phase 0: Freeze

## Task 1: Tag, branch, commit the spec and plan

**Description:** Freeze `main` so the old loop is recoverable, and start the rebuild branch with the spec, intent, idea and tasks committed. Stop any running `/loop /sweep` first.

**Acceptance criteria:**
- [ ] `git tag pre-rebuild` points at today's `main`
- [ ] Branch `rebuild/ledger` exists with `SPEC.md`, `docs/intent/`, `docs/ideas/`, `tasks/` committed
- [ ] No sweep loop is running

**Verification:**
- [ ] `git tag --contains pre-rebuild` and `git log --oneline -1` on the branch

**Dependencies:** None
**Files likely touched:** none beyond the new docs
**Estimated scope:** XS

## Phase 1: Schema and verbs

## Task 2: Ledger types, JSON schema, fixtures

**Description:** One source for the ledger's shape: TypeScript types and a JSON schema derived from them, matching the record in `SPEC.md`. Fixtures for a valid ledger and one broken ledger per rule the validator will enforce.

**Acceptance criteria:**
- [ ] `Ledger`, `Requirement`, `Ask`, `Ticket`, `Blocker`, `Landing`, `Proposal`, `Evidence` types exported, with the enums from the spec
- [ ] `evals/fixtures/ledger/valid.json` parses to `Ledger`; `story.on_you` is not a field
- [ ] One invalid fixture per rule: missing evidence, `assumption` on a confirmed rule, reused id, sentence over 25 words, id at line start, unknown status

**Verification:**
- [ ] `bun test scripts/argus/schema.test.ts`

**Dependencies:** Task 1
**Files likely touched:** `scripts/argus/schema.ts`, `scripts/argus/schema.test.ts`, `evals/fixtures/ledger/*.json`
**Estimated scope:** S

## Task 3: Validator with a refusal fixture per rule

**Description:** `validateLedger(ledger)` throws naming the JSON path of the first violation. Rules: schema; every requirement, ask history entry, cleared blocker and story text carries at least one evidence item; `assumption` only on `status: assumed` requirements and story text; ids unique and never reused (checked against the previous ledger); the three mechanical style rules from `style.md` on every reader-facing sentence; `as_of` not older than the previous.

**Acceptance criteria:**
- [ ] Every invalid fixture from Task 2 is refused with its path
- [ ] The valid fixture passes
- [ ] `validateDoc(path)` refuses an `arch.md` over 250 lines

**Verification:**
- [ ] `bun test scripts/argus/validate.test.ts`

**Dependencies:** Task 2
**Files likely touched:** `scripts/argus/validate.ts`, `scripts/argus/validate.test.ts`, `skills/sweep/style.md` (moved rules referenced, not changed)
**Estimated scope:** M

## Task 4: Read and write with id allocation and no-op detection

**Description:** `readLedger(feature)`, `writeLedger(feature, next)`. Write validates against the current ledger, allocates `R-n`/`A-n`/`P-n` for entries with no id, bumps `as_of` only when content changed, and returns `{ wrote: boolean, diff }`. Ledger paths follow the manifest's nesting.

**Acceptance criteria:**
- [ ] Writing an unchanged ledger returns `wrote: false` and the file's mtime is unchanged
- [ ] New entries get the next id after the highest ever used, including retired ones
- [ ] Write refuses when validation fails and leaves the file untouched

**Verification:**
- [ ] `bun test scripts/argus/write.test.ts` against a temp workspace

**Dependencies:** Task 3
**Files likely touched:** `scripts/argus/write.ts`, `scripts/argus/write.test.ts`, `scripts/argus/paths.ts`
**Estimated scope:** S

## Task 5: The `argus` CLI skeleton, `bin`, `bun link`

**Description:** `scripts/argus.ts` dispatches verbs, prints usage, honours `--dry-run` and `--json`, exits non-zero with the validator's message on refusal. `validate` and `write` wired. `bin.argus` in `package.json`; `bun link` documented in README's setup.

**Acceptance criteria:**
- [ ] `argus validate <feature>` and `argus write <feature> <file>` work from any directory after `bun link`
- [ ] `argus` with no verb prints usage and exits 1
- [ ] `--dry-run` on `write` prints the diff and writes nothing

**Verification:**
- [ ] `bun test scripts/argus.test.ts`; manual `argus --help`

**Dependencies:** Task 4
**Files likely touched:** `scripts/argus.ts`, `scripts/argus.test.ts`, `package.json`
**Estimated scope:** S

## Task 6: Click verbs: close, confirm, place, ticket

**Description:** The four verbs Pensieve's clicks run in phase 5. `close <feature> <ask> --reason`, `confirm <feature> <req> [--contradict --reason] [--all]`, `place <message-id> <feature>` (records the thread root in `state/threads.json` and removes the entry from `state/unplaced.json`), `ticket <feature> <proposal> <key>`. Each writes evidence of kind `user`.

**Acceptance criteria:**
- [ ] Each verb is idempotent: running it twice leaves the ledger as after once
- [ ] `confirm --all` flips every `assumed` requirement to `confirmed` with one evidence item
- [ ] `place` on an unknown message id or feature exits non-zero and writes nothing

**Verification:**
- [ ] `bun test scripts/argus/verbs.test.ts`

**Dependencies:** Task 5
**Files likely touched:** `scripts/argus/close.ts`, `scripts/argus/confirm.ts`, `scripts/argus/place-one.ts`, `scripts/argus/ticket.ts`, `scripts/argus/verbs.test.ts`
**Estimated scope:** M

## Checkpoint: Foundation
- [ ] `bun test` green, `bun run typecheck` clean
- [ ] `argus validate` refuses every fixture violation by path
- [ ] Review with the user

## Phase 2: Pull, place, replay

## Task 7: Move `slack-pull.ts` under `scripts/argus/`, cursor to `state/`

**Description:** Move the file and its test. Cursor reads and writes `state/cursor.json` and `state/cursor.next.json`; drop the digest-cursor adoption and every `queue/` and `marauder` reference. Keep pagination, thread following, user resolution, noise filter, permalinks and huddle canvas fetch.

**Acceptance criteria:**
- [ ] `grep -n "queue/\|marauder\|digests" scripts/argus/slack-pull.ts` is empty
- [ ] Existing tests pass at the new path
- [ ] A huddle canvas in a fixture comes back as text on the message

**Verification:**
- [ ] `bun test scripts/argus/slack-pull.test.ts`

**Dependencies:** Task 1
**Files likely touched:** `scripts/argus/slack-pull.ts`, `scripts/argus/slack-pull.test.ts`, `state/.gitignore`
**Estimated scope:** M

## Task 8: Move `pr-facts.ts` under `scripts/argus/`, features from the manifest lib

**Description:** Move the file. `landingFeatures` uses `scripts/accio/manifest.ts` for core files, routes and `be_files`; `landingsSince` unchanged. Drop the `NOT JOURNALED` marker and every journal reference.

**Acceptance criteria:**
- [ ] `landingsSince(repo, date)` returns `{ number, sha, title, by, at, url, files, features, ticketKeys }`
- [ ] No import from `skills/` remains

**Verification:**
- [ ] `bun test scripts/argus/pr-facts.test.ts`

**Dependencies:** Task 1
**Files likely touched:** `scripts/argus/pr-facts.ts`, `scripts/argus/pr-facts.test.ts`
**Estimated scope:** S

## Task 9: `argus pull` writes one batch file

**Description:** `pull.ts` calls both movers and writes `state/batches/<iso>.json` with `{ pulled_at, slack: { messages, threads, huddles }, landings: { fe, be } }`. Landings since each ledger's newest landing per repo, else `--since`. Writes `cursor.next.json`, never `cursor.json`.

**Acceptance criteria:**
- [ ] A second `pull` with nothing new writes no batch file
- [ ] `--since` overrides both the Slack cursor and the landing window
- [ ] The batch validates against a `Batch` type in `schema.ts`

**Verification:**
- [ ] `bun test scripts/argus/pull.test.ts` with mocked Slack and git

**Dependencies:** Tasks 5, 7, 8
**Files likely touched:** `scripts/argus/pull.ts`, `scripts/argus/pull.test.ts`, `scripts/argus/schema.ts`, `scripts/argus.ts`
**Estimated scope:** M

## Task 10: `argus place <batch>` does the deterministic joins

**Description:** A landing goes to every feature whose manifest files match; a reply goes where `state/threads.json` sends its root; a message naming a ticket key or PR number goes to the ledger listing it. Output: `state/batches/<iso>.placed.json` with per-feature slices, and `state/unplaced.json` with the rest plus the feature list each was read against.

**Acceptance criteria:**
- [ ] Placing the same batch twice yields byte-identical output
- [ ] A reply whose root is unplaced is unplaced too, grouped under its root
- [ ] A landing with no matching file lands in `unplaced` with `kind: landing`

**Verification:**
- [ ] `bun test scripts/argus/place.test.ts`

**Dependencies:** Tasks 6, 9
**Files likely touched:** `scripts/argus/place.ts`, `scripts/argus/place.test.ts`, `scripts/argus.ts`
**Estimated scope:** M

## Task 11: Record 14 days of fixtures; the user places the expectations once

**Description:** `argus pull --since 2026-08-27 --fixture` writes real batches under `evals/fixtures/batches/` with user ids resolved and tokens absent. `evals/expectations.json` lists every message and landing id with a `feature` pre-filled from the deterministic joins and from the old `work.json` thread keys, `null` otherwise. The user corrects it.

**Acceptance criteria:**
- [ ] Fixtures contain no token and no raw user id
- [ ] Every id in the fixtures appears once in `expectations.json`
- [ ] The user has confirmed the file

**Verification:**
- [ ] `grep -c xox evals/fixtures` is 0; a script checks id coverage

**Dependencies:** Task 10
**Files likely touched:** `scripts/argus/pull.ts` (`--fixture`), `evals/fixtures/batches/*.json`, `evals/expectations.json`, `evals/check-expectations.ts`
**Estimated scope:** S, plus the user's half hour

## Task 12: `bun run evals` scores deterministic attribution

**Description:** `evals/replay.ts` runs `place` over the fixtures against seeded-empty ledgers and prints attribution: placed on the expected feature, placed elsewhere, unplaced. Appends a dated line to `evals/scores.md`.

**Acceptance criteria:**
- [ ] Score printed as three counts and a fraction
- [ ] `--model` flag exists and errors "not yet" until Task 15

**Verification:**
- [ ] `bun run evals` on the fixtures

**Dependencies:** Task 11
**Files likely touched:** `evals/replay.ts`, `evals/scores.md`, `package.json`
**Estimated scope:** S

## Checkpoint: Deterministic attribution
- [ ] Score printed; the user reads the unplaced list and says whether its size is what they expected

## Phase 3: The reader

## Task 13: `reader.md`, the rewrite subagent's prompt and rules

**Description:** The prompt for step 4 in the agreed skill shape: what it receives (ledger, the feature's placed slice, `arch.md`), what it returns (the next ledger, via `argus write`), and its rules as one heading each: statuses move only on evidence; an ask closes on the asker's or the team's acknowledgement; a requirement flips only on a decider's message; a blocker clears only on a landing on the branch and deployed; a ticket is always a proposal; story texts in `style.md`'s voice; never write `on_you`; when unsure, leave it and say so in `story.health`.

**Acceptance criteria:**
- [ ] Under 100 lines, in the shape from `SPEC.md` Code Style
- [ ] Every rule the validator enforces is absent or one line

**Verification:**
- [ ] `wc -l`; read-through against the spec

**Dependencies:** Task 6
**Files likely touched:** `skills/sweep/reader.md`
**Estimated scope:** S

## Task 14: Seed `admin/invoicing` and `admin/usage` ledgers

**Description:** `seed.ts` converts a `product.md` BR table into requirement rows: the Rule column as `text`, `status: assumed`, evidence `{ kind: "assumption" }`, the Source column as `code` pointers pinned to the arch stamp's sha. `summary` from the doc's first paragraph. Everything else empty. Run for the two features.

**Acceptance criteria:**
- [ ] Both ledgers validate
- [ ] A row whose Rule column contains a mechanism clause ("because …", a function name) is flagged for the user rather than copied

**Verification:**
- [ ] `argus validate admin/invoicing admin/usage`; the user reads both requirement lists

**Dependencies:** Task 6
**Files likely touched:** `scripts/argus/seed.ts`, `scripts/argus/seed.test.ts`, two `ledger.json`
**Estimated scope:** S

## Task 15: Model attribution and rewrite in the replay harness

**Description:** `evals/replay.ts --model` runs, per batch in order: deterministic place, then `claude -p` with the sweep's attribution section over `unplaced.json`, then one `claude -p` per affected feature with `reader.md`, writing to a temp copy of the two ledgers. Records token counts per call. Attribution now scores both steps.

**Acceptance criteria:**
- [ ] The harness runs unattended over all fixtures and prints attribution and the largest call's token count
- [ ] Ledgers after the replay validate

**Verification:**
- [ ] `bun run evals --model`

**Dependencies:** Tasks 12, 13, 14
**Files likely touched:** `evals/replay.ts`, `skills/sweep/attribute.md` (the step-3 prompt), `evals/scores.md`
**Estimated scope:** M

## Task 16: Closure cases and the gate

**Description:** The user names two asks beyond Due-on-invoice, one that must close and one that must stay open. `expectations.json` gains `closures: [{ ask text, feature, closes_on: message id | null }]`. The harness scores them. Gate per `plan.md`.

**Acceptance criteria:**
- [ ] Attribution ≥ 0.8
- [ ] All three closure cases score as expected
- [ ] A fixture ticket with a `landing` blocker flips ready on the right batch

**Verification:**
- [ ] `bun run evals --model`; the user reads the two ledgers' story texts

**Dependencies:** Task 15
**Files likely touched:** `evals/expectations.json`, `evals/replay.ts`, `skills/sweep/reader.md`
**Estimated scope:** S

## Checkpoint: The gate
- [ ] Every line of the Phase 3 checkpoint in `plan.md` holds, or the design changes here

## Phase 4: Seed and docs

## Task 17: Seed every feature's ledger

**Description:** Run `seed.ts` over the 22 features with BR tables and write an empty ledger for the rest. Resolve every flagged row with the user in one pass.

**Acceptance criteria:**
- [ ] `argus validate` passes for every feature in the manifest
- [ ] No requirement text contains a file path or function name

**Verification:**
- [ ] `argus validate`; `grep -l "src/" */features/**/ledger.json` empty

**Dependencies:** Task 16
**Files likely touched:** every `ledger.json`
**Estimated scope:** S

## Task 18: `feature-docs` becomes arch-only under the caps

**Description:** Cut `DOC-PROTOCOL.md` to the arch half and the refresh loop; drop product generation, the journal phase and the "Decided, not yet landed" region. `SKILL.md` in the agreed shape, under 100 lines, one arg: feature ids or `stale`.

**Acceptance criteria:**
- [ ] `SKILL.md` ≤ 100 lines; `DOC-PROTOCOL.md` has no product or journal section
- [ ] A run on one feature produces an `arch.md` under 250 lines that `validateDoc` accepts

**Verification:**
- [ ] `wc -l`; run on `admin/usage`

**Dependencies:** Task 3
**Files likely touched:** `skills/feature-docs/SKILL.md`, `skills/feature-docs/DOC-PROTOCOL.md`
**Estimated scope:** M

## Task 19: Trim `accio` to find, stale, sync for the arch tier

**Description:** Move `scripts/commands` and `scripts/lib` to `scripts/accio/`. Keep `find`, the manifest, the index store, `analyze`, and the arch half of `sync` and `stale`. Delete `journal.ts`, `map`, product stamps, `patchProductDecided`, `audit`'s journal checks. `accio audit` becomes `argus validate` plus the arch cap.

**Acceptance criteria:**
- [ ] `accio find`, `accio stale`, `accio sync` work; `accio audit` and `accio map` are gone
- [ ] No reference to `journal`, `product.md` or `work.json` under `scripts/accio/`

**Verification:**
- [ ] `bun test scripts/accio.test.ts`; `grep -rn "journal\|product.md" scripts/accio` empty

**Dependencies:** Task 18
**Files likely touched:** `scripts/accio.ts`, `scripts/accio/*.ts`, `scripts/accio.test.ts`
**Estimated scope:** M

## Task 20: Bring every `arch.md` under 250 lines

**Description:** Run the trimmed `feature-docs` on every feature whose `arch.md` exceeds the cap, sequentially, and on any `accio stale` reports.

**Acceptance criteria:**
- [ ] `validateDoc` passes for every `arch.md`
- [ ] `accio stale` reports nothing

**Verification:**
- [ ] `argus validate`; `accio stale`

**Dependencies:** Tasks 18, 19
**Files likely touched:** `*/features/**/docs/arch.md`
**Estimated scope:** M, model time

## Checkpoint: Every feature validates
- [ ] The user runs `argus confirm <feature> --all` on one feature and reads it back

## Phase 5: Pensieve

## Task 21: `server/ledger.ts` reads ledgers and derives on-you, ready, unplaced

**Description:** Read every `ledger.json` under `WORKSPACE_DIR` plus `state/unplaced.json`. Derive `onYou` (asks with `to: "you"` not closed or dropped, sorted by age), `ready` (tickets with every blocker cleared), and the feature list with summaries. Tests on fixtures.

**Acceptance criteria:**
- [ ] Nested features resolve to their page path
- [ ] A ledger that fails to parse is reported on the page, not thrown

**Verification:**
- [ ] `bun test src/server/ledger.test.ts`

**Dependencies:** Task 4
**Files likely touched:** `pensieve/src/server/ledger.ts`, `pensieve/src/server/ledger.test.ts`, `pensieve/src/lib/ledger.ts` (shared types, copied from schema)
**Estimated scope:** M

## Task 22: `server/argus.ts` spawns the CLI

**Description:** One function `argus(verb, args)` spawning `bun scripts/argus.ts <verb> --json` in `WORKSPACE_DIR` with a timeout, returning the parsed result or the last stderr line. Replaces `APPLY_COMMAND`.

**Acceptance criteria:**
- [ ] A refusal from the validator reaches the caller as a message, not an exception
- [ ] The command never runs outside `WORKSPACE_DIR`

**Verification:**
- [ ] `bun test src/server/argus.test.ts` with a stub script

**Dependencies:** Task 5
**Files likely touched:** `pensieve/src/server/argus.ts`, `pensieve/src/server/argus.test.ts`
**Estimated scope:** S

## Task 23: Home: Needs-me, Ready, Unplaced

**Description:** Replace `routes/index.tsx`. Three lists across features. Needs-me rows: the ask sentence, who is waiting, since when, the feature, a Done button (`close`). Ready rows: ticket, feature, a Send button disabled until Task 28. Unplaced rows: the message, the candidates, a feature picker (`place`).

**Acceptance criteria:**
- [ ] Done removes the row without a reload and the ledger shows the close
- [ ] Placing an unplaced root also removes its replies

**Verification:**
- [ ] Manual in the browser against seeded ledgers; `bun run typecheck`

**Dependencies:** Tasks 21, 22
**Files likely touched:** `pensieve/src/routes/index.tsx`, `pensieve/src/features/home/*.tsx`, `pensieve/src/lib/api.ts`
**Estimated scope:** M

## Task 24: Feature page: the five questions, requirements, asks, tickets, landings

**Description:** Replace `routes/features/$.tsx`. Top: the four story texts plus derived On-you, each sentence with its evidence line. Then requirements with status chips and Confirm / Contradict; asks with history and Close; tickets with blockers; landings; a link to `arch.md`.

**Acceptance criteria:**
- [ ] Every sentence shows its evidence as links naming what they are
- [ ] Confirm and Contradict write through `argus confirm` and re-render

**Verification:**
- [ ] Manual; stories 1 and 5 by hand

**Dependencies:** Task 23
**Files likely touched:** `pensieve/src/routes/features/$.tsx`, `pensieve/src/features/feature/*.tsx`, `pensieve/src/lib/api.ts`
**Estimated scope:** M

## Task 25: Ask over the ledger

**Description:** Retarget Ask's tool and allowlist: `Bash(argus:*)` read verbs (`show`, `validate --json`), `Bash(accio:*)`, `git -C <repo> log|show` via a wrapper verb `argus history`; propose tools become `propose_close`, `propose_confirm`, `propose_place`, `propose_ticket`, each rendering a card whose click runs the verb. `skills/ask/SKILL.md` rewritten in the shape, under 100 lines.

**Acceptance criteria:**
- [ ] "What did Foong ask for on invoicing this week" answers with ask ids and permalinks from the ledger
- [ ] No tool in the run can write the checkout

**Verification:**
- [ ] `bun test src/server/ask-tools.test.ts`; manual story 6

**Dependencies:** Tasks 22, 24
**Files likely touched:** `pensieve/src/lib/ask-tools.ts`, `pensieve/src/server/ask-tools.server.ts`, `pensieve/src/features/ask/components/decision-card.tsx`, `skills/ask/SKILL.md`, `scripts/argus/show.ts`
**Estimated scope:** M

## Checkpoint: Stories 1, 2, 5, 6, 7
- [ ] Each by hand; Pensieve `bun test`, `typecheck`, `check` clean

## Phase 6: Tickets

## Task 26: Proposals and `argus file` / `argus ticket`

**Description:** The reader writes proposals; the feature page renders them with a File button. `argus file <feature> <proposal>` prints the body in `FORMAT.md` shape with Technical Notes drawn from `arch.md` and `accio find`; Pensieve files it through `linear.ts` and calls `argus ticket` with the key. `skills/linear-ticket/SKILL.md` rewritten under 100 lines to file from a proposal.

**Acceptance criteria:**
- [ ] A filed proposal disappears and its ticket appears with the key on the ask
- [ ] The ticket title carries the `[FE]` or `[BE]` tag and the assignee is the user

**Verification:**
- [ ] `bun test scripts/argus/verbs.test.ts`; one real filing

**Dependencies:** Tasks 6, 24
**Files likely touched:** `scripts/argus/file.ts`, `skills/linear-ticket/SKILL.md`, `pensieve/src/features/feature/proposals.tsx`, `pensieve/src/server/ticket.ts`
**Estimated scope:** M

## Task 27: Blockers, the deploy check, ready

**Description:** `place` clears a `landing` blocker when a landing in the batch matches its ref and branch; `deployed` is checked by reading the dev swagger's build sha (fallback: a `deployed` flag the user sets with `argus confirm`). `answer` blockers clear when the reader records the answer; `ticket` blockers when the named ticket's asks close. `ready` is recomputed on every write.

**Acceptance criteria:**
- [ ] A ticket with one `landing` blocker flips ready on the batch carrying the merge, once the swagger check passes
- [ ] Ready never stays true with an uncleared blocker

**Verification:**
- [ ] `bun test scripts/argus/blockers.test.ts`; story 3 against a real `origin/dev` merge

**Dependencies:** Task 10
**Files likely touched:** `scripts/argus/blockers.ts`, `scripts/argus/blockers.test.ts`, `scripts/argus/place.ts`, `scripts/argus/write.ts`
**Estimated scope:** M

## Task 28: `argus send` and the Send button

**Description:** `send <feature> <key> --repo` posts `{ ticketId, repo }` to Foundry with `Idempotency-Key: <key>` and records `sent` on the ticket. Pensieve's Ready row enables Send with a repo picker from `GET /api/repos` and a confirm.

**Acceptance criteria:**
- [ ] A second send replays (200) and does not add a second `sent` entry
- [ ] Send is disabled without `FOUNDRY_API_TOKEN`

**Verification:**
- [ ] `bun test scripts/argus/send.test.ts`; story 8 against the dev Foundry

**Dependencies:** Tasks 23, 27
**Files likely touched:** `scripts/argus/send.ts`, `scripts/argus/send.test.ts`, `pensieve/src/features/home/ready.tsx`, `pensieve/src/server/foundry.ts`
**Estimated scope:** S

## Checkpoint: Stories 3 and 8

## Phase 7: Retire

## Task 29: Rewrite the sweep skill under 120 lines in the agreed shape

**Description:** Overview, When to Use, the seven steps with one command each, Rules for attribution only (the reader's are in `reader.md`), Red Flags, Verification. A test asserts every `skills/*/SKILL.md` is under its cap.

**Acceptance criteria:**
- [ ] `skills/sweep/SKILL.md` ≤ 120 lines; every other skill ≤ 100
- [ ] No date, ticket key or "retired" step in the body

**Verification:**
- [ ] `bun test scripts/skills.test.ts`

**Dependencies:** Task 16
**Files likely touched:** `skills/sweep/SKILL.md`, `scripts/skills.test.ts`
**Estimated scope:** S

## Task 30: Delete the retired list in argus

**Description:** Remove `marauder/`, `queue/`, `decisions/`, `reports/`, `digests/`, `arcs/`, `improvements/`, `canvas/`, every `journal/`, `work.json`, `board.md`, `product.md`, `skills/log-change/`, `skills/sweep/scripts/`, `skills/sweep/ticket-pass.md`, `sample-journal.md`, the `canvas` and `marauder` scripts in `package.json`, and `.claude/skills/` (`sync-skills` regenerates it).

**Acceptance criteria:**
- [ ] `git grep -l marauder` returns only `docs/`
- [ ] `bun test` and `bun run typecheck` green after the delete

**Verification:**
- [ ] The two greps; `bun run sync-skills`

**Dependencies:** Tasks 20, 26, 29
**Files likely touched:** the retired list, `package.json`, `.gitignore`
**Estimated scope:** L by count, XS by judgement

## Task 31: Rewrite README and CLAUDE.md

**Description:** README: the three systems, the ledger, the run, setup with `bun link`. CLAUDE.md: the Bun rules kept, the blackboard paragraph replaced with the ledger and the two CLIs. Move `SPEC.md`'s intent pointers into README's "Why".

**Acceptance criteria:**
- [ ] No mention of marauder, queue, decisions, journal, work.json, arcs, digests or reports as live things

**Verification:**
- [ ] Read-through

**Dependencies:** Task 30
**Files likely touched:** `README.md`, `CLAUDE.md`
**Estimated scope:** S

## Task 32: Delete the retired routes and server code in Pensieve

**Description:** Remove `routes/archive.tsx`, `arcs/`, `digests/`, `reports/`, `journal/`, `unsorted.tsx`, `blocks.tsx`, `features/unsorted/`, `features/work/`, `server/marauder.ts`, `server/decisions.ts`, `server/apply.ts`, `server/sections.ts`, `lib/marauder.ts` and their tests; trim `workspace.ts` and `api.ts` to what remains; regenerate routes.

**Acceptance criteria:**
- [ ] `grep -rn marauder src` empty
- [ ] `bun test`, `typecheck`, `check` green

**Verification:**
- [ ] The grep and the three commands

**Dependencies:** Task 25, 28
**Files likely touched:** the list above, `pensieve/src/routeTree.gen.ts`
**Estimated scope:** L by count, S by judgement

## Task 33: One full `/sweep` on a copy, then merge and run for real

**Description:** Clone the branch to a scratch directory, point Pensieve at it, run `/sweep` once over the real channel and repos, read every page. Fix what is wrong, then merge `rebuild/ledger` to `main` and start `bun run sweep`.

**Acceptance criteria:**
- [ ] The run makes no model call for a feature with no input and writes nothing on a quiet second run
- [ ] The user reads the board and finds no false Needs-me

**Verification:**
- [ ] Two consecutive runs; `git log` shows one commit then none

**Dependencies:** Tasks 31, 32
**Files likely touched:** whatever the run surfaces
**Estimated scope:** M

## Checkpoint: Complete
- [ ] Every Success Criterion in `SPEC.md`
