---
name: forge-implement
description: Implements ~/plan.md one criterion at a time until every test forge-test wrote is green, then typecheck and lint pass. Simplest code that works, repo conventions over habit, no re-planning beyond what the code forces, no skipped tests. Use as the step after forge-test in a QA blueprint.
---

# forge-implement — the plan, to green

## Overview

The spec says what, the plan says where, the tests say when it is done. This step writes the production code, one slice of the plan at a time, running the tests after each, until the red list from `forge-test` is green and the whole suite, the typecheck and the lint pass. The simplest code that makes a test pass is the code to write; the repo's conventions win over general habit; and a failing test is never made to pass by changing what it asserts, unless the test contradicts the spec and the message says so.

Adapted from `incremental-implementation` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: the GREEN and REFACTOR halves of the TDD cycle, sliced by criterion, with the "want me to also fix…" questions that skill asks turned into a `Noticed, not touched` list.

## When to Use

- As the fourth step of the "Spec → QA" or "Bug → Fix" blueprint, after `forge-test`; in a bug run the plan came from `forge-debug` and its `Change` is the root cause's fix, never the symptom's
- Whenever `~/plan.md` exists and the tests for its criteria are red

**When NOT to use:** no `~/plan.md` (run `forge-plan`); no red tests and no does-not-compile-yet tests (nothing to implement — say so and stop).

## Handoff

Reads `~/plan.md` (`Change`, `Criteria → code`, `Order`, `Not doing`), `~/spec.md` (Commands, Assumptions), and the red list in `forge-test`'s final message, which is in this session. If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message. Writes production code. Changes a test only under Step 4's rule, and never deletes, skips or weakens one.

## Step 1: Start from the red list, not the plan

Run the spec's test command once before editing. The failures must match the red list `forge-test` reported: the same names, red for the same reasons. A test that is red for a different reason, or a test that is not on the list, is the first thing to understand — the base may have moved, or the previous step's note was wrong. Record what you find; it goes in the Finish under Assumptions.

Then take the plan's `Order` as the order. Do not re-plan: the plan was reviewed, and second-guessing it beyond what the code forces produces a change that matches neither the plan nor the spec.

## Step 2: One slice at a time, to green

For each slice in `Order`:

1. **Implement** the smallest complete piece that makes that slice's tests pass — the naive, obviously-correct version first
2. **Run** the test command; the slice's tests go green and nothing else goes red
3. **Check** the build stays compilable: a type changed here has every caller fixed here, not three slices later
4. **Move on** — carry forward, never restart

```
Slice 1 — C1: queries.ts listJobs({ status })       bun test → C1 green, 213 pass
Slice 2 — C1: routes/jobs.tsx renders the select     bun test → C1 green, 214 pass
Slice 3 — C2: filter read from search params         bun test → C2 green, 215 pass
```

Simplicity check after each slice, before the next:

- Can this be done in fewer lines?
- Is this abstraction earning its keep, or is it built for a requirement the spec does not have?
- Would the person who wrote the neighbouring code say "why didn't you just…"?

Three similar lines beat a premature abstraction. Generalise at the third use, not the first.

## Step 3: Conventions over habit

The code has to read as if the repo's regular author wrote it:

- Naming, file placement, comment density and idioms come from the surrounding code, not from a general style
- Reuse the helper the plan named; do not write a near-duplicate because the existing one is a line away from fitting
- Repo notes in the system prompt, `CLAUDE.md` and `CONTRIBUTING.md` hold: the package manager, what to verify with, changelog or changeset files the repo requires with a change
- For UI: the shared components `ui:list` reported in the plan, not a one-off element

Touch only what the plan touches. Adjacent cleanups, import reordering in files you only read, modernising syntax you passed by — none of it. Anything worth doing outside the plan goes on a list:

```
NOTICED, NOT TOUCHED
- features/jobs/queries.ts has an unused import (unrelated)
- the error toast in routes/jobs.tsx could name the job (separate change)
```

## Step 4: When a test is wrong

A red test is made green by changing the code, with one exception: the test asserts something the spec's criterion does not say. Then the test changes, and only to match the criterion, and the Finish names the test, the criterion, and what was wrong. A test is never skipped, commented out, deleted, or loosened to pass. A test that cannot be made green without breaking the spec is left red, the slice is finished otherwise, and the Finish says so — that is an outcome the verify step and a reader can act on; a green suite that lies is not.

When the plan turns out to be wrong once you are in the code — the helper it named does not fit, the file it named is not where the behaviour lives — correct course by the smallest deviation that keeps the criteria, and say so in the Finish. If part of the plan is blocked, finish every other part and state plainly what was left out and why.

## Step 5: The whole suite, then typecheck and lint

With every slice done, run the three commands from `~/spec.md` — test, typecheck, lint — and fix what they find. Run each again only after a change that could affect it; a clean run repeated on unchanged code adds nothing. A lint that auto-fixes (`ultracite fix`, `biome check --write`, `eslint --fix`) is run when the repo's own scripts do; its edits are part of this step's diff.

Then read `git -C /work status --porcelain` and `git diff` once, as a reviewer: every changed file is one the plan named or one a compile error forced; no stray file, no debug line, no leftover fixture.

## Finish

End with: the criteria implemented, keyed to the slices; the test, typecheck and lint commands run and their results in one line each; every deviation from the plan and every test changed under Step 4, with the reason; the `Noticed, not touched` list; and anything left red or left out, with why. `forge-verify` reads this to know what to check hardest. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The plan's approach is fine but I'd do it differently" | The plan was reviewed; a different approach was not. Deviate only where the code forces it, and say so. |
| "This test is flaky, I'll skip it for now" | A skipped test is a criterion nobody checks. Leave it red and say why; the verify step and the reader decide. |
| "I'll loosen the assertion, the spirit is the same" | The assertion is the criterion. Loosening it makes the criterion untested while reporting green. |
| "While I'm in this file I'll tidy the imports" | The diff is the PR. Every unrelated line is a line a reviewer has to reason about. `Noticed, not touched`. |
| "Let me run the suite again to be sure" | After a clean run, rerunning unchanged code adds nothing. Run after the next edit. |
| "I'll ask whether they want the generic version" | Nobody answers. Write the specific version the spec asks for; generalise at the third use. |

## Red Flags

- A test edited, skipped, deleted or loosened without a Step 4 reason in the Finish
- A new helper whose name describes something the repo already has
- A file changed that neither the plan nor a compile error named
- A slice whose tests pass while an earlier slice's went red
- A Finish that reports "tests pass" with no command and no count
- A final message that ends on a question

## Verification

- [ ] Every test on `forge-test`'s red list is green, or left red with the reason in the Finish
- [ ] The test, typecheck and lint commands from `~/spec.md` were run after the last edit and pass
- [ ] Every changed file is one the plan named or a compile error forced; `Noticed, not touched` holds the rest
- [ ] No test was skipped, deleted or weakened
- [ ] The final message ends on a statement
