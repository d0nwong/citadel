---
name: sweep
description: One idempotent pass over the whole workspace loop — digest tick, unjournaled-landing scan, the join between landings / open decisions / open Liamai tickets, per-item dispatch of log-change and feature-docs, a Linear ticket pass (file tickets from digest ✋ action items, review open tickets against refreshed docs), then accio audit and a morning-readable report. Run via /loop 2h /sweep or on demand; every stage is state-driven and catch-up-safe, so the first run after days away backfills everything. Use when the user says "sweep", "run the sweep", "catch me up on everything", or asks to run the workspace loop.
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
- Linear activity today: same tool, team `Liamai`, no assignee filter, `updatedAt` ≥
  local midnight — feeds the report's "Linear today" section. Split created-today from
  merely-updated by `createdAt`.

**4. The join.** For each `NOT JOURNALED` landing, before dispatching anything, try to
match it against the open tickets and open decisions:

- **by key** when the branch or commits typed one — trust it;
- **semantically** otherwise: features the diff touches vs. ticket scope vs. the digest
  thread that spawned the ticket. Teammates do not reference Liamai keys, so this is the
  normal path, and it is a judgement call — phrase every semantic match as *appears*, not
  *is*.

Match against the whole ticket, not just its Scope: a landing can also satisfy a
**Pending** bullet — a BE landing shipping the endpoint an FE ticket was waiting on is
exactly the event Pending exists to track.

A match is not always "implements". A landing can make a ticket **redundant** instead:
it deleted or rewrote the code the ticket targets, solved the same problem a different
way, or shipped a decision that moots the ask. Check for this whenever a landing touches
a feature an open ticket names — the diff removing or replacing the thing the ticket
wants changed is the tell. Redundancy is always a judgement call, so it follows the
semantic-match rule: *appears*, never *is*.

On a match to an open ticket: **annotate, never close.** Comment on the issue with the
facts — PR link, merge sha, author, features touched (`save_issue` / comment — the
digest's dedupe rules apply: one annotation per landing, not one per tick). The bullet
mapping — which Scope / Pending items the landing appears to satisfy, which remain — is
inference, so it goes in the report, not the comment. Closing stays manual, always — a
landing may implement half a ticket, and a wrongly closed ticket vanishes from the only
queue the user reads. The report leads with "LIA-xx appears already implemented by fe#N —
verify"; a partial match reports "fe#N appears to cover 2 of 4 Scope bullets on LIA-xx —
edit Scope?".

On a redundancy match: **report-only, no comment.** Redundancy is inference, not
evidence — a wrong "this may be moot" comment on a shared ticket is noise the team sees.
The report says "LIA-xx appears redundant after fe#N — close or rescope?" and the
comment happens after the user confirms. Cancelling is closing — it stays manual for the
same reason: the sweep may have misread the diff, and part of the ask may survive the
rewrite. This is the general rule for outward-facing writes: **positive evidence earns a
comment; inference goes in the report.**

One narrow body edit is allowed: **delete a Pending bullet whose named artifact
verifiably landed** — the bullet names a concrete endpoint / field / table and the
landing's diff contains exactly that. That is a mechanical fact, and it's what
linear-ticket's own rule ("when a pending item lands, delete its bullet") demands. When
the connection is only semantic, don't touch the bullet — say *appears* in the comment
and put it in Needs-you. Scope bullets are never edited by the sweep, satisfied or not.

On a match to an open `decided` entry: pass it to the dispatch below — the landing entry
must link back and flip the decision to `superseded` (log-change step 2b).

No match: journal with `ticket: null` and ask in the report ("unattributed landing touched
admin-invoicings — is this LIA-xx?").

**5. Dispatch.** One `log-change` run per unjournaled landing, **sequentially** — entries
for one feature share a folder and every run ends in a commit; parallel writers would
trip over the tree. Each run is a general-purpose subagent with **`model: "opus"`** (the
entry it writes is the "why" layer — judgement, not transcription) and gets the join's
findings for its landing (ticket or null, decided entry to supersede, digest permalink as
`source:`). log-change step 6 then drives
`feature-docs` for the affected features; entries left `implemented` by a previous sweep
(audit's "refresh missed" nag) get a `feature-docs` run here too. Bulky reading happens in
the subagents; keep only conclusions in the sweep's context. That is the general rule for
what gets a subagent: a stage earns one when its input is bulky (threads, doc trees,
diffs) *and* its output is a blackboard write the sweep can re-read afterwards — not
because it is a stage.

**6. Ticket pass.** Linear is the sweep's terminal surface — the queue the user actually
reads — so this stage makes it current. Three parts: 6a and 6b run together in **one
`ticket-pass` subagent**; 6c stays inline.

Why the split: 6a and 6b are the bulky readers of this stage — each ✋ item means the
Slack thread, `linear-ticket`'s `FORMAT.md` and the product + arch docs of every feature
it touches; each refreshed feature means its full docs against every open ticket naming
it. That reading is single-use and belongs in a worker's context, per the dispatch rule
above. 6c is a one-line judgement per ticket over the step-3 list the sweep already
holds, so a subagent would only re-fetch it. The join (step 4) is never delegated: it is
the cross-product of landings, tickets and decisions, and splitting it loses the join.

**Skip the spawn** when there is nothing for it: no unmarked ✋ items *and* no feature
refreshed this tick. Otherwise, **after dispatch has finished** (the subagent writes the
digest file and commits — a parallel writer would trip over dispatch's tree), spawn ONE
general-purpose subagent via the Agent tool with **`model: "opus"`** (the judgement
tier — see "Running it") — filing and review are judgement calls, and a weaker model files
worse tickets. The sweep hands it conclusions, not sources:

> You are the `ticket-pass` worker for one sweep tick of the `ai-workspace` repo (working
> directory). Execute directly; never spawn a subagent — it would recurse.
>
> Inputs:
> - Unmarked ✋ items from `digests/{date}.md`, one per line: `{line text} — {permalink}`.
> - Features refreshed this tick: `{ids}`; open Liamai tickets naming them: `{keys}`.
> - Team `Liamai`; assignee = me. Linear tools are `mcp__linear-server__*` — ToolSearch
>   them if deferred.
>
> Part A — file tickets from the ✋ items, per the sweep skill's step 6a (read
> `skills/sweep/SKILL.md`, steps 6a–6b, before starting; draft each ticket with the
> `linear-ticket` skill). Part B — review the listed open tickets against the refreshed
> docs, per step 6b.
>
> Write policy is fixed: you may file `digest`-labeled tickets, write the ` → LIA-xx`
> digest marker, comment positive evidence onto a ticket, and delete a Pending bullet
> whose named artifact verifiably landed. You may NEVER close a ticket, edit Scope or any
> other body text, apply the `agent-ready` label, comment inference (appears-satisfied,
> appears-redundant), or push git. Inference goes in your report.
>
> Report back three lists, verbatim lines the sweep can paste: **Needs you** (appears-
> satisfied / appears-redundant / drifted references, ✋ pings that got no ticket and
> why), **Done** (tickets filed with keys, comments written, bullets deleted), and the
> commit sha of the digest writeback (or "no writeback").

When it returns, the sweep does not take the report on faith for anything the blackboard
can answer: re-read the digest file for the markers and re-run the step-3 ticket query
for the new keys — that refreshed list is also what 6c and the report's "Linear today"
section run over. Only the inference lines (Needs-you) come from the report, because no
file holds them. A subagent's report is never shown to the user; an unrelayed finding is
a lost one.

**6a. File tickets from ✋ items** (subagent). Every unmarked item in the digest's ✋
section that carries a real deliverable (build, fix, review, write, decide-with-follow-up)
gets a Liamai ticket: label `digest`, assignee me, the Slack permalink as the body's
anchor, title from the item. Pure reply/ack pings get no ticket — they stay in the
report; a queue buried in micro-tasks stops being read. Dedupe is a writeback: after
filing, append ` → LIA-xx` to the item's line in the digest file — a marked item is
invisible to every later tick, which is what makes the catch-up case free. Because the
file-then-mark pair isn't atomic, backstop before filing: search the `digest` label for
the item's Slack permalink; a hit means a prior tick crashed mid-pair — write the missing
marker instead of filing twice.

**6b. Review tickets against refreshed reality** (subagent). For each feature whose docs
or journal changed this tick (dispatch's output), re-read the open tickets naming that
feature against the fresh docs: Pending items now landed? Scope bullets satisfied or
mooted? File/line references drifted? This is what catches tickets the join can't — the
join only sees tickets a *new landing* touches; a review triggers whenever the ticket's
ground truth moves. Findings flow through the same policy as the join: verifiable facts
(a named Pending artifact now exists) may annotate and delete the bullet; everything
else — appears-satisfied, appears-redundant, drifted references — goes in Needs-you.
Skip the pass entirely on a tick that refreshed nothing.

**6c. Nominate agent-ready tickets** (inline). Over the step-3 open-ticket list, as
refreshed after the subagent returned — every tick, no refresh needed to trigger. A ticket qualifies when its Pending section is absent, it has
no blocked-by relation, and its Scope is concrete enough to execute without a round of
questions (real files, functions, line ranges — linear-ticket's bar). A qualifying
ticket not yet carrying the `agent-ready` label gets a Needs-you line: "LIA-xx looks
agent-ready — label it?". The concreteness call is judgement, so nomination is
report-only: the sweep never applies the label. That label is the entire contract with
Foundry's ticket pickup (README, "Downstream" section) — applying it dispatches an
agent, which is precisely the decision the report exists to surface, not make. Like
holds, a ready-but-unlabeled ticket restates every tick until labeled or disqualified —
the report is a snapshot, not a diff.

**7. Audit.** `bun run accio audit`. Problems it still reports after dispatch go in the
report verbatim — never silence one by inventing the missing fact.

**8. Report.** One screen, in this order, skipping empty sections:

1. **Needs you** — appears-implemented tickets to verify, appears-redundant tickets to
   close or rescope, partial matches awaiting a Scope edit, Pending bullets that only
   *appear* satisfied, review findings, unattributed landings, un-ticketed ✋ pings and
   🟠 items, holds still waiting, agent-ready nominations (6c) awaiting your label.
   ✋ items that got tickets appear by key, not restated.
2. **Done this tick** — entries written, docs refreshed, tickets filed (6a) and
   annotated (keys + PRs).
3. **Linear today** — every Liamai ticket created or updated since local midnight, one
   line each: key, title, `created` or `updated`, and by what (sweep annotation, digest
   filing, or outside activity — the last flagged, since it's news). Built from the
   step-3 query, not tick memory, so every tick restates the full day; a later tick's
   report is always the complete picture.
4. **Audit** — remaining problems, verbatim.

A quiet tick reports in one line ("sweep: nothing new").

## Autonomy

Runs unattended under `/loop`, so the write policy is fixed:

- **Yes:** journal entries, doc regeneration, local git commits, Linear comments/
  annotations backed by positive evidence, digest-mandated issue filing, filing `digest`-
  labeled tickets from ✋ deliverables (with the digest-file writeback marker, step 6a),
  and deleting a Pending bullet whose named artifact verifiably landed (step 4's narrow
  case — the diff contains the exact thing the bullet names).
- **Never:** close Linear tickets, edit Scope or any other ticket body text, comment
  inference onto a ticket (appears-redundant, appears-satisfied — report first, comment
  after the user confirms), apply the `agent-ready` label (nomination is report-only —
  the label dispatches Foundry, and dispatch is the user's call), post to Slack, push
  git, or guess frontmatter. Anything needing the user's judgement goes in the report,
  not into a file.

## Running it

`bun run sweep` (`claude '/loop 30m /sweep' --model claude-sonnet-5 …`) is the intended
mode; self-paced `/loop` also works. **Two model tiers, on purpose:** the loop session
runs on Sonnet because the sweep is a scheduler — greps, a join over compact lists, a
report — and every worker that writes (`slack-digest`, `log-change`, `feature-docs`,
`ticket-pass`) pins `model: "opus"` in its own spawn spec, so ticket and doc quality
doesn't depend on which model the session was launched with. To raise the judgement
tier, change those spawn specs, not the loop flag. The loop only
runs while a session is alive — fine, because the design is catch-up-safe: the first tick
after any gap backfills. If it must run with no machine awake, that is `/schedule` (cloud
cron), not a longer loop.
