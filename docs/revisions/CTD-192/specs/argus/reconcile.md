---
feature: argus/reconcile
revised_by: CTD-192
next_id: 14
---
# Spec: Reconcile

## Objective

`argus reconcile` is the pass after a batch is placed that settles what the facts allow without
a person: blockers clear when what they wait on has landed and deployed, tickets settle when
Linear or a live landing says so, and their asks follow. Linear is read once per run and never
written. This first revision states what the pass does today and adds what CTD-192 asks of it:
a revision whose parent settles is folded into each feature's live spec, or archived.

## Criteria

- S-1 — A `landing` blocker clears when the landing it names is on the ledger and is live: on
  the frontend once merged to the base branch, on the backend once Bitbucket reports the
  merge's pipeline succeeded; it records the date and the PR or commit as evidence.
- S-2 — A `ticket` blocker clears when the named ticket is done: settled `done`, or every ask it
  serves closed.
- S-3 — An `answer` blocker is a person's to clear; reconcile never touches it.
- S-4 — A ticket Linear reports Done settles `done` and every open ask it serves closes with the
  ticket as evidence; one reported Canceled settles `dropped` and drops them.
- S-5 — A ticket that serves no ask settles `done` once a landing carrying its key is live.
- S-6 — An ask whose ticket's key is on a landing moves to `built` with the PR as evidence, and
  to `closed` once that landing is live.
- S-7 — Linear is asked once per run for every ticket still open; a key it does not list, a
  failed request or a missing credential leaves that ticket as it was, and nothing is ever
  written to Linear.
- S-8 — The pass is safe to repeat: a ledger nothing moved is not written, and a changed ledger
  is validated and written whole.
- S-9 — A filed revision whose parent Linear reports Done is folded: each of its
  `specs/<app>/<dir>.md` is written over that feature's `docs/spec.md` with `revised_by` set
  to the revision's key, `docs/` created when the feature has none, and a `product.md` still
  beside it deleted; the revision's directory then moves to `revisions/archive/<KEY>/` with
  status `done`, `at.settled` set, and the parent ticket as evidence.
- S-10 — A filed revision whose parent Linear reports Canceled moves to the archive with status
  `dropped` and the ticket as evidence; no spec is written and no `product.md` is touched.
- S-11 — A revision whose parent is open, or whose state Linear could not report, is left
  exactly as it was; a second run after a fold writes nothing.
- S-12 — The parents' keys join the one Linear call the run already makes for open tickets; the
  result names each revision moved, and the run's commit message names the first.
- S-13 — The run's commit includes `revisions/**` and every `docs/spec.md` a fold wrote,
  alongside what it commits today.

## Out of scope

- Clearing an `answer` blocker, or closing an ask, on a guess: those are the reader's and the
  user's.
- Warning or refusing when two revisions fold onto one feature: last-settled-wins for now.
- Anything Pensieve shows about a fold: the next slice.

## Assumptions

- Criteria S-1 to S-8 are the pass as `blockers.ts` implements it at `main`, restated as outcomes.
- A fold is a file copy plus a rename because the revision carries each feature's whole spec,
  not a delta; the merge happened in the interview.
- The lifecycle follows the parent only. Sub-issue states are Linear's business, and the
  ledgers' tickets settle as they do today.

## Retired

- none
