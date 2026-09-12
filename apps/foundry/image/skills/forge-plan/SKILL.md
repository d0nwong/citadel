---
name: forge-plan
description: Plans the change that satisfies every criterion in ~/spec.md, then reviews that plan as a sceptical stranger would before anything is written. Writes ~/plan.md — files to touch, order, one line per criterion saying where it is met — and edits nothing in the workspace. Use as the step after forge-spec in a QA blueprint.
---

# forge-plan — a plan for the spec, doubted before it is followed

## Overview

Nobody is here to approve a plan, which is not a reason to skip planning; it is a reason to review the plan yourself, and to do it as someone who did not write it. The plan maps each criterion in the spec to the code that will satisfy it, in the order the dependencies force, with the commands that prove each step. Then it is read again with one job: find what is wrong with it. The test and implement steps follow the plan that survives.

Adapted from `planning-and-task-breakdown` and `doubt-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: plan mode is replaced by a file, the human review by an adversarial self-review in the same turn, and the cross-model second opinion is skipped, as that skill says to do outside an interactive session.

## When to Use

- As the second step of the "Spec → QA" blueprint, right after `forge-spec`
- Whenever `~/spec.md` exists with criteria and `~/plan.md` does not

**When NOT to use:** no `~/spec.md` yet (run `forge-spec` first); a change so small every criterion is met in one file and one function, where the plan is a paragraph — write that paragraph to `~/plan.md` and stop.

## Handoff

Reads `~/spec.md` — its Criteria, Commands, Out of scope and Assumptions — and the repo. If `~/spec.md` has a `## Blocked` section, stop now: make no edits and repeat its reason as your final message. Writes exactly one file, `~/plan.md`, in the shape under Step 3. Never creates, edits or deletes anything under `/work`, and never enters plan mode: it waits for an approval that will not come.

## Step 1: Read the code each criterion touches

For every criterion, open the place the spec says it is satisfied and read outward until you know the shape of the change: the types it crosses, the callers it affects, the test file beside it, the convention the neighbouring code follows. Every line of the plan must point at something you read in this step — never at how the code "probably" works.

While reading, collect what the plan has to reuse:

- The existing function, helper or component that already does most of it. New code where a suitable implementation exists is the first thing the review below rejects.
- For a UI criterion: the repo's `package.json` `ui:list` script, if present, run with the repo's package manager. The shared components it lists are what the plan builds with, so the change stays visually consistent. Absent or failing, continue without it.
- The repo notes in the system prompt, `CLAUDE.md`, `CONTRIBUTING.md`: standing preferences the plan honours from the start rather than discovers halfway.

## Step 2: Map the dependencies, then slice

Write down what depends on what — a schema change before the query that reads it, a type before the component that renders it — and order the work bottom-up. Then slice vertically: one criterion end to end at a time, so every slice leaves the suite runnable and a failure is found in the slice that caused it.

```
C1 (job list filters by status)
  queries.ts listJobs gains a status filter      ← C1 depends on this
  routes/jobs.tsx renders the select             ← and this
C2 (filter survives reload)
  routes/jobs.tsx reads the filter from search params   ← depends on C1's select
```

A criterion the plan cannot place — nothing read in Step 1 could satisfy it as worded — is not planned around. It goes in the plan's Assumptions with the closest change that can be made, and the final message says so.

## Step 3: Write ~/plan.md

```markdown
# Plan: <ticket id> — <title>

## Change
<one paragraph: what changes, in which files, and the shape of it — the paragraph a reviewer reads first>

## Criteria → code
- C1 — <file, symbol: what changes there to satisfy it. The existing helper reused, if any.>
- C2 — …

## Order
1. <slice: files, what changes, which criteria it completes, the command that proves it>
2. …

## Commands
<the Commands line from ~/spec.md, unchanged>

## Assumptions
- <every decision the spec left open, and the reading of the code that made it>
- <any criterion that could not be placed as worded, and the closest change planned instead>

## Not doing
- <the adjacent cleanup, the refactor, the second feature — named so the implement step does not drift into it>
```

Keep the plan to what the criteria need. No speculative refactors, no adjacent cleanups; `Not doing` is where those are written down so they stay undone.

## Step 4: Doubt it — the review that replaces approval

Re-read `~/plan.md` in one pass as an adversarial reviewer who did not write it and is sure the author was overconfident. Do not summarise, do not validate; find issues, or state after a real search that there are none. Look for, in this order:

1. **A claim with no reading behind it.** "The query already supports filtering" — does it? Open the file again if you are not certain.
2. **A criterion met by mechanism only.** The plan changes the query, but the criterion is what the user sees; is the route wired?
3. **Reuse missed.** A helper in the repo already does what a planned new function does.
4. **A convention broken.** The repo names, places or tests this kind of thing a particular way and the plan does not.
5. **A slice that leaves the build red.** A type changes in slice 1 and its only caller is fixed in slice 3.
6. **Scope creep.** Anything in the plan the spec's Criteria and Out of scope do not require.

For every finding, fix the plan; where the fix is a trade-off (the reuse is wrong for this case), write the trade-off under Assumptions. One pass, then stop: a plan still turning up substantive findings on a second read is information about the spec, and the final message says so rather than looping.

## Finish

End with the `Change` paragraph, the `Criteria → code` list verbatim, and the Assumptions — the next step reads `~/plan.md` itself, but the ledger needs the plan in the message too. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll enter plan mode so the plan can be approved" | Nobody approves. The run stalls until the timeout and pushes nothing. The file is the plan; the self-review is the approval. |
| "The spec is clear enough, I'll plan as I implement" | Then the test step has nothing to write tests against and the implement step re-plans on every file. Ten minutes now. |
| "I read this code in the spec step, no need to open it again" | The spec step read enough to know a criterion is checkable. The plan needs the shape of the change: callers, types, the test beside it. |
| "Reviewing my own plan is theatre" | It is, if you read it as its author. Read it as someone certain the author was wrong, with the six checks above, and it finds things. |
| "While I'm in there, that helper could use a cleanup" | Write it under `Not doing`. The PR that does one thing is the PR that merges. |
| "I'll ask which of the two approaches they prefer" | Nobody answers. Pick the one the code already leans toward, mark it under Assumptions, and go. |

## Red Flags

- A line under `Criteria → code` with no file and symbol
- A plan that adds a function whose name describes something the repo already has
- A slice whose command cannot pass until a later slice lands
- An empty `Not doing`: nothing adjacent was noticed, which means the code was not read closely
- Any change under `/work`, or a turn that entered plan mode
- A final message that ends on a question

## Verification

- [ ] Every criterion in `~/spec.md` has a line under `Criteria → code` naming a file and a symbol that was read
- [ ] Slices are ordered so each one's command can pass when it lands
- [ ] The adversarial pass ran with all six checks and every finding is either fixed or recorded as a trade-off
- [ ] `~/plan.md` exists and `git -C /work status --porcelain` is empty
- [ ] The final message ends on a statement
