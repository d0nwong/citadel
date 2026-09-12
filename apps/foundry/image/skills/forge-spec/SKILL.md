---
name: forge-spec
description: Turns a ticket's acceptance criteria into a testable spec at ~/spec.md — one numbered, checkable criterion per AC, grounded in the code, the exact commands that verify them, and every assumption made in place of a question. A ticket with no Acceptance Criteria section stops the run; a bug's reproduction is its criterion. Use as the first step of a QA or bug blueprint, or whenever tests are about to be written and no spec exists. Edits nothing in the workspace.
---

# forge-spec — the ticket, made checkable

## Overview

Code without a spec is guessing, and tests without a spec test the guess. This step writes the spec down before anything else happens: what the change is, the criteria that decide whether it landed, and the commands that run those checks. A criterion is worded as its own test — the state to set up and what must then be observed — so the test step has nothing to interpret. Criteria come from the ticket's Acceptance Criteria section and nowhere else: the Summary and Scope say what the change is, the criteria say when it is done, and only the second is something a person signed off as the definition of done. A ticket with no Acceptance Criteria section stops the run rather than getting criteria derived for it, however detailed the rest of the ticket is.

Adapted from `spec-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani) for an unattended run: the clarifying questions that skill asks a person become assumptions written into the spec.

## When to Use

- As the first step of the "Spec → QA" blueprint, with the job's task text as the argument
- As the first step of the "Bug → Fix" blueprint, with `bug:` before the task text: the reproduction is the criterion
- Whenever a job is about to write tests or code and `~/spec.md` does not exist

**When NOT to use:** a task with no behaviour to check — a rename, a dependency bump, docs, config — where the spec would be one line; `~/spec.md` already exists for this task (read it instead).

## Handoff

Reads the task text (a Linear id or URL, or the requirement written out), the repo, and the repo notes if the system prompt carries any. Writes exactly one file, `~/spec.md`, in the shape under Step 5. Never creates, edits or deletes anything under `/work`: the workspace is what gets committed, and nothing here is a change to the code.

Every later step of the blueprint starts by reading `~/spec.md` and stops on a `## Blocked` section, so what is written here is binding for the run.

## Step 1: Read the requirement, all of it

- If the task names a ticket — an id like `ABC-123`, or a `linear.app` issue URL — fetch it with the `linear` MCP server's `get_issue`: title, description, labels. The description is the requirement; the task text is only how it arrived.
- If the ticket links a Slack thread (`slack.com/archives/…`, "as discussed in Slack"), read it with the `slack` MCP tools when they are available. When they are not, do not guess what the thread says: write the gap into Assumptions.
- If there is no ticket, the task text is the requirement in full.
- Read `CLAUDE.md`, `CONTRIBUTING.md` and the repo notes before forming a view: they hold the conventions the criteria have to respect.

Quote the requirement's own words in the Objective. A spec that paraphrases the ticket drifts from it.

## Step 2: Find the commands, exactly

The spec names the real commands, with flags, that every later step will run. Find them, do not infer them:

- `package.json` scripts (`test`, `typecheck`, `lint`, `check`, `e2e`), and the package manager the lockfile implies (`bun.lock`, `pnpm-lock.yaml`, `package-lock.json`)
- `Makefile`, `justfile`, `.github/workflows/*.yml`: what CI actually runs is the strongest evidence
- The e2e runner: Playwright, Cypress or similar, only if it is already configured (`playwright.config.*`, `cypress.config.*`, an `e2e` script). If none is configured, write `e2e: none configured`. Never plan to add one; that is a dependency decision nobody approved.

```
test:      bun test
typecheck: bun run typecheck
lint:      bun run check
e2e:       none configured
```

Run the test command once now, on the untouched checkout. A suite that is already red is an Assumption the later steps need to know about, not a surprise for the verify step.

## Step 3: Ground every acceptance criterion in the code

Find the ticket's **Acceptance Criteria** section (house-format tickets number them `AC1…`; keep the numbering as `C1…`). If there is no such section, or it is empty, go straight to Step 6: a Summary that describes the change in detail is not a substitute, because nobody agreed it is the definition of done. For each acceptance criterion, find the code where it would be satisfied — the route, the component, the function, the query — and read enough of it to know the criterion can be checked there. Then reword it as the check:

**A bug is the one ticket whose definition of done is not an AC list but a reproduction.** When the argument starts with `bug:`, or the ticket is labelled Bug, or its description carries reproduction steps (Steps to reproduce, Expected / Actual) or names a failing check or test, the reproduction is `C1`, worded as the failing check: the steps as the state to set up, the expected behaviour as what must be observed, and what happens today in parentheses. Acceptance criteria the ticket also has follow as `C2…`. A bug ticket with no reproduction steps and no failing check is Step 6, and the Blocked text names which of the two is missing. Commands gains a `repro:` line — the exact command that shows the failure, or `none: needs a browser` — because `forge-debug` starts by running it.

```
Ticket says:   "Steps: claim CTD-9 from two jobs. Expected: the second is refused.
                Actual: both jobs run."
C1 —           With a job already holding the claim on a ticket, a second POST /api/jobs
               naming the same ticket is refused with 409 (today: 200, and both run).
               Satisfied in features/jobs/server/job-store.ts claimTicket.
repro:         bun test src/features/jobs/server/job-api.test.ts -t "claims the ticket"
```

```
Ticket says:   "Users should be able to filter the job list by status."
C2 —           With jobs in states queued, running and failed, selecting "failed" in the
               status filter on /jobs lists only the failed job, and clearing the filter
               lists all three. Satisfied in web/src/routes/jobs.tsx (the filter select)
               and features/jobs/queries.ts (the list query).
```

Rules that keep criteria testable:

- **One check per criterion.** A criterion that needs two checks is two criteria.
- **Outcome, never mechanism.** "The list shows only failed jobs" is a criterion; "the query adds a WHERE clause" is a note.
- **Numbers for vague asks.** "Make it faster" becomes a target the test can measure, chosen from what the code and the ticket support, and recorded as an assumption.
- **Cite the rule.** Where the ticket cites a product rule ("BR-93"), carry the citation on the criterion.

A criterion is never derived from the Summary, Scope or Technical Notes: those inform the wording of a criterion the ticket already has and go into Out of scope and Assumptions, but they do not add rows. The one exception is a boundary the code forces on an existing criterion — the field is nullable, the list can be empty — which is split out as its own `C<n>` and named under Assumptions. Criteria that would merely be nice are not added: the spec is what the ticket signed off as done, checkable.

## Step 4: Decide what a person would have been asked

There is nobody to ask, so every question becomes a decision, and every decision is written down:

```
ASSUMPTIONS
- The ticket says "recent jobs" without a window; the existing dashboard uses 7 days
  (features/jobs/queries.ts recentSince), so C3 uses 7 days.
- No Slack tools available; the linked thread was not read. C4 is written from the
  ticket text alone.
- The suite is green on the untouched checkout (bun test, 212 pass).
```

Prefer the choice the code already makes over the choice that seems best. Where the ticket contradicts the code, the criterion follows the ticket and the contradiction is an assumption the PR reader will see.

## Step 5: Write ~/spec.md

```markdown
# Spec: <ticket id> — <title>

## Objective
<one paragraph, the change in the ticket's words; who it is for; what is true when it lands>

## Criteria
- C1 — <the check: the state to set up and what must be observed. Where it is satisfied: file, symbol.>
- C2 — …

## Commands
test: <exact>   typecheck: <exact>   lint: <exact>   e2e: <exact, or "none configured">
repro: <bug only: the exact command that shows the failure, or "none: needs a browser">

## Out of scope
- <what the ticket says or implies is not this change, so the implement step does not drift>

## Assumptions
- <every gap in the ticket, and what was decided, with the code that decided it>
```

The Criteria ids are what the test step names its tests after (`C2: selecting failed lists only failed jobs`) and what the verify step reports coverage by. Do not renumber once written.

## Step 6: When nothing can be grounded, stop

If the ticket has no Acceptance Criteria section, or the section is empty, or not one of its criteria can be grounded in the code — or, for a bug, there are neither reproduction steps nor a failing check — write the spec with a `## Blocked` section instead of Criteria:

```markdown
## Blocked
The ticket has no Acceptance Criteria section. Its Summary describes five filter controls
in detail, but nothing in it was signed off as the definition of done, so there is nothing
to write tests against. Needed: an Acceptance Criteria section with at least one line of
the form "when <state>, <what is observed>".
```

Then stop. Every later step reads this section, makes no edits, and repeats the reason, so the job settles with no changes and the reason in its final message — the correct outcome for a ticket that is not ready. Missing criteria are not reconstructed from the rest of the ticket: a job that implements criteria nobody signed off produces a PR nobody asked for, which costs more than a job that produced nothing.

## Finish

End with the Criteria list verbatim, the Commands line, and the Assumptions — or, when blocked, the `## Blocked` text. Every sentence is a statement; never end on a question or an offer, because nobody answers and the run simply ends.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'll ask what they meant by 'recent'" | Nobody will answer. Decide from what the code already does, write it under Assumptions, and move on. |
| "They obviously forgot an error-path criterion; I'll add a reasonable one" | A criterion the ticket did not ask for is scope nobody approved. Split one out only where the code forces a boundary on an existing criterion, and say so. |
| "There's no AC section, but the Summary is precise enough to write criteria from" | The Summary says what the change is; the AC section says when it is done, and only that was signed off. No section, no criteria: Blocked. |
| "It's a bug, so 'it should work' is the criterion" | The criterion is the reproduction: these steps, this expected outcome, this failure today. Without steps or a failing check there is nothing to see red: Blocked, naming which is missing. |
| "There's no e2e runner, so I'll assume Playwright" | Adding a runner is a dependency decision. Write `none configured`; the test step writes the case at the level the repo can run. |
| "The criteria are a bit thin, but I can flesh them out" | Thin is a fact about the ticket, not a gap to fill. One groundable acceptance criterion is enough to proceed; zero, or no section, is Blocked. |
| "I'll skip running the suite now; verify runs it later" | A suite that is already red on the base changes what "green" means for every later step. Run it once, record it. |
| "The ticket is clear, I can go straight to writing tests" | Then writing the spec takes five minutes and the tests get criterion ids to trace to. The spec is the trace. |

## Red Flags

- A criterion that names a file, a function or a query instead of an outcome
- A criterion with "and" in it: two checks
- A criterion with no `AC<n>` line behind it in the ticket
- A Commands line with a command you did not find in the repo
- A spec with no Assumptions section: a ticket with no gaps has not been read closely
- An edit, however small, under `/work`
- A final message that ends on a question

## Verification

- [ ] Every criterion traces to a line of the ticket's Acceptance Criteria section, states the state to set up and what must be observed, and names where in the code it is satisfied
- [ ] A ticket with no Acceptance Criteria section produced `## Blocked`, not criteria; a bug's `C1` is its reproduction and Commands has a `repro:` line
- [ ] Every command in Commands exists in the repo and the test command was run once on the untouched checkout
- [ ] Every gap in the ticket has a line under Assumptions naming what was decided and why
- [ ] `~/spec.md` exists and `/work` has no changes (`git -C /work status --porcelain` is empty)
- [ ] The final message ends on a statement
