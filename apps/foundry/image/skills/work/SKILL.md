---
name: work
description: Work a Linear ticket end to end — read the requirement, plan before touching code, branch from main, verify against the existing code, and finish with a PR. Use when given a Linear ticket URL/ID to implement, or when the user says "work on this ticket".
---

# /work — ticket to PR

Drive one ticket from requirement to pull request, in this order. Do not skip
or reorder steps.

## 1. Read the requirement

The argument is a Linear ticket URL or ID (e.g. `LIA-24`).

- If Linear MCP tools are available, fetch the issue: title, description,
  labels, and the suggested git branch name. Inside a forge they arrive as the
  `linear` server, proxied through foundry's MCP gateway on the host.
- If not, ask the user to paste the ticket's title and description before
  doing anything else — and tell them the fix: on the host, `foundry auth
  --linear`, `bun run infra:up`, then `foundry recreate <forge>`.

The ticket text is the requirement. If it is ambiguous or contradicts what you
find in the code, ask — do not fill the gap with a guess.

## 2. Always plan first

Plan before any edit. How the plan gets approved depends on who is there:

- **Interactive session** (a person is typing): enter plan mode and wait for
  their approval.
- **Headless run** (`claude -p`, e.g. a web-UI job — no one can answer):
  do not use plan mode; it needs a human to approve and will block. Write the
  plan to `~/plan.md` (not into the workspace — everything there gets
  committed), then review it yourself as a
  sceptical reviewer would — does every claim point at code you read, is
  there a simpler reuse, what could break — and fix the plan before moving
  on. Questions you would have asked the user become explicit assumptions,
  stated in the plan and again in the PR body. Never end a headless turn on
  a question such as "shall I proceed?" — nobody answers, the run ends and
  nothing is pushed.

While planning:

- Explore the code the ticket touches. Every claim in the plan must be backed
  by something you actually read — never by an assumption about how the code
  "probably" works.
- Reuse existing functions, utilities, and patterns you find; do not propose
  new code where a suitable implementation exists.
- Where there is a genuine fork in approach, present the options with one
  marked **recommended**, and proceed with the recommended one on approval.

Only start editing after the plan is approved — by the user, or by your own
review when headless.

## 3. Branch from main

- `git fetch origin` first; branch from up-to-date `origin/main` (or the
  repo's actual default branch).
- Use Linear's suggested branch name (`<username>/<ticket-id>-<slug>`); fall
  back to `<type>/<slug>` if there is no ticket branch name.
- Exception: if a feature branch for this ticket already exists (check
  `git branch -a` for the ticket ID), continue on that branch instead of
  creating a new one.

## 4. Implement — verify, don't assume

- Follow the repo's own conventions: read `CONTRIBUTING.md` / `CLAUDE.md` if
  present, and match the style of surrounding code.
- Verify behavior against the real code and by running what you can (tests,
  typecheck, the app). State plainly what you verified and how.
- Commit in Conventional Commit style (`type(scope): summary`) unless the repo
  documents something else.

## 5. Finish with a PR

- **Headless job forge** (`FOUNDRY_JOB_ID` is set): the branch already exists
  and the host pushes it and opens the PR once you finish — with your commit
  message as its title. Commit with a Conventional Commit subject, put the
  `Closes <ticket-id>` line and your assumptions in the commit body, and stop.
  Do not push, open a PR, or work around missing `gh`/`bb` credentials.
- Otherwise, push the branch and open a PR against the default branch —
  `gh pr create` for GitHub origins, `bb` for Bitbucket.
- Title: a Conventional Commit. Body: follow the repo's PR template if it has
  one; always include a `Closes <ticket-id>` line linking the Linear ticket,
  a summary, and how you verified the change.
- If Linear access is available, move the ticket to In Progress when you
  start and attach the PR link when it is up.
- If pushing is impossible (no `gh`/`bb` credential in this environment), say
  so and hand the user the exact commands to run instead of silently stopping.
