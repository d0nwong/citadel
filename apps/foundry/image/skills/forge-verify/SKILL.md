---
name: forge-verify
description: Reviews a change against ~/spec.md on five axes (six when the diff touches a contract), proves the suite once, tightens tests that would pass any implementation, and writes ~/qa-report.md and /work/.git/PR_BODY.md under a Conventional Commit. Use when a change exists against ~/spec.md and no ~/qa-report.md has been written.
---

# forge-verify — review, prove, report

## Overview

The reviewer's job, unattended: commit first, read the diff as a stranger, ask of every test whether it would fail if its criterion regressed, prove the suite once, and write down what is covered and what is not. Approve when the change meets the spec and improves the codebase, never by not looking. Adapted from `code-review-and-quality` in addy-agent-skills (MIT, © 2025 Addy Osmani): the five-axis review and its severity labels, run by a model that did not write the code.

## When to Use

- A change exists in `/work` against `~/spec.md` and no `~/qa-report.md` exists

**When NOT to use:** no diff against the base (say so and stop); no `~/spec.md` (review against the task text and say the spec was missing).

## Handoff

Reads the diff against the base plus uncommitted changes, `~/spec.md`, `~/plan.md` (`Not doing`, `Root cause`), and the previous step's final message when there is one. Stops with no edits on a `## Blocked` section. Writes `~/qa-report.md`, `/work/.git/PR_BODY.md` (under `.git/` so the commit sweep cannot pick it up), and small fixes only — a name, a missed null, a tightened assertion.

## Step 1: Commit first

Before reading a line, commit everything in `/work` in one commit; every later edit is folded in with `git commit --amend --no-edit`. The host opens the PR with the newest subject as its title and CI lints it, so a run that times out before committing ships a sweep commit that fails the lint. Subject: a Conventional Commit, `type(scope): summary`, under 72 characters, in the style `git log --oneline -20` shows. Body: `Closes <ticket id>` when the task named a ticket, then the assumptions, wrapped at 72 columns. Do not push; the host does.

```
feat(pensieve): file tickets on the team and project the ask names

Closes CTD-172

Assumptions: the checkout's LIA constants were stale against Linear's
team list and are replaced; team is an explicit optional field.
```

## Step 2: Review the tests before the code

For every test this run touched: does it name its criterion and assert what the criterion observes? **Would it fail if the behaviour regressed?** Mentally revert the change; a test that still passes asserts nothing — tighten it or delete it and say so. State, not interactions. Any test changed after it was first written has a reason that holds against the spec.

## Step 3: Review the code on five axes, six when the diff touches a contract

Label every finding: **Critical:** (must not merge), unlabelled (required before merge), **Nit:** (may ignore), **FYI:** (no action).

1. **Correctness** — each criterion, on the error paths and boundaries the spec named; off-by-one, a race, state left inconsistent
2. **Readability** — names that follow the repo, no dead code, no shim for code that never shipped
3. **Architecture** — the repo's pattern or a justified new one; the canonical helper; nothing outside the spec's scope or inside `Not doing`
4. **Security** — input validated at the boundary, queries parameterised, no secret in code or log
5. **Performance** — no N+1, no unbounded fetch, nothing in a hot path the spec did not ask for
6. **API** — only when the diff touches a contract (a route's params or body, a validation schema, the API document, a generated client type, an exported interface): apply `~/.claude/skills/forge-api/SKILL.md` and carry its one line into the report. A diff touching no contract gets no API row

Lead with what matters; name the move for a structural finding. Fix in place when small and certain; report otherwise. Add no behaviour.

## Step 4: Write ~/qa-report.md and the PR body, then amend

```markdown
# QA report: <ticket id>

| Criterion | Test | Level | Ran in forge | Result |
|---|---|---|---|---|
| C1 | features/jobs/queries.test.ts › "C1: …" | unit | yes | pass |
| C4 | e2e/jobs.spec.ts › "C4: …" | e2e | no — CI runs it | written, typechecks |

Commands: <pending until Step 5>
Not covered: <criterion and why>
Findings fixed here / left for the reader: <one line each, labelled>
Tests tightened or removed: <name, what it was not catching>
API: <only when the diff touched a contract>
Assumptions carried: <the spec's and the plan's>
```

Every criterion has a row. Then `/work/.git/PR_BODY.md`, following the repo's PR template or `/usr/local/share/foundry/pr-template.md`: `Closes <ticket>` when the task named one; a Summary from the plan's `Change`, opening with the `## Root cause` sentence when the plan has one; the Assumptions; the report's table and Commands line under How verified, then the findings left for the reader. One unbroken line per paragraph and bullet. Then `git -C /work add -A && git -C /work commit --amend --no-edit`.

## Step 5: Prove it, once

Run test, typecheck and lint from `~/spec.md` once each, after the last edit; again only after a fix one forced. Replace the pending Commands line in both files. CI-run e2e tests are proven to parse (the typecheck, or the runner's list mode), never run. Then `git -C /work status --porcelain`: a file only the formatter touched, in code the plan never named, is reverted with `git checkout -- <file>` and the report says so. Amend once more; the status is empty.

## Finish

End with the commit subject, the report's table and Commands line, the findings left for the reader with labels, and the verdict in one line: ready for review, or not, and why. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The tests pass, so it's good" | Necessary, not sufficient. Step 2 asks whether they would fail. |
| "I'll commit once everything is verified" | A timeout before the commit hands the host a sweep commit that fails the title lint. Commit first, amend after. |
| "LGTM, the diff is clean" | Approval without evidence. A row per criterion, a line per command. |
| "This might be a minor concern" (about a bug that will ship) | Say what it is and label it. Softening a finding is the same failure as missing it. |

## Red Flags

- A review begun before the first commit, or a subject that is not a Conventional Commit
- A criterion with no row, or a report that says "tests pass" with no command and no count
- A test left that would pass with the change reverted
- A file only the formatter touched, left in
- An API row for a diff that touched no contract

## Verification

- [ ] Committed first with a Conventional Commit subject and the `Closes` line; amended after the last edit; status empty
- [ ] Every touched test would fail on regression, or was tightened or removed with the reason recorded
- [ ] Every finding is labelled and either fixed in place or left for the reader
- [ ] Suite, typecheck and lint ran once after the last edit; `~/qa-report.md` has a row per criterion; the PR body carries the table
