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
  labels, and the suggested git branch name.
- If not (common inside a forge), ask the user to paste the ticket's title and
  description before doing anything else.

The ticket text is the requirement. If it is ambiguous or contradicts what you
find in the code, ask — do not fill the gap with a guess.

## 2. Always plan first

Enter plan mode before any edit. While planning:

- Explore the code the ticket touches. Every claim in the plan must be backed
  by something you actually read — never by an assumption about how the code
  "probably" works.
- Reuse existing functions, utilities, and patterns you find; do not propose
  new code where a suitable implementation exists.
- Where there is a genuine fork in approach, present the options with one
  marked **recommended**, and proceed with the recommended one on approval.

Only start editing after the plan is approved.

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

- Push the branch and open a PR against the default branch — `gh pr create`
  for GitHub origins, `bb` for Bitbucket.
- Title: a Conventional Commit. Body: follow the repo's PR template if it has
  one; always include a `Closes <ticket-id>` line linking the Linear ticket,
  a summary, and how you verified the change.
- If Linear access is available, move the ticket to In Progress when you
  start and attach the PR link when it is up.
- If pushing is impossible (no `gh`/`bb` credential in this environment), say
  so and hand the user the exact commands to run instead of silently stopping.
