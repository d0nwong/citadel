# Plan: CTD-192 — a ramble becomes a spec, and the spec becomes the tickets

Specs: `specs/foundry/jobs.md`, `specs/argus/revisions.md`, `specs/argus/reconcile.md`.
Design: `docs/spec/spec-tickets.md`, Assumptions 1–11. Verified at citadel `main@a9b47f8`,
citadel-data `main@313c64e`.

## Tickets

1. CTD-193 [BE] Argus: the revision record — revisions S-1…S-7, reconcile S-13 — blocked by: none
2. CTD-194 [BE] Argus: the `/scope` skill — revisions S-8…S-12 — blocked by: 1
3. CTD-195 [BE] Foundry: hand a job its revision's spec and arch doc — jobs S-35…S-38, revisions S-13 — blocked by: 1
4. CTD-196 [BE] Argus: reconcile folds a Done revision and archives a Cancelled one — reconcile S-9…S-12 — blocked by: 1

Filed 2026-09-13 under CTD-192. 3 and 4 can run in parallel once 1 lands. Not a ticket: after 1, one chore commit moves
`docs/intent`, `docs/spec`, `docs/revisions/CTD-192` and `apps/argus/docs/{intent,ideas}` into
citadel-data under `revisions/` and `revisions/archive/`, and points the READMEs there.

## Risks

| Risk | What catches it |
|---|---|
| `/scope` needs babysitting: the spec or plan it produces gets edited before filing | Ticket 2's proof is one real run; fixes go in the companion files' wording, not in machinery |
| The arch block crowds a ticket's named files out of the 64 KB cap | The cut lists them; if it happens on a real job, the arch block drops to named sections |
| A fold overwrites a live spec another revision changed | Assumption 10 accepts it; the archive keeps both revisions whole |

## 1. [BE] Argus: the revision record

## Summary

Adds the revision to citadel-data: a `revisions/` directory keyed by slug while drafting and
by the parent ticket once filed, a `revision.json` record only the verbs write, and four
`argus revision` verbs that move it through draft, filed and dropped. `argus validate` learns
the record and the feature-spec shape, `argus commit` learns the new paths, and `argus/`
becomes an app in citadel-data so this revision's own specs have a home.

## Background

Nothing in citadel-data outlives a ticket except the ledger and the arch doc, and neither
holds what was decided before the ticket existed. The intent and spec for CTD-65 live in this
repo's `docs/`, where nothing reads them. A revision gives that record a place, a lifecycle
and a machine-readable shape, so reconcile can fold it and Foundry can find it. This ticket
is the layout and the verbs; the skill that fills a revision, the fold and the hydration are
tickets 2, 4 and 3.

## Scope / Out of Scope

In scope:

- `scripts/argus/paths.ts` — the revision, archive and `docs/spec.md` paths
- `scripts/argus/revision.ts` — the record: read, new, file, drop; tests beside it
- `scripts/argus/validate.ts` — the record's rules and the spec file's rules
- `scripts/argus/commit.ts` — the committable paths
- `scripts/argus.ts` — the `revision` verb and its four sub-verbs, `--json` like the others
- citadel-data — `argus/.doc-workspace/feature-manifest.json`, `argus/features/revisions/`,
  `argus/features/reconcile/`; `README.md` and `SPEC.md` in `apps/argus` gain the record

Out of scope:

- The fold and the archive on a settled parent — ticket 4.
- The `/scope` skill — ticket 2. This ticket's verbs are exercised by tests and by hand.
- Any parser for `plan.md`, and anything in Pensieve.

## Acceptance Criteria

- [ ] AC1 — `argus revision new <slug> --title <t> --feature <app>/<dir>` creates
      `revisions/<slug>/revision.json` with status `draft`, `at.drafted` and the features, and
      refuses a slug in use or a feature with no directory under an app. (spec revisions S-1)
- [ ] AC2 — `argus revision show <slug|KEY>` prints the record as JSON from `revisions/` or
      the archive, and names the missing directory when there is none. (spec revisions S-2)
- [ ] AC3 — `argus revision file <slug> <KEY> --tickets K1,K2` moves a draft to `filed` with
      the key, the tickets in order, `at.filed` and the ticket as evidence, and renames the
      directory to the key; it refuses a non-draft, a non-key, or no tickets. (spec revisions S-3)
- [ ] AC4 — `argus revision drop <slug|KEY> --reason <why>` moves a draft or filed revision to
      `revisions/archive/` with status `dropped` and the reason as evidence, and refuses one
      already done or dropped. (spec revisions S-4)
- [ ] AC5 — `argus validate` refuses a record with a status outside the four, an unknown
      feature, or `filed` without a key or tickets; and refuses a spec over 250 curated lines,
      with a repeated `S-n`, or with an id at or past `next_id`. (spec revisions S-5)
- [ ] AC6 — No verb deletes anything under `revisions/`; a dropped revision arrives in the
      archive with every file it had. (spec revisions S-6)
- [ ] AC7 — citadel-data has `argus/` as an app: a feature manifest and the two feature
      directories, and `argus validate` is clean with them present. (spec revisions S-7)
- [ ] AC8 — `argus commit` commits `revisions/**` and `<feature>/docs/spec.md` alongside what
      it commits today, and nothing else new. (spec reconcile S-13)

## Technical Notes

- `apps/argus/scripts/argus/paths.ts:11-28` — `root()`, `featureDir`, `archDocPath`,
  `manifestPath`. Add `revisionsDir()`, `revisionDir(slugOrKey)`, `archiveDir()`,
  `specDocPath(feature, app)`. AC1–AC4, AC7.
- `apps/argus/scripts/argus/schema.ts` — `Evidence` (the `ticket` and `user` kinds) is reused
  for `revision.json`'s `evidence`; the record's own type lives in `revision.ts`, parsed the way
  `parseLedger` parses, naming the first path that breaks. AC1, AC5.
- `apps/argus/scripts/argus/validate.ts:274-291` — `ARCH_MAX_LINES`, `curatedLines`,
  `validateDoc`. `validateSpec` reads the frontmatter (`next_id`), collects `^- S-(\d+)` under
  `## Criteria` and `## Retired`, and reuses `validateDoc` for the cap. AC5.
- `apps/argus/scripts/argus/commit.ts:21` — `COMMITTABLE` gains `^revisions/` and
  `features/.*/docs/spec\.md$`. AC8.
- `apps/argus/scripts/argus.ts:168` — the verb table; `revision` dispatches on its first
  argument the way the others take flags, prints JSON under `--json` (Pensieve spawns every
  verb that way, `apps/pensieve/src/server/argus.ts`), and exits non-zero on a refusal. AC1–AC4.
- `~/git/citadel-data/foundry/.doc-workspace/feature-manifest.json` — the shape to copy for
  `argus/`: `app`, `repo`, `features[]` with `id`, `name`, `type`, `core_files`, `aliases`.
  Two features, `revisions` and `reconcile`, `core_files` pointing at the scripts above. AC7.
- `apps/argus/README.md:24-47` and `SPEC.md:80` — the record section gains a revision
  paragraph and the verb list gains the four verbs.

Verified at citadel `main@a9b47f8`, citadel-data `main@313c64e`.

## 2. [BE] Argus: the `/scope` skill

## Summary

Adds `apps/argus/skills/scope/`: a run file under 100 lines and three companion files adapted
from the addy `agent-skills` plugin, so that `/scope <ramble | key | path>` in a terminal
interviews the user, writes the intent, revises each feature's spec, writes the plan, and files
a parent with sub-issues, recording the result with `argus revision file`.

## Background

This revision was produced by hand with the plugin's `interview-me`,
`spec-driven-development` and `planning-and-task-breakdown`, plus grounding the plugin does
not do: the ledger, the baseline spec, the arch doc, `accio find`. The skill makes that run
repeatable. It copies the plugin rather than loading it, as Foundry's `forge-*` skills did,
because the plugin is not in Ask's sandbox and its shapes drift. `SKILL.md` stays under the
Argus cap by carrying the run only; the process lives beside it.

## Scope / Out of Scope

In scope:

- `apps/argus/skills/scope/SKILL.md` — the run: grounding, five steps, handoffs, filing, Finish
- `apps/argus/skills/scope/interview.md` — from `interview-me`, plus grounding and the
  three-variations move
- `apps/argus/skills/scope/spec.md` — from `spec-driven-development`'s Specify phase, ending in
  `doubt-driven-development`'s self-review
- `apps/argus/skills/scope/plan.md` — from `planning-and-task-breakdown`, ending in the same
  self-review, producing tickets in `linear-ticket`'s `FORMAT.md`
- `apps/argus/skills/scope/SHAPES.md` — `intent.md`, the feature spec, `plan.md`, `revision.json`
- `apps/argus/README.md` — the skill in the list; `bun run sync-skills` links it

Out of scope:

- Running from Pensieve's Ask; the tool allowlist there; a model choice for Ask.
- `idea-refine`; a parser for `plan.md`.
- Changing `linear-ticket` or `FORMAT.md`; the plan's bodies follow them as they are.

## Acceptance Criteria

- [ ] AC1 — Before its first hypothesis the skill has read the ledger through `argus show`,
      the feature's `docs/spec.md` and `docs/arch.md`, run `accio find` for anything the
      argument names, and fetched the issue when the argument is a ticket key. (spec revisions S-8)
- [ ] AC2 — Each of the five steps ends on the user's explicit yes before its file is written,
      and "sounds good" or "whatever you think" is re-asked. (spec revisions S-9)
- [ ] AC3 — The run leaves `intent.md` in the house shape, one spec per named feature under
      `specs/` edited from the baseline or first-written from the arch doc, `product.md`, the
      requirement rows and the conversation, with ids from `next_id` and retirements under
      `## Retired`, and `plan.md` as the ticket list plus six-section bodies whose ACs cite
      `S-n`; the doubt pass runs before the spec and the plan are shown. (spec revisions S-10)
- [ ] AC4 — Filing adopts `--parent <KEY>` with a pointer added to its description, or creates
      the parent on the team the features name; creates sub-issues with `parentId`,
      `blockedBy` and the body verbatim; records them with `argus revision file`; changes no
      ticket's state, runs neither `reconcile` nor `commit`, and writes nothing outside
      `revisions/<slug>/`. (spec revisions S-11)
- [ ] AC5 — `SKILL.md` is under 100 lines, the three companion files each carry an MIT
      attribution line naming their source skill, and nothing in the directory loads the
      plugin. (spec revisions S-12)
- [ ] AC6 — One real run on a ticket of notes other than this one — CTD-125, the sub-issue
      walk, is the candidate — ends with a filed parent, its sub-issues, and a `revisions/<KEY>/`
      whose plan was filed without hand edits. (spec revisions S-9, S-11)

## Pending

- **BE — the revision record (ticket 1)** (Liam) — stops AC4's `argus revision file` and the
  real run in AC6; the five files and the interview through plan steps can be written and
  dry-run meanwhile.

## Technical Notes

- `~/.claude/plugins/cache/addy-agent-skills/agent-skills/849850e03972/skills/{interview-me,spec-driven-development,planning-and-task-breakdown,doubt-driven-development}/SKILL.md`
  — the sources, 225, 206, 234 and 243 lines; MIT, © 2025 Addy Osmani. AC5.
- `apps/foundry/image/skills/forge-spec/SKILL.md:1-12` — the adapted-skill frame and the
  attribution line to copy. `apps/argus/skills/sweep/SKILL.md` and `reader.md` — a run file
  with companions, the pattern this follows. AC5.
- `apps/argus/skills/linear-ticket/FORMAT.md` — the six sections a plan body follows; the
  `(spec S-n)` suffix goes on each AC line after any `(product …)` citation. AC3.
- `apps/argus/skills/ask/SKILL.md:30-45` — the grounding verbs and their spellings the
  allowlist knows, reused in `interview.md`. AC1.
- `docs/intent/spec-tickets.md` — the intent shape; `docs/revisions/CTD-192/specs/*` — the
  feature-spec shape; `docs/revisions/CTD-192/plan.md` — the plan shape. All three to
  `SHAPES.md`. AC3.
- `apps/argus/scripts/sync-skills.ts` — links `skills/scope` into `~/.claude/skills` on the
  next `bun run sync-skills`; the skills cap test in `apps/argus` counts `SKILL.md` only. AC5.
- The Linear MCP tools the filing step uses: `mcp__linear__save_issue` with `parentId` and
  `blockedBy`; `mcp__linear__get_issue` for a key argument. A `patch` on a description that
  holds images corrupts them; the pointer is added by rewriting the description whole. AC4.

Verified at citadel `main@a9b47f8`, citadel-data `main@313c64e`.

## 3. [BE] Foundry: hand a job its revision's spec and arch doc

## Summary

Extends the host-side hydration (CTD-190) with one more source. For a root job whose ticket
has a parent, and whose parent has a filed revision under `ARGUS_DATA_DIR`, the task gains
`### Spec: <feature>` and `### Arch: <feature>` blocks for each feature the revision names,
after the linked issues and before the named files. `forge-spec` learns to keep the cited ids.

## Background

A ticket cut from a revision already carries the spec's wording in its ACs, but the job's
spec step still reads only the ticket and rebuilds the feature's intent from prose and code.
The revision and the arch doc are the research; the host can read both from citadel-data,
where the forge cannot see. This is the leverage point of CTD-192: the job starts from a
reviewed spec and confirms it rather than deriving one.

## Scope / Out of Scope

In scope:

- `web/src/features/jobs/server/linear-link.ts` — the fetched issue carries its parent
- `web/src/features/jobs/server/task-context.ts` — the revision source, between issues and files
- `web/src/features/jobs/server/job-runner.ts` — the data dir handed to the hydration
- `web/src/features/jobs/server/task-context.test.ts` — a temp data dir with one filed revision
- `image/skills/forge-spec/SKILL.md` — one clause in Step 1, one in Step 3; an image build
- `web/README.md` — the Context paragraph

Out of scope:

- Reading a ledger, judging readiness, or any write to citadel-data from Foundry.
- Follow-up jobs; their task is a PR's comments or a check's log.
- Trimming the arch doc to named sections; it goes in whole until a real run shows the cap bite.

## Acceptance Criteria

- [ ] AC1 — A root job on a ticket whose parent has a filed revision under `ARGUS_DATA_DIR`
      is handed `### Spec: <feature>` with the revision's spec and `### Arch: <feature>` with
      the feature's arch doc for every feature the revision names, after the linked issues and
      before the named files, under the same cap; the sys line counts them. (spec jobs S-35)
- [ ] AC2 — With no parent, no revision directory, a revision not `filed`, or no
      `ARGUS_DATA_DIR`, nothing is added and one `sys` line says which; no case fails the job.
      (spec jobs S-35)
- [ ] AC3 — The issue the host fetches for a ticket carries its parent's identifier, and a
      ticket with no parent carries none. (spec jobs S-36)
- [ ] AC4 — Given a `### Spec:` block, the spec step's `~/spec.md` writes each criterion that
      an AC cites as `C<n> (S-m) — <the spec's wording>`, reads the `### Arch:` block before
      the code, and with no such block writes the spec as it does today. (spec jobs S-37)
- [ ] AC5 — The host reads only `revisions/<KEY>/revision.json`, its `specs/`, and
      `<feature>/docs/arch.md` from citadel-data, and the container's env and mounts name
      nothing under it. (spec jobs S-38, spec revisions S-13)

## Pending

- **BE — the revision record (ticket 1)** (Liam) — fixes the `revision.json` shape AC1 reads;
  the parent on `fetchIssue`, the `forge-spec` clauses and the test fixture can proceed on the
  shape in `docs/spec/spec-tickets.md`.

## Technical Notes

- `apps/foundry/web/src/features/jobs/server/linear-link.ts:118-145` — `LinearIssue` and
  `fetchIssue`'s query; add `parent { identifier }` and `parentKey?: string`. AC3.
- `apps/foundry/web/src/features/jobs/server/task-context.ts:225-268` — `hydrateTask`: the
  ticket the task is about is `BRIEF_HEAD`'s key, else the first of `linkedIssueIds`; a new
  `revisionBlocks(parentKey, dataDir)` returns `Block`s labelled `Spec: <feature>` and
  `Arch: <feature>`, spliced between `issues.blocks` and `files.blocks` in the cap loop at
  `:241`; the sys line at `:263` gains the counts. AC1, AC2.
- `apps/foundry/web/src/features/jobs/server/job-runner.ts:508-516` — the call site; the data
  dir comes from `ARGUS_DATA_DIR`, default `~/git/citadel-data`, read the way `FOUNDRY_MAX_JOBS`
  is in the same file; absent or missing on disk means the source adds nothing. AC1, AC2.
- `apps/foundry/web/src/features/jobs/server/task-context.test.ts` — a temp `ARGUS_DATA_DIR`
  with `revisions/CTD-900/revision.json` (`filed`, one feature), one spec and one arch doc; a
  stub `fetchIssue` answering `parentKey: "CTD-900"`. AC1–AC3, AC5.
- `apps/foundry/image/skills/forge-spec/SKILL.md:24` (Step 1) and `:32` (Step 3) — the two
  clauses; `bash apps/foundry/bin/foundry build` after. AC4.
- `apps/foundry/web/README.md` — the Context paragraph names the revision source and the order.

Verified at citadel `main@a9b47f8`, citadel-data `main@313c64e`.

## 4. [BE] Argus: reconcile folds a Done revision and archives a Cancelled one

## Summary

Adds a pass to `argus reconcile` over filed revisions. A parent Linear reports Done is
folded: each feature's spec is written over its `docs/spec.md`, a `product.md` beside it is
deleted, and the directory moves to the archive as `done`. A parent reported Canceled moves
to the archive as `dropped`. Anything else is left alone, and the commit carries the fold.

## Background

A revision in flight is a promise about the feature's spec; the baseline must not change
until the work is live. Reconcile is already the pass that reads Linear once per run and
settles tickets from it, so the parent's state is one more key in the same call, and the fold
is a copy because the revision carries each feature's whole spec.

## Scope / Out of Scope

In scope:

- `scripts/argus/blockers.ts` — the revision pass in `reconcileAll`, after the ledgers
- `scripts/argus/revision.ts` — `fold` and `archive`, used by the pass and by `drop`
- `scripts/argus.ts` — the `reconcile` verb's output and the commit message
- `scripts/argus/blockers.test.ts` — the fold and the archive against a temp root

Out of scope:

- Sub-issue states; the ledgers' tickets settle as they do today.
- A warning or refusal when two revisions fold onto one feature.
- Anything Pensieve shows about a fold.

## Acceptance Criteria

- [ ] AC1 — A filed revision whose parent Linear reports Done has each `specs/<app>/<dir>.md`
      written over that feature's `docs/spec.md` with `revised_by` set to the key, `docs/`
      created when absent, a `product.md` beside it deleted, and its directory moved to
      `revisions/archive/<KEY>/` with status `done`, `at.settled` and the ticket as evidence.
      (spec reconcile S-9)
- [ ] AC2 — A filed revision whose parent Linear reports Canceled moves to the archive as
      `dropped` with the ticket as evidence; no spec is written, no `product.md` touched.
      (spec reconcile S-10)
- [ ] AC3 — A revision whose parent is open, or whose state is unknown, is byte-for-byte
      unchanged, and a second run after a fold writes nothing. (spec reconcile S-11)
- [ ] AC4 — The parents' keys are in the one `ticketStates` call the run makes; the verb's
      output names each revision moved; the run's commit message names the first.
      (spec reconcile S-12)

## Pending

- **BE — the revision record (ticket 1)** (Liam) — `fold` and `archive` live in its
  `revision.ts`; the pass in `reconcileAll` and its tests wait on it.

## Technical Notes

- `apps/argus/scripts/argus/blockers.ts:154-170` — `reconcileAll`: `openKeys` at `:161`
  gains the filed revisions' parent keys before the `states` call at `:162`; the pass runs
  after the ledger loop and `ReconcileResult` gains `revisions: string[]`. AC1–AC4.
- `apps/argus/scripts/argus/linear.ts:15-21,52` — `TicketState` (`done` | `canceled` | `open`
  | `unknown`) and `ticketStates`, reused as-is. AC3, AC4.
- `apps/argus/scripts/argus/revision.ts` (ticket 1) — `fold(rev)` copies each spec to
  `specDocPath`, rewrites `revised_by`, unlinks `docs/product.md` when present, sets the
  record and renames the directory in that order, so a crash leaves the spec written and the
  revision still filed, and the next run finishes it. AC1, AC3.
- `apps/argus/scripts/argus.ts:168-172` — the `reconcile` verb prints the moved revisions;
  `apps/argus/skills/sweep/SKILL.md:38` — the commit message rule, which the first moved
  revision joins. AC4.
- `apps/argus/scripts/argus/blockers.test.ts` — a temp root with one filed revision and a
  stub `TicketStates`; three cases: done, canceled, open. AC1–AC3.

Verified at citadel `main@a9b47f8`, citadel-data `main@313c64e`.
