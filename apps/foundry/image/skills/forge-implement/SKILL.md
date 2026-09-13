---
name: forge-implement
description: Implements ~/plan.md — or, with none, ~/spec.md's criteria — one slice at a time until every red test is green, then runs the suite, typecheck and lint once each. Use when the tests for ~/spec.md's criteria are red.
---

# forge-implement — the plan, to green

## Overview

The spec says what, the plan says where, the tests say when it is done. Write the simplest code that makes each slice's tests pass, in the repo's conventions, and never make a test pass by changing what it asserts. Adapted from `incremental-implementation` in addy-agent-skills (MIT, © 2025 Addy Osmani): the GREEN and REFACTOR halves, sliced by criterion, with "want me to also fix…" turned into a `Noticed, not touched` list.

## When to Use

- The tests for `~/spec.md`'s criteria are red; `~/plan.md`, when there is one, says where and in what order

**When NOT to use:** no `~/spec.md`; no red and no does-not-compile-yet tests (nothing to implement — say so and stop).

## Handoff

Reads `~/plan.md` when there is one (`Change`, `Criteria → code`, `Order`, `Not doing`), `~/spec.md` (Commands, Assumptions) and the red list in the previous step's final message when this session has one. Stops with no edits on a `## Blocked` section. Writes production code; changes a test only under Step 3, never deletes, skips or weakens one.

## Step 1: Start from the red list

Run the spec's test command once: the failures must match the red list, same names, same reasons. A test red for another reason, or not on the list, is understood first and recorded in the Finish. Then follow the plan's `Order`; do not re-plan. With no plan, the criteria in order and the files their tests exercise stand in for it wherever this skill says "the plan".

## Step 2: One slice at a time

For each slice: implement the smallest complete piece, the obviously-correct version first; run that slice's test files only (`bun test path/to/file.test.ts`); keep the build compilable by fixing every caller of a changed type here, found by reading the callers the plan named; move on. After each slice ask: fewer lines? an abstraction earning its keep? would the neighbouring code's author say "why didn't you just…"? Three similar lines beat a premature abstraction.

```
Slice 1 — C1: queries.ts listJobs({ status })       bun test queries.test.ts → C1 green
Slice 2 — C1: routes/jobs.tsx renders the select     bun test routes/jobs.test.tsx → C1 green
Step 4                                               bun test → 215 pass · typecheck clean · lint clean
```

Naming, placement, idioms and comment density come from the surrounding code; the helper the plan named is reused, not near-duplicated; the repo notes and `CLAUDE.md` hold. Touch only what the plan touches. Anything worth doing outside it goes on a list:

```
NOTICED, NOT TOUCHED
- features/jobs/queries.ts has an unused import (unrelated)
```

## Step 3: When a test is wrong

A red test goes green by changing the code, with one exception: it asserts something the spec's criterion does not say. Then the test changes, only to match the criterion, and the Finish names it. A test that cannot go green without breaking the spec is left red and the Finish says so. When the plan is wrong once in the code, correct course by the smallest deviation that keeps the criteria, and say so.

## Step 4: The whole suite, typecheck and lint, once each

Run the three commands from `~/spec.md` once each and fix what they find; a command runs again only after a fix it forced. Whether a failure is pre-existing is under the spec's Assumptions: read it, never stash and rerun. A lint that auto-fixes runs when the repo's own scripts do. Then read `git diff` once as a reviewer: every changed file is one the plan named or a compile error forced; no debug line, no leftover fixture.

## Finish

End with the criteria implemented by slice; the three commands and results, one line each; every deviation and every test changed under Step 3, with the reason; `Noticed, not touched`; anything left red. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'd do it differently from the plan" | The plan was reviewed; the alternative was not. Deviate only where the code forces it, and say so. |
| "I'll loosen the assertion, the spirit is the same" | The assertion is the criterion. Loosening it reports green on something untested. |
| "Is that lint error mine? I'll stash and check" | The spec recorded the base state. Read it. |
| "I'll run the full suite after each slice" | The slice's own test files say the slice is done; the full suite says the change is done, once. |

## Red Flags

- A test edited, skipped or loosened without a Step 3 reason in the Finish
- A file changed that neither the plan nor a compile error named
- The suite, typecheck or lint run with no edit in between, or a stash-and-rerun

## Verification

- [ ] Every red-list test is green, or left red with the reason in the Finish
- [ ] Suite, typecheck and lint ran once each after the last edit and pass
- [ ] Every changed file is one the plan named or a compile error forced
