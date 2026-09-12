---
name: forge-plan
description: Plans the change for every criterion in ~/spec.md and reviews the plan as a sceptical stranger before anything is written, producing ~/plan.md with files, symbols, order and assumptions. Use when ~/spec.md has criteria and ~/plan.md does not exist.
---

# forge-plan — a plan for the spec, doubted before it is followed

## Overview

Map each criterion to the code that satisfies it, in the order the dependencies force, then read the plan once as someone sure its author was overconfident. The test and implement steps follow what survives. Adapted from `planning-and-task-breakdown` and `doubt-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani): plan mode becomes a file, the human review an adversarial self-review.

## When to Use

- `~/spec.md` exists with criteria and `~/plan.md` does not

**When NOT to use:** no `~/spec.md`; a change so small every criterion is met in one function — write that paragraph to `~/plan.md` and stop.

## Handoff

Reads `~/spec.md` and the repo. Stops with no edits on a `## Blocked` section, repeating its reason. Writes exactly one file, `~/plan.md`. Never edits `/work`, and never enters plan mode: nobody approves.

## Step 1: Read the code each criterion touches

Open the place the spec names and read outward until the shape of the change is known: types crossed, callers affected, the test beside it, the convention the neighbours follow. Every line of the plan points at something read here. Collect on the way:

- The existing helper or component that already does most of it — new code beside a fit is the first thing Step 4 rejects
- When a criterion touches UI — a component, a route's rendered output, a stylesheet or token file, a story — the lens at `~/.claude/skills/forge-ui/SKILL.md`: the repo's component inventory and design doc are what the plan builds with, and Assumptions carries its one line
- The repo notes in the system prompt and `CLAUDE.md`
- When a criterion changes a contract — a route's params or body, a validation schema, the API document, a generated client type, an exported interface — the lens at `~/.claude/skills/forge-api/SKILL.md`: plan the change additive, state the migration path where it cannot be, and carry its one line into Assumptions

## Step 2: Order, then slice

Dependencies bottom-up (schema before query, type before component), then vertical slices, one criterion end to end, so every slice leaves the suite runnable.

```
C1 (job list filters by status)
  queries.ts listJobs gains a status filter
  routes/jobs.tsx renders the select
C2 (filter survives reload)
  routes/jobs.tsx reads the filter from search params   ← depends on C1's select
```

A criterion nothing read in Step 1 can satisfy as worded is not planned around: it goes under Assumptions with the closest change that can be made.

## Step 3: Write ~/plan.md

```markdown
# Plan: <ticket id> — <title>

## Change
<one paragraph: what changes, in which files, the shape of it>

## Criteria → code
- C1 — <file, symbol: what changes there. The helper reused, if any.>

## Order
1. <slice: files, criteria completed, the test file that proves it>

## Commands
<the Commands line from ~/spec.md, unchanged>

## Assumptions
- <every decision the spec left open, and the reading that made it>
- <API: additive or not, and the consumer — only when a criterion changes a contract>

## Not doing
- <the adjacent cleanup, the refactor — named so the implement step does not drift into it>
```

## Step 4: Doubt it

One pass as a reviewer who did not write it, looking for, in order: a claim with no reading behind it; a criterion met by mechanism only (the query changes, but is the route wired?); reuse missed; a repo convention broken; a slice that leaves the build red; anything the spec's Criteria and Out of scope do not require. Fix each finding in the plan; where the fix is a trade-off, record it under Assumptions. One pass only: a plan still producing findings on a second read is information about the spec, and the Finish says so.

## Finish

End with the `Change` paragraph, `Criteria → code` verbatim, and the Assumptions. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll enter plan mode for approval" | Nobody approves; the run stalls to the timeout. The file is the plan, the self-review the approval. |
| "I read this code in the spec step" | The spec read enough to know a criterion is checkable. The plan needs callers, types and the test beside it. |
| "While I'm in there, that helper could use a cleanup" | `Not doing`. The PR that does one thing is the PR that merges. |

## Red Flags

- A `Criteria → code` line with no file and symbol
- A new function whose name describes something the repo already has
- An empty `Not doing`: the code was not read closely
- Any edit under `/work`, or a turn that entered plan mode

## Verification

- [ ] Every criterion has a `Criteria → code` line naming a file and symbol that was read
- [ ] Slices are ordered so each one's test can pass when it lands
- [ ] The adversarial pass ran once; every finding is fixed or recorded as a trade-off
- [ ] `~/plan.md` exists and `git -C /work status --porcelain` is empty
