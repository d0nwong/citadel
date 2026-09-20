---
name: forge-test
description: Writes one test per criterion in ~/spec.md, seen red before the code exists, in the repo's own runner and style. Use when ~/spec.md has criteria and no tests yet; touches tests, fixtures and test config only.
---

# forge-test — the spec, as tests that fail

## Overview

Every criterion becomes a test named after it that fails before the change and passes after. A test that passes first time proves nothing; a criterion with no test is a promise nobody checked. Adapted from `test-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani): the RED half here, GREEN and REFACTOR in the step that implements, browser checks left to CI.

## When to Use

- `~/spec.md` has criteria and they have no tests

**When NOT to use:** no `~/spec.md`; a task with no behaviour change, where a test would only pin the framework.

## Handoff

Reads `~/spec.md` (Criteria, Commands, Assumptions) and `~/plan.md` when there is one (`Criteria → code`: where each test belongs). Stops with no edits on a `## Blocked` section. Writes tests, fixtures, factories and test config only. Production code does not change here, even to make a test compile: such a test is written anyway and recorded as does-not-compile-yet.

## Step 1: Find the runner before writing a line

When the task carries a Context section, a `` ### `path` `` block there is that file at the base commit — read before the checkout and trusted over any line number the task itself cites — and a path the section does not carry is read from the checkout as before.

The spec's Commands names the runner; the test nearest the code each criterion touches shows the layout, assertion style, helpers and how the suite gets a database or a port. Match it exactly. No new framework, assertion library, directory or style; a repo with no tests gets the runner its package manager ships, one file beside the code, and a line in the Finish.

```
runner:    bun test                       (from ~/spec.md)
layout:    src/**/x.test.ts beside src/**/x.ts
helpers:   src/test/db.ts (real Postgres, rows keyed TEST-…, swept in afterAll)
nearest:   features/jobs/server/job-api.test.ts
```

## Step 2: Pick the level per criterion

Pure logic → unit. Crosses a boundary (API, database, file system) → integration, localhost only. A flow only a browser can exercise → e2e, and only into the runner `~/spec.md` says is configured: written into its layout, not run here, named in the Finish as CI-run. With `e2e: none configured`, test at the highest level the repo can run — a component or route test — and say the browser path is uncovered.

## Step 3: One test per criterion, named for it

```typescript
it('C2: selecting "failed" lists only the failed job', async () => {
  await seedJobs([{ status: 'queued' }, { status: 'running' }, { status: 'failed' }])   // Arrange
  const rows = await listJobs({ status: 'failed' })                                     // Act
  expect(rows.map((r) => r.status)).toEqual(['failed'])                                 // Assert
})
```

- State, not interactions: assert what the criterion says is observed, never which method was called
- Functionality, not CSS or copy: find elements by role and accessible name, never by class, colour or a label's exact wording
- One assertion per concept; DAMP over DRY; real implementation over a fake over a stub, a mock only at a slow or non-deterministic boundary
- A boundary the spec's Assumptions names (empty, missing, malformed) gets a test
- **A bug's test is the reproduction.** When `~/plan.md` opens with `## Root cause`, the `C1` test performs the plan's reduced case and asserts the expected behaviour, so it fails on the untouched code for the reason the ticket describes. Never write it against the fix.

## Step 4: Run them, and watch them fail

Run the spec's test command once. Each new test fails for the right reason: the behaviour does not exist yet. Cannot compile against current code → record as does-not-compile-yet. Fails from the test itself (wrong import, wrong helper) → fix the test. Passes → tighten until it fails, or the criterion is already met and the Finish says so, keeping the test as the guard. A reproduction test that passes has not reproduced the bug: rewrite it against the reduced case, and if it will not go red, say the bug was not seen at this level.

## Finish

End with the tests keyed by criterion (`C2 → queries.test.ts › "C2: …"`), each marked red / does-not-compile-yet / already-passing; which are CI-run; any criterion without a test and why; the exact command; and, when the task's Context lists one, a path under `### Missing at the base commit` or `### Not included`, named with its reason rather than searched for. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll test it after the code exists" | Then the test pins the implementation, not the behaviour. Red first or it proves nothing. |
| "This won't compile until the type exists, so I'll add the type" | That is production code. Record it does-not-compile-yet; implement makes it compile first. |
| "It passed first time, the code must already handle it" | Or the test asserts nothing. Tighten until it fails; only then decide. |
| "No e2e runner, I'll add Playwright" | A dependency nobody approved. Test at the level the repo can run and say the browser path is uncovered. |

## Red Flags

- A test whose name does not start with a criterion id
- A test asserting a class name, a colour or a label's exact wording
- A new test that passed first time and was left as it was
- A change outside tests, fixtures, factories and test config

## Verification

- [ ] Every criterion has a test named after it, in the repo's runner, layout and style
- [ ] Every new test was seen failing for the right reason, or recorded as does-not-compile-yet or already-passing
- [ ] `git -C /work status --porcelain` lists only test files, fixtures, factories and test config
