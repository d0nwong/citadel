---
name: sweep
description: One idempotent pass over the whole workspace loop — digest tick, unjournaled-landing scan, the join between landings / open decisions / open Liamai tickets, per-item dispatch of log-change and feature-docs, then accio audit and a morning-readable report. Run via /loop 2h /sweep or on demand; every stage is state-driven and catch-up-safe, so the first run after days away backfills everything. Use when the user says "sweep", "run the sweep", "catch me up on everything", or asks to run the workspace loop.
---

# sweep — the scheduler for the workspace loop

The workspace is a blackboard: durable state lives in files (`digests/`, per-feature
`journal/`, `docs/`), reconciliation is deterministic (`pr-facts`, `accio audit`), and
agents are stateless workers. The sweep adds the one missing piece — a scheduler — and
stays deliberately dumb: **the files decide what runs.** Every stage is idempotent, so
cadence is not a design question; a tick after three days away just does three days of
work, and a tick after ten quiet minutes does nothing.

Two invariants, before anything else:

- **Null over guess.** An unattributed landing gets `ticket: null` and a question in the
  report — never a plausible key. Wrong frontmatter silently misroutes every future grep.
- **The sweep reads files, not reports.** Subagents make files current; triage always
  works off the file. That is what makes a half-crashed sweep safely re-runnable.

## Procedure

**1. Digest tick.** Spawn the `slack-digest` subagent exactly as its skill mandates and
wait for it. Its report is only a completion signal — the input to everything below is
`digests/<today>.md` (and yesterday's file after a rollover).

**2. Landings scan.** Both repos:

```sh
bun skills/log-change/scripts/pr-facts.ts --since <date>        # FE → staging
bun skills/log-change/scripts/pr-facts.ts --since <date> --be   # BE → origin/dev
```

`<date>` = 7 days back by default; widen if the newest journal entry is older than that.
The `NOT JOURNALED` marker is what makes the window stateless — already-journaled
landings drop out on their own, so overlapping windows are harmless.

**3. Open state.** Three greps and one API call:

- open decisions: `grep -rln 'status: decided' alden/alden-portal/features/*/journal/ alden/alden-portal/features/*/*/journal/ 2>/dev/null`
  (both globs — nested features like `admin/invoicing` keep their journal a level deeper)
- parked work: `grep -rln '^hold:' alden/alden-portal/features/*/journal/ alden/alden-portal/features/*/*/journal/ 2>/dev/null`
  (report-only — a hold is waiting on something, list what)
- today's digest 🔴 / ✋ / 🟠 sections
- open Linear issues, team `Liamai`, assignee me (`mcp__linear-server__list_issues`;
  ToolSearch it first if deferred)

**4. The join.** For each `NOT JOURNALED` landing, before dispatching anything, try to
match it against the open tickets and open decisions:

- **by key** when the branch or commits typed one — trust it;
- **semantically** otherwise: features the diff touches vs. ticket scope vs. the digest
  thread that spawned the ticket. Teammates do not reference Liamai keys, so this is the
  normal path, and it is a judgement call — phrase every semantic match as *appears*, not
  *is*.

On a match to an open ticket: **annotate, never close.** Comment on the issue with the PR
link, merge sha, and author (`save_issue` / comment — the digest's dedupe rules apply: one
annotation per landing, not one per tick). Closing stays manual, always — a landing may
implement half a ticket, and a wrongly closed ticket vanishes from the only queue the user
reads. The report leads with "LIA-xx appears already implemented by fe#N — verify".

On a match to an open `decided` entry: pass it to the dispatch below — the landing entry
must link back and flip the decision to `superseded` (log-change step 2b).

No match: journal with `ticket: null` and ask in the report ("unattributed landing touched
admin-invoicings — is this LIA-xx?").

**5. Dispatch.** One `log-change` run per unjournaled landing, **sequentially** — entries
for one feature share a folder and every run ends in a commit; parallel writers would
trip over the tree. Each run gets the join's findings for its landing (ticket or null,
decided entry to supersede, digest permalink as `source:`). log-change step 6 then drives
`feature-docs` for the affected features; entries left `implemented` by a previous sweep
(audit's "refresh missed" nag) get a `feature-docs` run here too. Bulky reading happens in
the subagents; keep only conclusions in the sweep's context.

**6. Audit.** `bun run accio audit`. Problems it still reports after dispatch go in the
report verbatim — never silence one by inventing the missing fact.

**7. Report.** One screen, in this order, skipping empty sections:

1. **Needs you** — appears-implemented tickets to verify, unattributed landings,
   digest ✋/🟠 items, holds still waiting.
2. **Done this tick** — entries written, docs refreshed, tickets annotated (keys + PRs).
3. **Audit** — remaining problems, verbatim.

A quiet tick reports in one line ("sweep: nothing new").

## Autonomy

Runs unattended under `/loop`, so the write policy is fixed:

- **Yes:** journal entries, doc regeneration, local git commits, Linear comments/
  annotations and digest-mandated issue filing.
- **Never:** close Linear tickets, post to Slack, push git, or guess frontmatter.
  Anything needing the user's judgement goes in the report, not into a file.

## Running it

`/loop 2h /sweep` is the intended mode (self-paced `/loop` also works). The loop only
runs while a session is alive — fine, because the design is catch-up-safe: the first tick
after any gap backfills. If it must run with no machine awake, that is `/schedule` (cloud
cron), not a longer loop.
