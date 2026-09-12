---
name: forge-implement
description: Implements ~/plan.md one criterion at a time until every red test for its criteria is green, then runs the whole suite, the typecheck and the lint once each. Simplest code that works, repo conventions over habit, no re-planning beyond what the code forces, no skipped tests. Use whenever ~/plan.md exists and the tests for its criteria are red.
---

# forge-implement — the plan, to green

## Overview

The spec says what, the plan says where, the tests say when it is done. This step writes the production code, one slice of the plan at a time, running that slice's test files after each, until the red list — the criterion tests seen failing before this step — is green; then the whole suite, the typecheck and the lint run once each. A full suite costs minutes on a real repo and the job's budget is shared with the steps after this one, so the expensive commands run when they can answer a question and not again. The simplest code that makes a test pass is the code to write; the repo's conventions win over general habit; and a failing test is never made to pass by changing what it asserts, unless the test contradicts the spec and the message says so.

Adapted from `incremental-implementation` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: the GREEN and REFACTOR halves of the TDD cycle, sliced by criterion, with the "want me to also fix…" questions that skill asks turned into a `Noticed, not touched` list.

## When to Use

- Whenever `~/plan.md` exists and the tests for its criteria are red

**When NOT to use:** no `~/plan.md` (write the plan first); no red tests and no does-not-compile-yet tests (nothing to implement — say so and stop).

## Handoff

Reads `~/plan.md` (`Change`, `Criteria → code`, `Order`, `Not doing`), `~/spec.md` (Commands, Assumptions), and the red list the previous step's final message recorded, when this session has one; otherwise the test run in Step 1 is the list. If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message. Writes production code. Changes a test only under Step 4's rule, and never deletes, skips or weakens one.

## Step 1: Start from the red list, not the plan

Run the spec's test command once before editing — the whole suite, this once, because the question is what is red on the untouched base. The failures must match the red list recorded before this step: the same names, red for the same reasons. A test that is red for a different reason, or a test that is not on the list, is the first thing to understand — the base may have moved, or the previous step's note was wrong. Record what you find; it goes in the Finish under Assumptions.

Then take the plan's `Order` as the order. Do not re-plan: the plan was reviewed, and second-guessing it beyond what the code forces produces a change that matches neither the plan nor the spec.

## Step 2: One slice at a time, to green

For each slice in `Order`:

1. **Implement** the smallest complete piece that makes that slice's tests pass — the naive, obviously-correct version first
2. **Run** the test command on the slice's test files only (`bun test path/to/file.test.ts`, `pnpm test src/feature/thing.test.ts`); the slice's tests go green. The whole suite, the typecheck and the lint wait for Step 5
3. **Keep** the build compilable: a type changed here has every caller fixed here, not three slices later — found by reading the callers the plan named, not by running the typecheck after every slice
4. **Move on** — carry forward, never restart

```
Slice 1 — C1: queries.ts listJobs({ status })       bun test queries.test.ts → C1 green
Slice 2 — C1: routes/jobs.tsx renders the select     bun test routes/jobs.test.tsx → C1 green
Slice 3 — C2: filter read from search params         bun test routes/jobs.test.tsx → C2 green
Step 5                                               bun test → 215 pass · typecheck clean · lint clean
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

## Step 5: The whole suite, then typecheck and lint — once each

With every slice done, run the three commands from `~/spec.md` — test, typecheck, lint — once each, and fix what they find. A command runs a second time only after a fix it forced, and then once. A clean run repeated on unchanged code adds nothing; on a repo whose suite takes ninety seconds it takes the budget the verify step needs. A lint that auto-fixes (`ultracite fix`, `biome check --write`, `eslint --fix`) is run when the repo's own scripts do; its edits are part of this step's diff.

Whether a failure is pre-existing is already known: the spec step ran the suite, the typecheck and the lint on the untouched base and wrote their state under `~/spec.md`'s Assumptions. Read that; never stash the change and rerun to find out. A failure the spec did not record is this change's to fix, and one it did record is left alone and named in the Finish.

Then read `git -C /work status --porcelain` and `git diff` once, as a reviewer: every changed file is one the plan named or one a compile error forced; no stray file, no debug line, no leftover fixture.

## Finish

End with: the criteria implemented, keyed to the slices; the test, typecheck and lint commands run and their results in one line each; every deviation from the plan and every test changed under Step 4, with the reason; the `Noticed, not touched` list; and anything left red or left out, with why. The step that verifies reads this to know what to check hardest. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The plan's approach is fine but I'd do it differently" | The plan was reviewed; a different approach was not. Deviate only where the code forces it, and say so. |
| "This test is flaky, I'll skip it for now" | A skipped test is a criterion nobody checks. Leave it red and say why; the verify step and the reader decide. |
| "I'll loosen the assertion, the spirit is the same" | The assertion is the criterion. Loosening it makes the criterion untested while reporting green. |
| "While I'm in this file I'll tidy the imports" | The diff is the PR. Every unrelated line is a line a reviewer has to reason about. `Noticed, not touched`. |
| "Let me run the suite again to be sure" | After a clean run, rerunning unchanged code adds nothing. Run after the next edit. |
| "Is that lint error mine? I'll stash and check" | The spec ran the lint and the typecheck on the untouched base and wrote the result under Assumptions. Read it; a stash-and-rerun costs a minute to learn what is already written down. |
| "I'll run the full suite after each slice, it's safer" | The slice's own test files say whether the slice is done. The full suite says whether the change is done, and that is one question, asked once in Step 5. |
| "I'll ask whether they want the generic version" | Nobody answers. Write the specific version the spec asks for; generalise at the third use. |

## Red Flags

- A test edited, skipped, deleted or loosened without a Step 4 reason in the Finish
- A new helper whose name describes something the repo already has
- A file changed that neither the plan nor a compile error named
- A slice whose tests pass while an earlier slice's went red
- A Finish that reports "tests pass" with no command and no count
- The full suite, the typecheck or the lint run more than once with no edit between, or run per slice; a stash-and-rerun to learn what the spec's Assumptions already record
- A final message that ends on a question

## Verification

- [ ] Every test on the red list is green, or left red with the reason in the Finish
- [ ] The test, typecheck and lint commands from `~/spec.md` were run once each after the last edit (again only after a fix one forced) and pass; slices were proven by their own test files
- [ ] Every changed file is one the plan named or a compile error forced; `Noticed, not touched` holds the rest
- [ ] No test was skipped, deleted or weakened
- [ ] The final message ends on a statement
