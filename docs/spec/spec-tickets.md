# Spec: a ramble becomes a spec, and the spec becomes the tickets (CTD-192)

Status: draft for review. Intent: `docs/intent/spec-tickets.md` (confirmed 2026-09-13).
Pensieve — the revisions pages, a spec tier on the docs page, and running the interview from
Ask — is the next slice and gets its own spec once this lands.

## Objective

Put the one human at the spec. A ramble is clarified by interview into an intent and a revised
feature spec, the revision is cut into a Linear parent with sub-issues, Foundry runs those with
the spec and the arch doc as its research, and the feature's live spec changes only when the
parent settles Done. When this is done:

- `/scope` in a terminal, on a ramble or a ticket of notes, ends with `revisions/<KEY>/` in
  citadel-data holding the intent, the revised spec of every feature it touches and the plan,
  and a Linear parent whose sub-issues carry Acceptance Criteria that cite the spec's ids.
- A Foundry job ignited on one of those sub-issues is handed the revision's spec and the
  feature's arch doc before its container starts, and its spec step confirms the spec rather
  than deriving one from prose.
- `argus reconcile` folds a revision whose parent is Done into each feature's `docs/spec.md` and
  archives it; a Cancelled one is archived untouched. Nothing under `revisions/` is deleted.
- The intent, spec and plan files written so far, in this repo and in `apps/argus/docs`, live
  in `revisions/archive/`, moved by hand once the layout exists.

## Assumptions

1. **The revision is the whole feature spec as it will read once it is live, not a delta.** The
   interview starts from the feature's `docs/spec.md` (or, the first time, from the arch doc,
   `product.md`, the ledger's requirement rows and the conversation) and edits it. Folding is
   then a copy, which code can do in reconcile; the diff between baseline and revision is what
   the plan cuts into tickets. A revision that touches two features carries two revised specs.
2. **A feature's spec is `docs/spec.md` beside its arch doc, under the same 250-line cap, and
   it retires `product.md` where one is left.** The Argus rebuild deleted `product.md` for
   every Alden feature (Task 30, citadel-data `d8f3405`) and made the ledger's requirement rows
   the business's product doc; Foundry's and Pensieve's features kept theirs because they have
   no ledgers and nothing replaced it. The spec is that replacement: `/scope` reads `product.md`
   as a source for a feature's first revision, and the fold that lands it writes `docs/spec.md`
   and deletes `product.md`. Alden's features gain `spec.md` beside the ledger and the arch
   doc. A criterion cites the rule it
   implements where one exists: `(R-3)`.
3. **Markdown is the skill's to write; JSON is the verbs'.** The same split as `arch.md`
   (written by the feature-docs subagent) and `ledger.json` (written only by `argus write`):
   `intent.md`, `specs/*.md` and `plan.md` are written by the skill and by reconcile,
   `revision.json` only by `argus revision …` and `argus reconcile`.
4. **The `scope` skill copies and adapts the addy plugin's skills, as Foundry's did; it does
   not load them by name.** `SKILL.md` is the run, under Argus's 100-line cap, and three
   companion files carry the process with an MIT attribution line each: `interview.md` from
   `interview-me`, with the grounding to read before the first hypothesis and a
   three-variations move for a restate that will not converge on a shape; `spec.md` from
   `spec-driven-development`'s Specify phase, ending in `doubt-driven-development`'s
   self-review; `plan.md` from `planning-and-task-breakdown`, ending in the same self-review
   before the plan is shown. `idea-refine` is not copied: its one-pager is the intent doc by
   other names, and the interview's guesses already carry its divergent move. Copying costs
   drift from the plugin and buys no dependency on anything outside the repo, which the Ask
   slice needs.
5. **Filing from a terminal is the Linear MCP write tools, as `linear-ticket` does; Argus
   never writes Linear.** `argus revision file` only records what was filed. The parent may be
   an existing issue (`--parent CTD-192`), which is how this revision itself is filed.
6. **Foundry's host reads citadel-data; the forge still cannot see it.** The hydration
   (CTD-190) runs on this Mac, where `ARGUS_DATA_DIR` is, so it can read a revision's spec and a
   feature's arch doc and hand them in with the task. It reads no ledger and judges nothing.
7. **The lifecycle follows the parent only.** Reconcile reads the parent's state through the
   existing `ticketStates`; the sub-issues' states are Linear's business, and the ledgers'
   tickets settle as they do today.
8. **Archive, never delete.** `revisions/archive/<KEY>/` keeps a dropped revision whole: it is
   evidence of what was considered.
9. **Criterion ids are `S-n`, unique within a feature's spec and never reused.** The spec's
   frontmatter carries `next_id`; a criterion a revision removes moves to `## Retired` with the
   revision's key. Sub-issue ACs cite them: `AC2 — … (spec S-12)`.
10. **Two revisions in flight on one feature are allowed; folding is last-settled-wins.** Both
    revisions started from the same baseline, so the second fold overwrites the first's
    additions. A warning on the second fold is an open question.
11. **Argus becomes an app in citadel-data.** The tree has `alden/`, `foundry/` and `pensieve/`
    and no `argus/`, so this revision's own Argus work has nowhere to put its spec. Ticket 1
    adds `argus/.doc-workspace/feature-manifest.json` and `argus/features/<dir>/` for the
    features it touches — `revisions` (the record, the verbs, the skill) and `reconcile` — with
    no arch doc yet; `feature-docs` writes those later. `product.md` retires feature by feature:
    Foundry's eight and Pensieve's five go on the first fold that lands each feature's spec, and
    a feature nobody revises keeps its `product.md`. A one-off seeding pass to give every
    feature a baseline is a later decision.

→ Correct any of these now; otherwise they stand.

## Tech stack

- Argus: Bun, TypeScript, `scripts/argus/*.ts` with tests beside them; skills as markdown with
  YAML frontmatter under `apps/argus/skills/`, symlinked into `~/.claude/skills` by
  `bun run sync-skills`.
- Foundry web: Bun/TS, `bun:test`; the hydration in
  `apps/foundry/web/src/features/jobs/server/task-context.ts`.
- No new dependencies in any app. No image rebuild for Foundry except the one-clause change to
  `forge-spec` (skills are baked into the image).

## Commands

```sh
# argus, from the repo root (ARGUS_ROOT points at citadel-data; ~/git/citadel-data by default)
argus revision new <slug> --title "<title>" --feature <app>/<dir> [--feature …]   # revisions/<slug>/revision.json, status draft
argus revision show <slug|KEY>                             # the record
argus revision file <slug> <KEY> --tickets K1,K2,…         # draft → filed; the directory is renamed to KEY
argus revision drop <slug|KEY> --reason "<why>"            # → revisions/archive/, status dropped
argus reconcile                                          # + filed revisions: parent Done → fold + archive; Canceled → archive
argus validate                                           # + every revision.json, every specs/*.md and docs/spec.md
cd apps/argus && bun test && bun run typecheck

# foundry web, from the repo root
bun run --filter foundry-web typecheck
bun run --filter foundry-web test src/features/jobs/server/task-context.test.ts
bash apps/foundry/bin/foundry build                      # after the forge-spec clause

# the skill, from any terminal on this Mac
/scope <ramble, a ticket key, or a path to notes>
```

## Project structure

```
citadel-data/                                   ARGUS_ROOT
  revisions/
    <slug>/                                     a draft: not yet filed
    <KEY>/                                      filed: the parent ticket's key
      revision.json                               the record — verbs only
      intent.md                                 the interview's restate, confirmed
      specs/<app>/<dir>.md                      each feature's spec as it will read once live
      plan.md                                   the ticket breakdown: parent, sub-issues, order
    archive/<KEY or slug>/                      done or dropped, whole
  <app>/features/<dir>/docs/spec.md             the feature's live spec — written only by a fold
  argus/.doc-workspace/feature-manifest.json    new: Argus as an app, like foundry/ and pensieve/
  argus/features/revisions/  argus/features/reconcile/   new, empty until the first fold

apps/argus/
  scripts/argus/
    revision.ts                                 the record: read, new, file, drop
    revision.test.ts
    blockers.ts                                 + fold and archive in reconcileAll
    validate.ts                                 + validateRevision, validateSpec (ids, next_id, cap)
    commit.ts                                   COMMITTABLE + ^revisions/ and docs/spec.md
    paths.ts                                    + revisionsDir, revisionDir, archiveDir, specDocPath
  scripts/argus.ts                              + the revision verbs; reconcile and validate widened
  skills/scope/SKILL.md                       the run: grounding, five steps, handoffs, filing, Finish; ≤100 lines
  skills/scope/interview.md                   from interview-me (MIT), + grounding and the three-variations move
  skills/scope/spec.md                        from spec-driven-development's Specify (MIT), + the doubt pass
  skills/scope/plan.md                        from planning-and-task-breakdown (MIT), + the doubt pass
  skills/scope/SHAPES.md                      the four files' shapes, quoted below
  README.md  SPEC.md                            the record gains a section; the Foundry row loses "never reads"

apps/foundry/
  web/src/features/jobs/server/
    linear-link.ts                              fetchIssue + parent { identifier }
    task-context.ts                             + the revision source: spec and arch blocks
    task-context.test.ts                        + a temp ARGUS_DATA_DIR
    job-runner.ts                               passes the data dir
  web/src/shared/env.ts (or where the others are) ARGUS_DATA_DIR, default ~/git/citadel-data
  image/skills/forge-spec/SKILL.md              Step 1 reads a Spec block; Step 3 keeps its ids
  web/README.md                                 the Context paragraph gains the revision source

citadel/
  docs/intent/  docs/spec/                      emptied by the move (a chore, not a ticket); README points at revisions/
  apps/argus/docs/intent/  docs/ideas/          moved too
```

## The revision

`revision.json` is the record, in the ledger's style: small, validated, ids and evidence.

```jsonc
{
  "slug": "spec-tickets",
  "key": "CTD-192",                       // absent while a draft
  "title": "A ramble becomes a spec, and the spec becomes the tickets",
  "status": "filed",                      // draft | filed | done | dropped
  "features": ["foundry/jobs", "argus/revisions", "argus/reconcile"],   // <app>/<dir>, as Pensieve addresses them
  "tickets": ["CTD-193", "CTD-194"],      // the sub-issues, in plan order
  "at": { "drafted": "2026-09-13", "filed": "2026-09-13", "settled": null },
  "evidence": [ { "kind": "ticket", "key": "CTD-192", "url": "https://linear.app/…" } ]
}
```

Lifecycle, and who moves it:

| from | to | by | what happens |
|---|---|---|---|
| — | `draft` | `argus revision new` | `revisions/<slug>/revision.json`; the skill writes the markdown beside it |
| `draft` | `filed` | `argus revision file` | the key and tickets recorded, `at.filed` set, the directory renamed to the key |
| `draft` or `filed` | `dropped` | `argus revision drop`, or reconcile on a Cancelled parent | moved to `revisions/archive/`, reason or the ticket as evidence |
| `filed` | `done` | reconcile on a Done parent | each `specs/<feature>.md` copied to `<feature>/docs/spec.md` with `revised_by: <KEY>`, then moved to `revisions/archive/` |

`argus validate` refuses: a status not in the four; a feature with no directory under an app; a
`filed` revision with no key or no tickets; a spec file over the cap, with a duplicate `S-n`, or
with an id at or past `next_id`. `argus commit` may commit `revisions/**` and `docs/spec.md`, alongside what it commits today.

## The feature spec

One per feature, the same file whether it sits under `revisions/<KEY>/specs/` as a revision or at
`<feature>/docs/spec.md` as the baseline. The shape `forge-spec` writes for a ticket, widened to
a feature, so a job can read either the same way:

```markdown
---
feature: foundry/jobs
revised_by: CTD-192          # the revision last folded in; a revision names the revision it belongs to
next_id: 14
---
# Spec: Jobs

## Objective
<the feature in one paragraph: who it is for and what is true when it works>

## Criteria
- S-1 — <the state to set up; what must be observed> (R-3)
- S-12 — <…>                                   ← new in this revision: an id from next_id

## Out of scope
- <what this feature is not, and who owns that>

## Assumptions
- <every decision made in place of a question, and what decided it>

## Retired
- S-7 — <its text> — retired by CTD-192
```

A criterion is an outcome, never a mechanism, worded as the check that would fail if it were
false; two checks are two criteria. Under 250 curated lines, counted the way `arch.md` is. The
first revision of a feature with no spec is written from the arch doc, `product.md` where one
exists, the ledger's requirement rows, and the interview; it covers what the interview settled
and what the code visibly does today, nothing speculative.

## The skill: `scope`

`apps/argus/skills/scope/SKILL.md`, in the agent-skills frame the other Argus skills use, with
Handoff and Finish sections as Foundry's have. One run, five steps, each ending in a file the
user has said yes to:

1. **Interview.** `interview.md` over the argument — a ramble, a ticket key (fetched with
   `mcp__linear__get_issue`), or a path. Before the first hypothesis, the grounding:
   `argus show <feature>` for the ledger, `docs/spec.md` and `docs/arch.md` for the baseline,
   `accio find` for where a screen or field lives. Ends on the explicit yes to the restate.
2. **Intent.** The restate written as `intent.md`, in the shape of `docs/intent/spec-tickets.md`
   (Outcome, User, Why now, Success, Constraints, Out of scope, Sources). Before writing,
   `argus revision new <slug> --title … --feature …` creates the directory and the record.
3. **Spec.** `spec.md`, its output being the revised feature spec(s) under `specs/`, edited
   from the baseline, new criteria taking ids from `next_id`. The plugin's Commands / Project
   Structure / Code Style sections are not written here: they are the repo's, and the job's
   own spec step finds them. The doubt pass runs before the spec is shown. Ends on the user's
   yes.
4. **Plan.** `plan.md` over the diff between baseline and revision, written as the revision's
   `plan.md`: a numbered ticket list with the criteria each implements and what blocks it, then
   one six-section body per ticket in `linear-ticket`'s `FORMAT.md`, each AC citing its `S-n`.
   The doubt pass runs before the plan is shown. Ends on the user's yes.
5. **File.** With `--parent <KEY>` the existing issue becomes the parent (its description gains
   a line pointing at the revision); otherwise the parent is created on the team the features
   name (Citadel for Foundry, Argus and Pensieve; Alden otherwise). Sub-issues are created with
   `parentId`, `blockedBy` from the plan, and the body verbatim; then
   `argus revision file <slug> <KEY> --tickets …`. The Finish line names the parent, the tickets
   and the directory. The skill never marks a ticket's state.

`SHAPES.md` beside it carries the four shapes above and the plan's, and the three companion
files carry the process, so the SKILL.md stays under the cap. The skill writes nothing outside `revisions/<slug>/`, runs no `argus` verb but `revision`
and `show`, and never runs `reconcile` or `commit`; the sweep commits on its next tick.

**`plan.md` shape:**

```markdown
# Plan: CTD-192 — <title>

## Tickets
1. [BE] <title> — S-12, S-13 — blocked by: none
2. [FE] <title> — S-14 — blocked by: 1

## 1. [BE] <title>
<the six sections per FORMAT.md; each AC ends "(spec S-12)">

## 2. [FE] <title>
…
```

The skill files from the plan it just wrote; nothing parses `plan.md` in this slice. A parser
for Pensieve's File button comes with the next slice.

## Reconcile

`reconcileAll` gains a pass over `revisions/*/revision.json` with status `filed`, after the ledgers:
the parents' keys join the `ticketStates` call already made for open tickets. `done` folds and
archives; `canceled` archives; `open` and `unknown` leave the revision alone. A fold writes each
revised spec over the feature's `docs/spec.md` (creating `docs/` if the feature has none),
stamps `revised_by`, deletes a `docs/product.md` still beside it, and moves the directory in
one rename. The result lists the revisions moved,
and the run's commit message names the first.

## Foundry

- `fetchIssue` asks for `parent { identifier }` as well; `LinearIssue` gains `parentKey?`.
- `hydrateTask` gains a third source, between issues and files: the ticket the task is about
  (the brief's own key, else the first linked issue) with a parent whose directory
  `revisions/<parent>/` exists under `ARGUS_DATA_DIR` with status `filed`. It appends
  `### Spec: <feature>` with `specs/<feature>.md` and `### Arch: <feature>` with the feature's
  `docs/arch.md`, for each feature the revision names, under the same cap and in that order
  (issues, spec, arch, files). No directory, no parent, or no `ARGUS_DATA_DIR` adds nothing and
  logs one sys line. Nothing here fails a job.
- `forge-spec`, Step 1 gains one clause: a `### Spec:` block in the task's Context is the
  reviewed spec — a criterion whose AC cites `S-n` takes that line's wording and keeps the id
  beside its `C<n>`; the `### Arch:` block is read before the code. Nothing else in Foundry's
  skills changes.

## Pensieve

Nothing in this slice. A revision's files are readable in citadel-data and its status is on
the Linear parent. The next slice, with Ask, adds `/revisions`, a spec tier on the docs page
with a "Revision in flight" line, a plan parser behind a File button, and a baseline-against-
revision view.

## Code style

Argus: double quotes, semicolons, `T[]`, as its files are. Foundry web: single quotes, no
semicolons, `Array<T>`, as its files are; never `ultracite fix` there. Every new
module opens with the comment block the neighbours have: what it is, what it never does.

Skills follow the addy `agent-skills` frame: Overview, When to Use with a "When NOT to use",
Handoff, a numbered process with one example per step, Finish, Common Rationalizations, Red
Flags, Verification. The Argus caps hold: `scope/SKILL.md` ≤100 lines.

## Testing strategy

- **Argus** (`bun test` in `apps/argus`, against a temp `ARGUS_ROOT`): `revision.test.ts`
  covers new, file (rename, tickets recorded), drop (archived, reason kept), and every
  validate refusal above. `blockers.test.ts` gains a fold (a stub `TicketStates`
  answering done; `docs/spec.md` written with `revised_by`; a `product.md` beside it gone; the
  directory under archive) and an archive on canceled. `commit.test.ts` covers the widened
  `COMMITTABLE`.
- **Foundry** (`bun test` on `task-context.test.ts`): a temp data dir with one filed revision; a
  brief whose issue has that parent gains the spec and arch blocks in order; no parent, no
  directory and no env each add nothing; the cap still cuts, never truncates.
- **The skill**: one real run, on this revision, is its test (see Success criteria).

## Boundaries

**Always**

- Validate before every write; a revision or spec that fails validation is never written.
- Keep the caps: `scope/SKILL.md` ≤100 lines, every spec ≤250 curated lines.
- Write markdown from the skill only under `revisions/<slug>/`; write `revision.json` only through
  a verb.
- End every skill step on the user's explicit yes before writing the file.

**Ask first**

- Filing: always the plan shown, then the user's word, then the Linear MCP write.
- Adopting an existing issue as the parent, and editing its description.
- Changing `ledger.json`'s schema, or the arch doc's cap, to fit this. Neither is expected.

**Never**

- Close, cancel or move a Linear ticket from the skill or from reconcile.
- Delete anything under `revisions/`; archive is the only exit.
- Let Foundry read a ledger, or let the forge see citadel-data.
- Write `docs/spec.md`, or delete a `product.md`, except by a fold.
- Touch Pensieve in this slice.

## Build order

One parent, CTD-192, four sub-issues, in this order; 3 and 4 can run in parallel once 1 lands.

1. **[BE] Argus: the revision record** — `revisions/` layout, `revision.json`, `paths`, the four
   `argus revision` verbs, `validateRevision` and `validateSpec`, `COMMITTABLE`, README and SPEC
   sections, and `argus/` as an app in citadel-data with the two feature directories. Proves:
   `argus revision new` → `show` → `file` → `drop` on a temp root.
2. **[BE] Argus: the `scope` skill** — SKILL.md, the three companion files adapted from the
   plugin, SHAPES.md, the filing step. Proves: `/scope` on a ramble ends with the four files
   and a filed parent.
3. **[BE] Foundry: hydrate a ticket from its revision** — `parent` on `fetchIssue`,
   `ARGUS_DATA_DIR`, the spec and arch blocks, the `forge-spec` clause, an image build.
   Proves: a job on a sub-issue logs the blocks, and its `~/spec.md` keeps the `S-n` ids.
4. **[BE] Argus: reconcile folds and archives** — the pass in `reconcileAll`, the fold, the
   archive, the commit message. Proves: a Done parent yields `docs/spec.md` and an archived
   revision on the next tick.

Not a ticket: once 1 lands, one chore commit in citadel-data moves `docs/intent`, `docs/spec`
and `apps/argus/docs/{intent,ideas}` into `revisions/archive/<KEY>/` where the key is known
(CTD-65 for `foundry-skills`; the others from git log, else a slug directory), puts this
revision's own files under `revisions/CTD-192/` as the first filed revision, and points the
READMEs at `revisions/`.

## Success criteria

1. After 1 and 2: `/scope` on the CTD-192 notes, run against this spec's own intent, produces
   `revisions/spec-tickets/` with `intent.md`, `specs/…`, `plan.md`, then files four sub-issues
   under CTD-192 whose ACs cite `S-n` ids, and `argus revision show CTD-192` lists them.
2. After 3: a Foundry job ignited on one of those sub-issues logs
   `context: … 1 spec, 1 arch …`, and the `~/spec.md` its spec step writes carries the cited
   `S-n` beside each `C<n>`, with no criterion derived from the Summary.
3. After 4: with CTD-192 marked Done, the next `argus reconcile` writes `docs/spec.md` for each
   feature the revision names with `revised_by: CTD-192`, deletes their `product.md`, moves the
   directory under `revisions/archive/`, and commits both; a second run writes nothing.
4. After the chore: `docs/intent` and `docs/spec` in this repo are empty, every moved file is
   under `revisions/archive/`, and `argus validate` is clean.
5. Throughout: `bun test` and typecheck green in Argus and Foundry; the two known
   blueprint-name failures in Foundry's suite excepted.

## Open questions

1. **Names, decided 2026-09-13.** The skill is `/scope`, for what it does to a ramble; the
   record is a `revision`, since "feature" is already Citadel's unit of record and a feature
   outlives many parents.
2. **Foundry reading citadel-data.** The Argus SPEC's Foundry row says "never: read the
   ledger". This reads a spec and an arch doc on the host and no ledger; the row should say so.
3. **Two revisions on one feature.** Fold is last-settled-wins (assumption 10). A warning on
   the second fold, or a refusal, is a small addition to 4 if wanted.
4. **Keys for the moved history.** `foundry-skills` is CTD-65; `consolidation`, `monorepo`,
   `ticket-reconcile` and `argus-pensieve-rebuild` need their keys found or slug directories.
