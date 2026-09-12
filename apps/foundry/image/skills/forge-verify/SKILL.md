---
name: forge-verify
description: Reviews the change against ~/spec.md on five axes, proves the suite, typecheck and lint pass, tightens tests that would pass any implementation, and writes the QA report to ~/qa-report.md and the PR description to /work/.git/PR_BODY.md. Small fixes only. Use as the last step of a QA blueprint.
---

# forge-verify — review, prove, report

## Overview

The last step is the one a reviewer would otherwise have to do by hand: read the diff as a stranger, run everything once more, ask of every test whether it would actually fail if its criterion regressed, and write down what is covered, what is not, and why. The output is a QA report keyed by criterion and a PR description that carries it. Approve when the change definitely improves the codebase and meets the spec, not when it is how you would have written it; and never approve by not looking.

Adapted from `code-review-and-quality` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: the five-axis review and its severity labels, applied by the model that did not write the code (a blueprint runs this step on a different model on purpose), with findings fixed in place when small and reported when not.

## When to Use

- As the final step of the "Spec → QA" blueprint, after `forge-implement`
- Whenever a change exists in `/work` against a `~/spec.md` and no `~/qa-report.md` has been written

**When NOT to use:** no diff against the base (nothing to verify — say so and stop); no `~/spec.md` (there is nothing to verify against; review the diff against the task text and say the spec was missing).

## Handoff

Reads `git -C /work diff <base>..HEAD` plus the uncommitted diff, `~/spec.md` (Criteria, Commands, Out of scope), `~/plan.md` (`Not doing`), and `forge-implement`'s final message in this session (deviations, tests changed, anything left red). If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message. Writes `~/qa-report.md`, `/work/.git/PR_BODY.md` (under `.git/` on purpose: the commit sweep cannot pick it up), and small fixes to code or tests — a name, a missed edge, a test tightened. A finding that needs more than a small fix is reported, not made.

## Step 1: Review the tests before the code

Tests reveal what the change thinks it is. For every test `forge-test` and `forge-implement` touched:

- Does it name its criterion, and does what it asserts match what the criterion says is observed?
- **Would it fail if the behaviour regressed?** Mentally revert the production change: a test that would still pass asserts nothing. Tighten it, or delete it and say so in the report; a test that passes against any implementation is worse than none.
- Does it test state, not interactions; the public surface, not internals?
- Was any test changed under `forge-implement`'s Step 4 rule, and does the reason hold against the spec?

## Step 2: Review the code on five axes

Walk the diff file by file. Label every finding with a severity so the reader knows what is required:

| Label | Meaning |
|---|---|
| **Critical:** | broken behaviour, data loss, a vulnerability — the PR must not merge as is |
| *(none)* | required before merge |
| **Nit:** | style; the reader may ignore |
| **FYI:** | context, no action |

1. **Correctness** — does it meet each criterion, on the error paths and boundaries the spec's Assumptions named, not only the happy path? Off-by-one, a race, state left inconsistent?
2. **Readability** — names that follow the repo; straightforward control flow; no dead code, no `_unused`, no compatibility shim for code that never shipped; fewer lines where fewer would do
3. **Architecture** — follows the repo's existing pattern or justifies a new one; reuses the canonical helper rather than a near-duplicate; feature logic stays in its own layer; nothing outside `~/spec.md`'s scope or inside `~/plan.md`'s `Not doing`
4. **Security** — input validated at the boundary; queries parameterised; no secret in code or log; external data treated as untrusted
5. **Performance** — no N+1, no unbounded fetch, no work in a hot path the spec did not ask for

Lead with what matters: a correctness or security finding is the review; ten nits under it are noise. For a structural finding, name the move (reuse helper X, collapse the two branches, move this into the module that owns the concept), not just the problem.

Fix in place when the fix is small and certain — a name, a missed null, a tightened assertion. Report, with the label, when it is not. Do not add behaviour, do not refactor beyond the finding, do not rewrite the plan.

## Step 3: Prove it, once

Run the test, typecheck and lint commands from `~/spec.md` after the last edit of Step 2. Record the command and the result for each, in one line. For e2e tests the spec says are CI-run, prove they parse: the typecheck covers `.ts` specs; otherwise the runner's list mode (`playwright test --list`, `cypress` has none — read the file). Do not try to run them; the forge has no browser and no running app.

Then read `git -C /work status --porcelain` once more and confirm every changed file belongs to the change.

## Step 4: Write ~/qa-report.md

```markdown
# QA report: <ticket id>

| Criterion | Test | Level | Ran in forge | Result |
|---|---|---|---|---|
| C1 | features/jobs/queries.test.ts › "C1: …" | unit | yes | pass |
| C2 | routes/jobs.test.tsx › "C2: …" | integration | yes | pass |
| C4 | e2e/jobs.spec.ts › "C4: …" | e2e | no — CI runs it on the PR | written, typechecks |

Commands: `bun test` 216 pass · `bun run typecheck` clean · `bun run check` clean

Not covered: <criterion, and why — e.g. C3 needs a browser and the repo has no e2e runner>
Findings fixed here: <one line each, with the label>
Findings left for the reader: <one line each, with the label>
Tests tightened or removed: <name, and what it was not catching>
Deviations from the plan: <from forge-implement's message, confirmed or corrected>
Assumptions carried: <the spec's and the plan's, in one list>
```

Every criterion in the spec has a row. A criterion with no test has a row that says so.

## Step 5: Write the PR description

`/work/.git/PR_BODY.md`, following the repo's own PR template (`.github/PULL_REQUEST_TEMPLATE.md`) when it has one, otherwise foundry's at `/usr/local/share/foundry/pr-template.md`: fill every section for real, delete the HTML comments and any section that is genuinely empty. Always:

- A `Closes <ticket id>` line when the task named a ticket — the host links the PR to the ticket from it
- **Summary:** the `Change` paragraph from the plan, corrected to what actually landed
- **Assumptions:** the report's `Assumptions carried`
- **How verified:** the report's table and command line, verbatim, then the findings left for the reader

Write it as rendered markdown: one unbroken line per paragraph and per bullet, never hard-wrapped at a column — a hard wrap splits inline code mid-token and renders as an inserted space.

## Finish

End with the report's table and command line, the findings left for the reader with their labels, and the verdict in one line: ready for review, or not, and the Critical or required finding that makes it not. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The tests pass, so it's good" | Tests are necessary, not sufficient. Step 1 asks whether they would fail; Steps 2 and 3 cover what tests cannot. |
| "I wrote none of this, so I can't judge the intent" | The spec is the intent. Review against it; that is the whole point of a different model reading the diff. |
| "This is a small structural problem, I'll refactor it properly" | A refactor is a change nobody planned. Name the move under findings; fix only what is small and certain. |
| "The e2e tests can't run here, so I'll leave them out of the report" | They are the reader's first question. A row that says written, typechecks, CI-run is the honest answer. |
| "LGTM, the diff is clean" | Approval without evidence helps no one. The report shows the reading: a row per criterion, a line per command. |
| "This might be a minor concern" (about a bug that will ship) | Say what it is and label it. Softening a real finding is the same failure as missing it. |

## Red Flags

- A criterion with no row in the report
- A report that says "tests pass" with no command and no count
- A finding without a label, or a Critical buried under nits
- A test left in place that would pass with the production change reverted
- A PR body with a section left as the template's comment
- A fix in this step that adds behaviour the spec did not ask for
- A final message that ends on a question

## Verification

- [ ] Every test touched by this run was checked against its criterion and would fail on regression, or was tightened or removed with the reason recorded
- [ ] The diff was read on all five axes and every finding is labelled and either fixed in place or left for the reader
- [ ] Test, typecheck and lint were run after the last edit, with command and result in the report
- [ ] `~/qa-report.md` has a row per criterion, and `/work/.git/PR_BODY.md` carries the table under How verified
- [ ] The final message states the verdict and ends on a statement
