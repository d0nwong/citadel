---
feature: argus/revisions
revised_by: CTD-192
next_id: 14
---
# Spec: Revisions

## Objective

A revision is one confirmed piece of work — the intent, the revised spec of every feature it
touches, and the plan that cuts it into tickets — keyed by the Linear parent that carries it
and kept in citadel-data from draft to filed to done or dropped. `/scope` is how a revision is
made: a ramble is clarified by interview into an intent, the intent into revised feature specs,
the specs into a plan, and the plan into a parent with sub-issues. The human's effort goes to
the spec; Foundry does the rest. This is the feature's first revision; everything in it is new.

## Criteria

- S-1 — `argus revision new <slug> --title <t> --feature <app>/<dir> [--feature …]` creates
  `revisions/<slug>/revision.json` with status `draft`, `at.drafted` set and the features
  listed, and refuses a slug already in use or a feature with no directory under an app.
- S-2 — `argus revision show <slug|KEY>` prints the record as JSON, from `revisions/` or its
  archive, and names the missing directory when there is none.
- S-3 — `argus revision file <slug> <KEY> --tickets K1,K2,…` moves a draft to `filed`: the key,
  the tickets in order, `at.filed` and the parent ticket as evidence are recorded and the
  directory is renamed to the key; it refuses a revision that is not a draft, a key that is not
  a ticket key, or an empty ticket list.
- S-4 — `argus revision drop <slug|KEY> --reason <why>` moves a draft or a filed revision to
  `revisions/archive/` with status `dropped` and the reason as evidence, and refuses one
  already done or dropped.
- S-5 — `argus validate` refuses a `revision.json` whose status is not one of the four, that
  names a feature with no directory, or that is `filed` without a key or tickets; and refuses
  a spec, under `specs/` or at `docs/spec.md`, that is over 250 curated lines, repeats an
  `S-n`, or carries an id at or past its `next_id`.
- S-6 — No verb deletes anything under `revisions/`; the archive is the only exit, and a
  revision arrives there whole.
- S-7 — `argus/` is an app in citadel-data like `foundry/` and `pensieve/`: a feature manifest
  and `features/revisions/` and `features/reconcile/`, each empty until a fold writes its spec.
- S-8 — `/scope <ramble | key | path>` grounds itself before its first hypothesis: the ledger
  through `argus show`, the feature's `docs/spec.md` and `docs/arch.md` as the baseline,
  `accio find` for where a screen or field lives, and the issue itself when the argument is a
  ticket key.
- S-9 — Each of the skill's five steps ends on the user's explicit yes before its file is
  written; "sounds good" and "whatever you think" are re-asked, never taken as yes.
- S-10 — The interview writes `intent.md` in the house shape; the spec step writes each
  feature's spec under `specs/`, edited from the baseline or, for a feature with none, written
  from the arch doc, `product.md`, the ledger's requirement rows and the conversation, with new
  criteria numbered from `next_id` and removed ones under `## Retired` with the revision's key;
  the plan step writes `plan.md` as a numbered ticket list with criteria and blockers followed
  by one six-section body per ticket whose ACs each cite an `S-n`; a doubt pass runs over the
  spec and the plan before each is shown.
- S-11 — The filing step adopts an existing issue as the parent under `--parent <KEY>`, adding
  a line to its description that points at the revision, or creates one on the team the
  features name; creates each sub-issue with `parentId`, `blockedBy` from the plan and the
  body verbatim; then records them with `argus revision file`; it never changes a ticket's
  state, never runs `reconcile` or `commit`, and writes nothing outside `revisions/<slug>/`.
- S-12 — `skills/scope/SKILL.md` is under 100 lines; `interview.md`, `spec.md` and `plan.md`
  beside it carry the process adapted from the addy `agent-skills` plugin with an MIT
  attribution line each, and nothing in the skill loads the plugin.
- S-13 — A revision's files are the ones a Foundry job is handed: a job on a sub-issue whose
  parent is a filed revision receives that revision's spec for each feature it names.

## Out of scope

- Running `/scope` from Pensieve's Ask, and any page in Pensieve that shows a revision.
- A parser for `plan.md`; the skill files from the plan it just wrote.
- A revision as a delta; it carries each feature's whole spec.
- `idea-refine`: the interview's guesses carry its divergent move.

## Assumptions

- Markdown under a revision is the skill's to write and `revision.json` is the verbs', the
  same split as `arch.md` and `ledger.json`.
- Filing is the Linear MCP write tools from a terminal, as `linear-ticket` does; Argus itself
  never writes Linear.
- Two revisions in flight on one feature both start from the same baseline; the fold is
  last-settled-wins.

## Retired

- none
