---
name: forge-test
description: Writes one test per criterion in ~/spec.md, red before the code exists, with the repo's own runner and conventions — never a new framework. Use as the step after forge-plan in a QA blueprint, or whenever a spec has criteria and no tests yet. Touches tests, fixtures and test config only.
---

# forge-test — the spec, as tests that fail

## Overview

Every criterion in the spec becomes a test that fails before the change exists and passes after it. A test that passes on its first run proves nothing; a criterion with no test is a promise nobody checked. Tests are named after the criterion they pin, so the QA report can say per criterion what was covered, and they are written in the repo's own runner, layout and style, so they read like every other test there.

Adapted from `test-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: the RED half of the cycle happens here, GREEN and REFACTOR in `forge-implement`, and the browser-runtime checks that skill adds are left to CI, where the app actually runs.

## When to Use

- As the third step of the "Spec → QA" blueprint, after `forge-spec` and `forge-plan`
- Whenever `~/spec.md` exists with criteria and its criteria have no tests

**When NOT to use:** no `~/spec.md` (run `forge-spec` first); a task with no behaviour change — docs, config, a rename — where a test would only pin the framework.

## Handoff

Reads `~/spec.md` (Criteria, Commands, Assumptions) and `~/plan.md` (`Criteria → code`, which says where each criterion is met and so where its test belongs). If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message. Writes test files, fixtures, factories and test config only. Production code does not change in this step, even to make a test compile; a criterion whose test cannot compile against the current code is written anyway and recorded as such in the Finish, so `forge-implement` starts by making it compile, then pass.

## Step 1: Find the runner before writing a line

The spec's Commands line names the test command; the repo shows the rest. Before the first test, know:

- Where tests live (`*.test.ts` beside the source, `tests/`, `__tests__/`) and how they are named
- The assertion style and the helpers already in use: fixtures, factories, a test database setup, a render helper for components. Read the test nearest the code each criterion touches and match it exactly
- Whether the suite needs services (a database, a port) and how existing tests get them

```
runner:    bun test                       (from ~/spec.md)
layout:    src/**/x.test.ts beside src/**/x.ts
helpers:   src/test/db.ts (real Postgres, rows keyed TEST-…, swept in afterAll)
nearest:   features/jobs/server/job-api.test.ts
```

Do not introduce a new framework, a new assertion library, a new directory, or a new style. A repo with no tests at all gets the runner its package manager already ships (`bun test`, `node --test`, `vitest` if it is a dependency), one file beside the code, and a line under Assumptions in the Finish saying so.

## Step 2: Pick the level per criterion

```
Is the criterion pure logic with no side effects?         → unit test, small, milliseconds
Does it cross a boundary — API, database, file system?    → integration test, localhost only
Is it a user flow only a browser can exercise?            → e2e — into the repo's existing e2e runner only
```

e2e is written only when `~/spec.md` says an e2e runner is configured (`e2e:` names a command). It is then written into that runner's layout and is not run here — the forge cannot boot the app; the repo's CI runs it on the PR — and the Finish says which tests are CI-run. When the spec says `e2e: none configured`, the criterion is tested at the highest level the repo can run, usually a component or route test, and the Finish says the browser path is uncovered and why. Adding Playwright or Cypress is a dependency decision nobody approved.

## Step 3: One test per criterion, named for it

Each criterion gets at least one test whose name starts with the criterion id and states the behaviour, so a failing test names the criterion it protects:

```typescript
describe('jobs list status filter', () => {
  it('C2: selecting "failed" lists only the failed job', async () => {
    // Arrange — the state the criterion sets up
    await seedJobs([{ status: 'queued' }, { status: 'running' }, { status: 'failed' }])

    // Act — the one action
    const rows = await listJobs({ status: 'failed' })

    // Assert — what the criterion says must be observed
    expect(rows.map((r) => r.status)).toEqual(['failed'])
  })
})
```

What makes these tests hold:

- **State, not interactions.** Assert on what the criterion says is observed, never on which internal method was called; a refactor must not break them.
- **Functionality, not CSS or labels.** Assert on what the user can do and what data appears, never on a class name, a colour, a pixel value or the exact copy of a label — those change with the design language and the test should survive it. Find elements by role and accessible name, not by class or by matching a sentence.
- **One assertion per concept.** A criterion with two observations is two criteria; the spec step already split them.
- **DAMP over DRY.** Each test reads as its own story: repeat a setup rather than hide it in a helper the reader has to chase.
- **Real over mocked.** Real implementation, then a fake, then a stub; a mock only at a boundary that is slow or non-deterministic. A suite that passes against mocks while production breaks is worse than none.
- **Boundaries the spec names.** Where the spec's Assumptions mention empty, missing or malformed input, a test pins it.

## Step 4: Run them, and watch them fail

Run the spec's test command once. The new tests must fail, for the right reason: the behaviour does not exist yet, not a typo in the test. Read each failure:

- Fails because the code does not do it yet → correct, it is red
- Fails because the test cannot compile against current code → correct, record the name under "does not compile yet"
- Fails because of the test itself — a wrong import, a wrong helper → fix the test now
- Passes → the test is not testing the criterion. Tighten it until it fails, or the criterion is already met, in which case say so in the Finish and keep the test as the regression guard

The rest of the suite must be exactly as it was before this step; the spec recorded whether it was green on the base.

## Finish

End with: the tests written, keyed by criterion (`C2 → features/jobs/queries.test.ts › "C2: …"`), each marked red / does-not-compile-yet / already-passing; the tests that are e2e and will run in CI, not here; any criterion left without a test and why; and the exact command that runs the suite. `forge-implement` reads this list to know what green means. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The criterion is obvious, I'll test it after the code exists" | Then the test pins the implementation, not the behaviour. Red first, or it proves nothing. |
| "The repo has no e2e runner, I'll add Playwright" | A runner is a dependency nobody approved. Test at the level the repo can run; say the browser path is uncovered. |
| "I'll stub the database, it's faster" | The nearest existing test uses the real one. Match it; a suite green against stubs says nothing about production. |
| "This test won't compile until the type exists, so I'll add the type" | That is production code. Write the test, record it as does-not-compile-yet, and let implement make it compile first. |
| "It passed first time, the code must already handle it" | Or the test asserts nothing. Tighten it until it fails; only then decide whether the criterion was already met. |
| "I should ask which cases matter most" | Nobody answers. Every criterion gets a test; the Finish says which you would have asked about. |

## Red Flags

- A test whose name does not start with a criterion id
- A test that asserts a class name, a colour, a pixel value or a label's exact wording
- A new test that passed on its first run and was left as it was
- A change to a file outside tests, fixtures, factories and test config
- A new framework, assertion library or test directory in a repo that had one
- An e2e test in a repo whose spec says `e2e: none configured`
- A final message that ends on a question

## Verification

- [ ] Every criterion in `~/spec.md` has at least one test named after it, in the repo's runner, layout and style
- [ ] Every new test was seen failing for the right reason, or recorded as does-not-compile-yet or already-passing with the reason
- [ ] The rest of the suite is unchanged from the base
- [ ] `git -C /work status --porcelain` lists only test files, fixtures, factories and test config
- [ ] The final message lists the tests by criterion, the CI-run ones, and the command, and ends on a statement
