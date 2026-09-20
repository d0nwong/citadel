---
name: forge-spec
description: Binds a ticket's acceptance criteria into a checkable spec at ~/spec.md, one criterion per AC bound to code, with the exact commands and every assumption made in place of a question — never authoring a criterion the ticket did not state. Use when a job starts and ~/spec.md does not exist; with `bug:` before the task the reproduction is the criterion, with `refactor:` the unchanged suite and each named simplification are.
---

# forge-spec — the ticket, made checkable

## Overview

Write down what "done" means before anything is written: one checkable criterion per acceptance criterion, the commands that prove them, the decisions made where a person would have been asked. A human already approved these criteria by signing off the ticket's Acceptance Criteria section; this step binds each one to code, it does not author one. Criteria come from that section only; a ticket without one, or a criterion that cannot be bound to code, stops the run. Adapted from `spec-driven-development` in addy-agent-skills (MIT, © 2025 Addy Osmani): the clarifying questions become written assumptions.

## When to Use

- The first step of a job, with the task text as the argument: a ticket id or URL, or the requirement written out
- `bug:` before the task, or a ticket labelled Bug or carrying reproduction steps or a failing check
- `refactor:` before the task, or a ticket that names files and what to remove from them with no behaviour change

**When NOT to use:** `~/spec.md` already exists (read it); a task with no behaviour to check — a rename, a dependency bump, docs.

## Handoff

Reads the task text, the repo, and the repo notes in the system prompt. Writes exactly one file, `~/spec.md`. Never edits anything under `/work`. Every later step stops on a `## Blocked` section here.

## Step 1: Read the requirement

A ticket id (`ABC-123`) or a `linear.app` URL is fetched with the `linear` MCP `get_issue`: the description is the requirement. A linked Slack thread is read with the `slack` tools when they exist; when they do not, the gap is an assumption, not a guess. Quote the ticket's own words in the Objective. A `### Spec: <feature>` block in the task's Context is that feature's reviewed spec and `### Arch: <feature>` its arch doc: read both before the code.

## Step 2: Find the commands, exactly

From `package.json` scripts, the lockfile's package manager, and what CI runs. An e2e runner counts only if it is already configured; otherwise `e2e: none configured`, never a plan to add one. `~/baseline.md`, written before this step, holds install, test and typecheck as run on the untouched checkout, each with its exit code and last lines: record that state under Assumptions (`test 212 pass · typecheck clean`, or the failure the file shows) and run neither; with no file, run the two once and record the same. Lint never runs on the whole tree and no pre-existing count is recorded: Commands names the linter over the files changed since the base sha at the top of `~/baseline.md`, committed or not — with Biome, `{ git diff --name-only --diff-filter=d <sha>; git ls-files --others --exclude-standard; } | xargs -r node_modules/.bin/biome lint --no-errors-on-unmatched`; otherwise the repo's lint script given that same file list.

## Step 3: Bind every acceptance criterion to code

Keep the ticket's numbering as `C1…`. Each `C<n>` is one line of the ticket's Acceptance Criteria section, reworded only into a check: the state to set up, what must be observed. An AC that cites `(spec S-n)` takes that criterion's wording from the `### Spec:` block, not the AC line's own paraphrase of it, and keeps both ids, `C2 (S-35) — …`; a cited `S-n` with no Spec block in the task keeps the AC's own wording, and the missing block is an assumption. For each, find where in the code it is observed and name the file and symbol on the `Where:` line, per the template in Step 4.

```
Ticket says:      AC2 — Users should be able to filter the job list by status (spec S-9).
### Spec: foundry/jobs has S-9 — The job list's status filter shows only jobs in that status;
clearing it shows all.
Technical Notes:  routes/jobs.tsx — the status select. AC2.
C2 (S-9) —        The job list's status filter shows only jobs in that status; clearing it
                  shows all.
                  Where: routes/jobs.tsx (from the Technical Notes).
```

- One check per criterion; two checks are two criteria
- Outcome, never mechanism: "the list shows only failed jobs", not "the query adds a WHERE"
- A number the criterion needs — a threshold, a count, a limit — is taken only from the ticket, its cited `S-n`, or a value the code already fixes; never chosen here to make a vague ask checkable. A cited product rule stays cited; a value the code already fixes is named under Assumptions.

Nothing is added from the Summary, Scope or the Technical Notes: neither section may add a criterion or change one's wording. The Technical Notes are the ticket's own file-and-symbol map (`FORMAT.md`: each note leads with a backticked path and names the AC it serves) and are the source of `Where:` — the note naming this AC gives its file and symbol verbatim; the file is opened to confirm the criterion is observable there, not to look for a different one. `Where:` is derived from the code instead only when no note names a file for that AC, or the note's file does not exist at the base commit (an assumption either way). Two exceptions to "nothing is added," each named under Assumptions: a boundary the code forces on an existing criterion (nullable, empty) is split out as its own `C<n>`, `Where:` following the same rule as its parent; and when a criterion changes a contract the repo publishes — a route's params or body, a validation schema, the API document, a generated client type — one standing criterion follows the ticket's own: `C<n> — The published contract stays backward compatible with what <consumer> was generated from, or the change <consumer> makes is named under Assumptions`, the consumer from the repo notes, then the ticket, else `consumer not named`.

**A bug's criterion is its reproduction.** With `bug:`, a Bug label, reproduction steps, or a failing check named, `C1` is the failing check — the steps as the state, the expected behaviour as what is observed, today's behaviour in parentheses — and Commands gains `repro:`, the exact command that shows the failure or `none: needs a browser`. The ticket's other criteria follow as `C2…`, bound as above.

```
C1 —     With a job already holding the claim on a ticket, a second POST /api/jobs naming it
         is refused with 409 (today: 200, and both run).
         Where: job-store.ts claimTicket.
repro:   bun test src/features/jobs/server/job-api.test.ts -t "claims the ticket"
```

**A refactor's criteria are the unchanged suite and each named simplification.** With `refactor:`, or a ticket naming files and what to remove, `C1` is `The test suite passes with the same count as the base and no test file changes (base: <count>)`, and each simplification the ticket names is one `C<n>` worded as what is observable in the code afterwards: `trim1` defined once, in `shared/text.ts`; `job-runner.ts` under 500 lines; no nested ternary in `stepsSummary`. A named simplification that would change what the code returns, throws or does for some input — a dropped suffix, a changed default, a different message — is not a criterion however the ticket words it: it goes under Assumptions as a behaviour change the ticket asked for and the run will leave unmade, with the input that would differ. A refactor ticket that names no file, or nothing removable, is Step 5.

## Step 4: Write ~/spec.md

```markdown
# Spec: <ticket id> — <title>

## Objective
<the change in the ticket's words; who it is for; what is true when it lands>

## Criteria
- C1 — <state to set up; what is observed. Where: <the Technical Note's file and symbol for this AC, or the file read when no note names one>.>

## Commands
test: <exact>   typecheck: <exact>   lint: <exact, over the changed files only>   e2e: <exact, or "none configured">
repro: <bug only>

## Out of scope
- <what the ticket says or implies is not this change>

## Assumptions
- <every gap, what was decided, and the code that decided it; the base state of the three commands>
```

Prefer the choice the code already makes. Where the ticket contradicts the code, the criterion follows the ticket and the contradiction is an assumption. Never renumber once written: tests and the QA report are keyed by these ids.

## Step 5: When a criterion cannot be bound, stop

No Acceptance Criteria section, an empty one, a bug with neither reproduction steps nor a failing check, or a refactor naming no file and nothing to remove: write `## Blocked` in place of Criteria, naming what is missing and what is needed, and stop. The same applies when even one AC cannot be bound to code — no file or symbol supports it, or it needs a number nothing fixes — even while every other AC binds cleanly: `## Blocked` replaces the whole Criteria list, naming each AC by id, which one could not be bound and what is missing for it. Never an invented criterion in its place and never a number chosen to make it checkable. A precise Summary is not a substitute: nobody signed it off as done. Later steps make no edits and repeat the reason; a job that produces nothing costs less than a PR nobody asked for.

## Finish

End with the Criteria verbatim, the Commands line and the Assumptions — or the `## Blocked` text. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "There's no AC section, but the Summary is precise enough" | The Summary says what; the AC section says when it is done, and only that was signed off. Blocked. |
| "It's a bug, so 'it should work' is the criterion" | The criterion is the reproduction. No steps and no failing check means nothing to see red: Blocked, naming which is missing. |
| "They forgot the error-path criterion; I'll add one" | Scope nobody approved. Split a boundary out of an existing criterion only where the code forces it. |
| "I'll ask what 'recent' means, or just pick a number" | Nobody answers, and nobody approved a number either. A value the code already fixes is taken from the code; otherwise the criterion cannot be bound — Blocked, naming which one. |
| "The Technical Notes already say the file; I'll double check by reading the code first" | The note is the map, not a guess to verify against a fresher one. Open the file it names to confirm the criterion is observable there, not to look for a different `Where:`. |

## Red Flags

- A criterion naming a file or a query instead of an outcome, or containing "and"
- A criterion with no line of the ticket's AC section behind it
- A `Where:` derived from the code while a Technical Note names the file for that AC
- A number in a criterion that neither the ticket, its cited `S-n`, nor the code already fixes
- A command in Commands not found in the repo
- Any edit under `/work`

## Verification

- [ ] Every criterion traces to an AC line, states state and observation, and names a `Where:` taken from the Technical Notes where one names a file, or from the code where none does
- [ ] No AC section, a bug with no reproduction, a refactor with nothing named, or one AC that cannot be bound, produced `## Blocked` naming which one and what is missing
- [ ] The base state under Assumptions is `~/baseline.md`'s; no test, typecheck or lint ran here
- [ ] `~/spec.md` exists and `git -C /work status --porcelain` is empty
