---
name: forge-spec
description: Turns a ticket's acceptance criteria into a checkable spec at ~/spec.md, one criterion per AC grounded in the code, with the exact commands and every assumption made in place of a question. Use when a job starts and ~/spec.md does not exist; with `bug:` before the task the reproduction is the criterion, with `refactor:` the unchanged suite and each named simplification are.
---

# forge-spec — the ticket, made checkable

## Overview

Write down what "done" means before anything is written: one checkable criterion per acceptance criterion, the commands that prove them, the decisions made where a person would have been asked. Criteria come from the ticket's Acceptance Criteria section only; a ticket without one stops the run. Adapted from `spec-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani): the clarifying questions become written assumptions.

## When to Use

- The first step of a job, with the task text as the argument: a ticket id or URL, or the requirement written out
- `bug:` before the task, or a ticket labelled Bug or carrying reproduction steps or a failing check
- `refactor:` before the task, or a ticket that names files and what to remove from them with no behaviour change

**When NOT to use:** `~/spec.md` already exists (read it); a task with no behaviour to check — a rename, a dependency bump, docs.

## Handoff

Reads the task text, the repo, and the repo notes in the system prompt. Writes exactly one file, `~/spec.md`. Never edits anything under `/work`. Every later step stops on a `## Blocked` section here.

## Step 1: Read the requirement

A ticket id (`ABC-123`) or a `linear.app` URL is fetched with the `linear` MCP `get_issue`: the description is the requirement. A linked Slack thread is read with the `slack` tools when they exist; when they do not, the gap is an assumption, not a guess. Quote the ticket's own words in the Objective.

## Step 2: Find the commands, exactly

From `package.json` scripts, the lockfile's package manager, and what CI runs. An e2e runner counts only if it is already configured; otherwise `e2e: none configured`, never a plan to add one. Run test, typecheck and lint once on the untouched checkout and record their state under Assumptions (`bun test 212 pass · typecheck clean · lint: 3 pre-existing errors in src/legacy/`); every later step reads it there instead of rerunning them.

## Step 3: Ground every acceptance criterion in the code

Keep the ticket's numbering as `C1…`. For each, find where in the code it would be satisfied and reword it as a check: the state to set up, what must be observed, the file and symbol.

```
Ticket says:   "Users should be able to filter the job list by status."
C2 —           With jobs queued, running and failed, selecting "failed" on /jobs lists only
               the failed job, and clearing the filter lists all three.
               Satisfied in routes/jobs.tsx (the select) and features/jobs/queries.ts.
```

- One check per criterion; two checks are two criteria
- Outcome, never mechanism: "the list shows only failed jobs", not "the query adds a WHERE"
- A vague ask gets a number the code supports, recorded as an assumption; a cited product rule stays cited

Nothing is added from the Summary, Scope or Technical Notes. Two exceptions, each named under Assumptions: a boundary the code forces on an existing criterion (nullable, empty) is split out as its own `C<n>`; and when a criterion changes a contract the repo publishes — a route's params or body, a validation schema, the API document, a generated client type — one standing criterion follows the ticket's own: `C<n> — The published contract stays backward compatible with what <consumer> was generated from, or the change <consumer> makes is named under Assumptions`, the consumer from the repo notes, then the ticket, else `consumer not named`.

**A bug's criterion is its reproduction.** With `bug:`, a Bug label, reproduction steps, or a failing check named, `C1` is the failing check — the steps as the state, the expected behaviour as what is observed, today's behaviour in parentheses — and Commands gains `repro:`, the exact command that shows the failure or `none: needs a browser`. The ticket's other criteria follow as `C2…`.

```
C1 —     With a job already holding the claim on a ticket, a second POST /api/jobs naming it
         is refused with 409 (today: 200, and both run). Satisfied in job-store.ts claimTicket.
repro:   bun test src/features/jobs/server/job-api.test.ts -t "claims the ticket"
```

**A refactor's criteria are the unchanged suite and each named simplification.** With `refactor:`, or a ticket naming files and what to remove, `C1` is `The test suite passes with the same count as the base and no test file changes (base: <count>)`, and each simplification the ticket names is one `C<n>` worded as what is observable in the code afterwards: `trim1` defined once, in `shared/text.ts`; `job-runner.ts` under 500 lines; no nested ternary in `stepsSummary`. A named simplification that would change what the code returns, throws or does for some input — a dropped suffix, a changed default, a different message — is not a criterion however the ticket words it: it goes under Assumptions as a behaviour change the ticket asked for and the run will leave unmade, with the input that would differ. A refactor ticket that names no file, or nothing removable, is Step 5.

## Step 4: Write ~/spec.md

```markdown
# Spec: <ticket id> — <title>

## Objective
<the change in the ticket's words; who it is for; what is true when it lands>

## Criteria
- C1 — <state to set up; what is observed. Where: file, symbol.>

## Commands
test: <exact>   typecheck: <exact>   lint: <exact>   e2e: <exact, or "none configured">
repro: <bug only>

## Out of scope
- <what the ticket says or implies is not this change>

## Assumptions
- <every gap, what was decided, and the code that decided it; the base state of the three commands>
```

Prefer the choice the code already makes. Where the ticket contradicts the code, the criterion follows the ticket and the contradiction is an assumption. Never renumber once written: tests and the QA report are keyed by these ids.

## Step 5: When nothing can be grounded, stop

No Acceptance Criteria section, an empty one, no criterion that can be grounded, a bug with neither reproduction steps nor a failing check, or a refactor naming no file and nothing to remove: write `## Blocked` in place of Criteria, naming what is missing and what is needed, and stop. A precise Summary is not a substitute: nobody signed it off as done. Later steps make no edits and repeat the reason; a job that produces nothing costs less than a PR nobody asked for.

## Finish

End with the Criteria verbatim, the Commands line and the Assumptions — or the `## Blocked` text. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "There's no AC section, but the Summary is precise enough" | The Summary says what; the AC section says when it is done, and only that was signed off. Blocked. |
| "It's a bug, so 'it should work' is the criterion" | The criterion is the reproduction. No steps and no failing check means nothing to see red: Blocked, naming which is missing. |
| "They forgot the error-path criterion; I'll add one" | Scope nobody approved. Split a boundary out of an existing criterion only where the code forces it. |
| "I'll ask what 'recent' means" | Nobody answers. Decide from what the code does and write it under Assumptions. |

## Red Flags

- A criterion naming a file or a query instead of an outcome, or containing "and"
- A criterion with no line of the ticket's AC section behind it
- A command in Commands not found in the repo
- Any edit under `/work`

## Verification

- [ ] Every criterion traces to an AC line, states state and observation, and names where it is satisfied
- [ ] No AC section, a bug with no reproduction, or a refactor with nothing named, produced `## Blocked`
- [ ] Test, typecheck and lint ran once on the untouched checkout, state recorded under Assumptions
- [ ] `~/spec.md` exists and `git -C /work status --porcelain` is empty
