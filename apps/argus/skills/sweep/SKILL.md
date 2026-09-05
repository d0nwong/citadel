---
name: sweep
description: One idempotent pass over the whole workspace loop — digest tick, unjournaled-landing scan, the join between landings / open decisions / open Liamai tickets, per-item dispatch of log-change and feature-docs, a Linear ticket pass (file tickets from digest ✋ action items, review open tickets against refreshed docs), then accio audit and a morning-readable report. Run via /loop 2h /sweep or on demand; every stage is state-driven and catch-up-safe, so the first run after days away backfills everything. Use when the user says "sweep", "run the sweep", "catch me up on everything", or asks to run the workspace loop.
---

# sweep — the scheduler for the workspace loop

The workspace is a blackboard: durable state lives in files (`digests/`, per-feature
`journal/`, `docs/`), reconciliation is deterministic (`pr-facts`, `accio audit`), and
agents are stateless workers. The sweep is the scheduler and stays deliberately dumb:
**the files decide what runs.** Every stage is idempotent, so a tick after three days
away does three days of work and a tick after ten quiet minutes does nothing.

Three invariants:

- **Null over guess.** An unattributed landing gets `ticket: null` and a question in the
  report — never a plausible key. Wrong frontmatter silently misroutes every future grep.
- **The sweep reads files, not reports.** Subagents make files current; triage always
  works off the file. That is what makes a half-crashed sweep safely re-runnable.
- **Verified facts go into files and tickets; inference goes in the report.** The full
  write policy is the Autonomy section below — every step that writes defers to it.

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
- write the open tickets' titles to `.state/linear-titles.json` as `{ "LIA-nn": "<title>" }`
  (gitignored; refresh it again after the ticket pass adds keys). Step 8's `points.ts`
  reads the `[FE]` / `[BE]` title tag off it to fill each point's `repo`.

**4. The join.** For each `NOT JOURNALED` landing, before dispatching anything, match it
against the open tickets and open decisions. The join is never delegated: it is the
cross-product of landings, tickets and decisions, and splitting it loses the join.

How to match:

- **by key** when the branch or commits typed one — trust it;
- **semantically** otherwise: features the diff touches vs. ticket scope vs. the digest
  thread that spawned the ticket. Teammates do not reference Liamai keys, so this is the
  normal path, and it is a judgement call — phrase every semantic match as *appears*, not
  *is*.
- **against the whole ticket**, not just Scope: a BE landing shipping the endpoint an FE
  ticket was waiting on satisfies a **Pending** bullet — exactly the event Pending tracks.
- **for redundancy** too: a landing can make a ticket moot instead of implementing it —
  it deleted or rewrote the code the ticket targets, solved the same problem another
  way, or shipped a decision that ends the ask. Check whenever a landing touches a
  feature an open ticket names; the tell is the diff removing or replacing the thing the
  ticket wants changed. Always *appears*.

What each outcome does:

- **Match to an open ticket → update the ticket, per Autonomy.** The verified facts (PR
  link, merge sha, author, what the diff changed) go into the description; which Scope /
  Pending bullets the landing *appears* to satisfy is inference and goes in the report:
  "LIA-xx appears already implemented by fe#N — verify", or for a partial "fe#N appears
  to cover 2 of 4 ACs on LIA-xx — edit the ACs?". Dedupe as the digest does: one
  update per landing, not one per tick.
- **Redundancy match → report only.** "LIA-xx appears redundant after fe#N — close or
  rescope?" The ticket is edited after the user confirms. Cancelling is closing, and
  closing is manual (Autonomy): the sweep may have misread the diff, and part of the ask
  may survive the rewrite.
- **Match to an open `decided` entry → pass it to dispatch.** The landing entry must link
  back and flip the decision to `superseded` (log-change step 2b).
- **No match → journal with `ticket: null`** and ask in the report ("unattributed landing
  touched admin-invoicings — is this LIA-xx?").

**5. Dispatch.** One `log-change` run per unjournaled landing, **sequentially** — entries
for one feature share a folder and every run ends in a commit; parallel writers would
trip over the tree. Each run is a general-purpose subagent with **`model: "opus"`** (the
entry it writes is the "why" layer — judgement, not transcription) and gets the join's
findings for its landing (ticket or null, decided entry to supersede, digest permalink as
`source:`). log-change step 6 then drives `feature-docs` for the affected features;
entries left `implemented` by a previous sweep (audit's "refresh missed" nag) get a
`feature-docs` run here too.

The general rule for what gets a subagent: a stage earns one when its input is bulky
(threads, doc trees, diffs) *and* its output is a blackboard write the sweep can re-read
afterwards — not because it is a stage. Bulky reading happens in the worker; the sweep
keeps only conclusions.

**5b. Decisions ahead of code.** Behaviour changes are decided in Slack before they are
code, and the docs describe code only — so between decision and landing the product doc
is silently about to be wrong. Every 🔴 item in today's digest that **changes a
documented rule** (a Business Rules row, a Mismatch row, a Known Gap) and has no code
landed yet gets a `log-change` run **at decision time**: `status: decided`, `pr: null`,
`features:` naming the feature, `affects:` naming the rule ids it will rewrite (read them
off the product/arch docs — the digest entry usually already cites them). Docs are not
touched; `accio sync` surfaces the entry in that product doc's "Decided, not yet landed"
region, and the landing entry later supersedes it. Dedupe against the step-3 decisions
grep: one entry per decision, not per tick. Product direction with no rule behind it yet
(a new feature nobody has scoped) is not a rule change — leave it in the digest.

**5c. Stale pass.** `bun run accio stale` — one line per feature whose docs no longer
describe the code, with why (`tiers`, `fe-core`, `be-handlers`, `journal`). Dispatch
`feature-docs` for each, **sequentially, at most three per tick**, oldest product stamp
first, skipping any feature dispatch already refreshed this tick. The `tiers` reason is
authoritative: `accio sync` only advances an arch stamp when the feature's core files or
owned endpoints changed since the product tier was read, so a disagreement is a stale
product doc, never bookkeeping — and `accio audit` fails on it until the product tier
catches up. Three per tick is a cost cap, not a judgement: the list is state, so the
remainder is picked up next tick.

**6. Ticket pass.** Linear is the sweep's terminal surface — the queue the user actually
reads — so this stage makes it current, and the `ticket-pass` worker is the **only
Linear writer in the loop** (the digest links tickets, it never edits them). Three
parts run in **one `ticket-pass` subagent** — 6a file tickets from unlinked ✋ items,
6b fold digest items into the open tickets they link, 6c review open tickets against
refreshed docs — all bulky single-use readers of Slack threads and doc trees, per the
dispatch rule. 6d stays inline because it is a one-line judgement per ticket over a
list the sweep already holds. The worker's procedure and prompt live in
`skills/sweep/ticket-pass.md`.

**Skip the spawn** when there is nothing for it: no unmarked unlinked ✋ items, no
ticket-linked digest item newer than the previous tick's `_Tick` stamp in
`reports/<today>.md`, *and* no feature refreshed this tick. Otherwise, **after dispatch has finished** (the worker writes the
digest file and commits — a parallel writer would trip over dispatch's tree), spawn ONE
general-purpose subagent via the Agent tool with **`model: "opus"`** (filing and review
are judgement calls, and a weaker model files worse tickets), using the prompt in
`ticket-pass.md` with its `{…}` filled from steps 1–5. Hand it conclusions, not sources.

When it returns, don't take the report on faith for anything the blackboard can answer:
re-read the digest file for the ` → LIA-xx` markers and re-run the step-3 ticket query
for the new keys — that refreshed list is also what 6d and the report's "Linear today"
section run over. Only the inference lines (Needs-you) come from the report, because no
file holds them. A subagent's report is never shown to the user; an unrelayed finding is
a lost one.

**6d. Nominate agent-ready tickets** (inline, every tick). Over the step-3 open-ticket
list as refreshed after the worker returned: a ticket qualifies when its Pending section
is absent, it has no blocked-by relation, and every Acceptance Criterion is concrete — an
observable outcome with a Technical Note naming where it is met (linear-ticket's "ACs are
executable" bar).
A qualifying ticket not yet carrying `agent-ready` gets a Needs-you line: "LIA-xx looks
agent-ready — label it?". The concreteness call is judgement, so nomination is
report-only (Autonomy): the label is the entire contract with Foundry's ticket pickup
(README, "Downstream"), so applying it dispatches an agent — precisely the decision the
report exists to surface, not make. Like holds, a ready-but-unlabeled ticket restates
every tick until labeled or disqualified — the report is a snapshot, not a diff.

**7. Audit.** `bun run accio audit`. Problems it still reports after dispatch go in the
report, every one, in step 8's Audit shape — never silence one by inventing the missing
fact. `tiers disagree` lines
left over are the stale features 5c's per-tick cap did not reach — report them as a count
with the feature ids ("4 product tiers still behind their arch tier, next tick: …"), not
as a decision for the user; they clear themselves as 5c works through the list.

**8. Report.** One screen, in this order, skipping empty sections. **"One screen" is a
budget, not a figure of speech: ≤ 1,200 words for a full day.** The 2026-09-01 report
reached 3,981 and had to be rewritten — almost entirely `Done today`, which had grown to
87 lines because each tick block was written as an essay. A Done-today block is **1–3
bullets** naming what changed and the commit that holds it; the journal entry, the docs
and the diff carry the detail, and the block links to them rather than retelling them.
Consecutive quiet ticks collapse onto one line (`### 14:19 · 15:18 · 17:17`). The same
current-state rule the digest follows applies to Needs you: each bullet says what is open
*now*, not how it got there.

1. **Needs you** — grouped by what is being asked of the user, as bold labels in
   this fixed order, empty groups omitted:
   - **Decide** — only the user can settle it: revert or accept, ticket or not, close
     or rescope, apply `agent-ready` (6d nominations), attribute an unattributed
     landing.
   - **Verify** — an inference to check: appears-implemented or appears-redundant
     tickets, Pending bullets that only *appear* satisfied, partial matches awaiting a
     AC edit, 6b/6c findings.
   - **Confirm with someone** — needs a named teammate; the ask *is* the name.
     Un-ticketed ✋ pings and 🟠 items land here or under Decide, whichever fits.
   - **On hold** — holds waiting on something outside the loop. One line each, no
     detail: `subject → waits on X`. Nothing to do; listed so it is not forgotten.
   - **Housekeeping** — self-clearing state (stale features past the 5c cap,
     `implemented`-not-`documented` entries). One line with the count; Audit holds
     the list.

   Every Decide / Verify / Confirm item is **one headline and at most one detail
   line**:

   ```markdown
   - **<subject>** — <the ask, ≤ 12 words> · <age>
     <the one fact needed to act, ≤ 25 words>
   ```

   The subject is the ticket key or PR when there is one. The ask is a verb phrase or
   a question ("revert, or accept the churn?", "ticket them?", "Foong"). The detail
   line is the fact, never the history — the journal entry, docs, ticket and diff
   carry the rest, so link rather than retell. Age is `new` when the subject first
   appears today, else `Nd` — but you don't compute it: write `new` for anything you
   believe is new, keep the previous tick's suffix otherwise, and `points.ts` (below)
   rewrites every suffix from `reports/points.json`'s `firstSeen`, never tick memory.
   **The subject is the item's identity.** `points.json` derives each point's id from
   it (`<group>/<slug>`), Pensieve's Send / Ignore decisions are keyed by that id, and
   the age restarts when it changes — so an open item keeps its subject text verbatim
   from tick to tick; rewording is how a decided point comes back as a new one. ✋
   items that got tickets appear by key, not restated.
   **Write every open point, decided or not.** Pensieve's Send / Ignore verdicts live in
   `decisions/<group>/<slug>.json` (LIA-94); you never read them to compose this section.
   `points.ts` reads them and drops each decided point from the file's Needs-you while
   keeping its record in `points.json` with the `decision` attached — so an ignored
   point stops reappearing and a sent point stops asking, but the match is re-checked
   every tick against a point you still observe. A point you leave out because "it was
   decided" is a point the script can no longer tell apart from one whose condition
   cleared; the omission is the script's, not yours. The script also owns two lines:
   `- N points decided (decisions/)` under Housekeeping (absent when N is 0) and an
   `**Unreadable decision files**` block under Audit naming any file it could not parse
   — that point renders undecided until the file is fixed. Rewrite neither; it rewrites
   both each run.
2. **Done today** — entries written, docs refreshed, tickets filed (6a) and updated
   (keys + PRs), one `### HH:MM` sub-block per tick that did something.
3. **Linear today** — every Liamai ticket created or updated since local midnight, one
   line each: key, title, `created` or `updated`, and by what (sweep update, digest
   filing, or outside activity — the last flagged, since it's news). Built from the
   step-3 query, not tick memory, so every tick restates the full day.
4. **Audit** — every remaining problem, **one line each, grouped by kind**, none
   omitted: keep the feature or journal file and the kind, drop the boilerplate
   suffix (`bun run accio audit` reprints it in full). Shape:
   `- \`peer-review\` — tiers disagree (product@67e5abc, arch@885f086)` and
   `- fe#402 → admin-usage — implemented, docs re-verified 09-03`.

A quiet tick prints one line to the terminal ("sweep: nothing new") — a terminal
courtesy, never the file's content.

**The report is also a file.** `reports/<today>.md` is the durable copy of what you
print, **updated in place, not replaced**. Its sections have two natures:

- **Needs you, Linear today, Audit are state.** They describe what is open *now*, so
  each tick re-emits them from this tick's findings, replacing the previous tick's
  section body. An item still open restates; an item resolved drops out. Nothing is
  appended — a snapshot that accumulated stale bullets would be worse than none.
- **Done today is a log.** Append this tick's work as a `### HH:MM` sub-block at the
  end of the section; never rewrite or drop an earlier tick's block. This is the one
  place the file remembers the day's sequence, so a reader doesn't need
  `git log -p reports/` to see it.

Format:

```markdown
# sweep — 2026-08-28

_Tick 16:54 · digest writeback `6433b4e` · staging@8815ba968 · dev@c9c52464_

## Needs you

**Decide**
- **fe#396 quoteStyle flip** — revert, or accept the churn? · 4d
  Only touched files were reformatted; the next repo-wide format run churns the rest.

**Verify**
- **LIA-79** — huddle's "retainer forced to 100%" appears to close its Pending bullet · 2d

**Confirm with someone**
- **Capacity-unit direction** — Foong · 2d
  Huddle: 1 unit = 2.5 h. Shipped: 2.5 units = 1 h.

**On hold**
- fe#401 capacity formula → waits on LIA-78's usage endpoint

**Housekeeping**
- 3 product tiers behind their arch tier (see Audit) — clears over the next ticks

## Done today
### 12:25
- …
### 16:54
- …

## Linear today
…

## Audit

**Tiers disagree**
- `peer-review` — product@67e5abc, arch@885f086

**Implemented, not documented**
- fe#402 → admin-usage — docs re-verified 09-03
```

Each tick: read the existing file (create it from the template if today's doesn't
exist), replace the `_Tick …_` line, replace the bodies of Needs you / Linear today /
Audit, append a `### HH:MM` block under Done today if this tick wrote anything, write it
back, then run

```sh
bun skills/sweep/scripts/points.ts        # reports/<today>.md → reports/points.json, ages synced
```

and commit both files, plus `decisions/`, with the tick's other writes (`git add reports/
decisions/ …` — any decision file Pensieve wrote since the last tick rides in this commit,
untouched). `points.json` is Needs-you as data
— one record per Decide / Verify / Confirm / On-hold / Housekeeping bullet, with `id`
(`<group>/<slug>` of the subject), `group`, `subject`, `ask`, `detail`, `firstSeen`, and
`ticket` / `repo` / `features` when the line carries them, and `decision` (the
`decisions/` file body, copied) on a point the cockpit has sent or ignored — the shape
Pensieve lists to offer Send / Ignore per point. It is
**derived from the report, never hand-written**: the two are the same list in two shapes,
and deriving one from the other is what keeps them from drifting — the one asymmetry is
that a decided point is in `points.json` and not in the report, and that too is the
script's doing (Needs you, above). `firstSeen` carries
over from the previous `points.json` by id, so it survives the day rollover and the
decided-point drop; the script
then rewrites the report's `· new` / `· Nd` suffixes to agree. `repo` comes from the
ticket's `[FE]` / `[BE]` title tag, which the script reads from `.state/linear-titles.json`
— step 3 writes it. Decisions match by the file's `point` id, not its path, and only
against a point in this tick's report: a decision for a point that is gone changes
nothing, and a reworded subject renders undecided with the stale file left where it is.
The report is the human copy and `points.json` the machine copy of
the one thing on the blackboard that holds an inference, so a report that only went to
the terminal is a report that was lost.

**A quiet tick never shrinks the file.** "Nothing new" is relative to the previous tick;
the file is read in the morning with no previous tick in view, and Pensieve renders it
as the day's state. On a quiet tick the update is: new `_Tick …_` line, state sections
re-emitted (identical), no Done-today block; append `sweep: nothing new` under the tick
line if you want the quietness recorded, and run `points.ts` all the same — the file gets
a new `tick` and the same points. The terminal one-liner alone is only correct on
the first tick of a day when there is genuinely nothing open — meaning step 3 found no
holds, no agent-ready nominations, and audit is clean, not merely nothing *new*.

## Autonomy

Runs unattended under `/loop`, so the write policy is fixed. This is the single source
for every write the sweep and its workers make; the steps above and `ticket-pass.md`
refer here rather than restating it.

**Yes:**

- journal entries, doc regeneration, `reports/<today>.md` and the derived
  `reports/points.json`, local git commits — and those commits include whatever
  Pensieve has written under `decisions/` (step 8), as-is;
- filing Liamai tickets from unlinked digest ✋ deliverables (6a, with the digest-file
  writeback marker) and folding linked digest items into their tickets (6b) — both in
  `ticket-pass`, the loop's only Linear writer;
- **Linear ticket description updates backed by verified facts.** The rules are
  linear-ticket's ("Keep the ticket current by editing it, not commenting on it" and
  "The ticket is the current task, not its history"); in sweep terms:
  - *Where:* the description, in the section the fact belongs to, via `save_issue`
    `patch`. Never a comment — a comment leaves the body saying the old thing, and the
    body is what Foundry executes and what the user reads, so the body is what has to
    be true.
  - *How:* rewrite the sentence the fact made false. No dated "Landed …" / "Decided …"
    paragraphs, no Slack quotes; the journal owns history.
  - *What counts as verified:* delete a Pending bullet whose named artifact (endpoint,
    field, table) is in the landing's diff; rewrite a Background sentence the landing
    made false; fix a Technical Note whose line anchor or function name moved (a drift
    re-verified against the pinned sha is a fact, not an inference); move a BE
    dependency's client regen into Scope once it is on `origin/dev` *and deployed* to
    the spec's export server (FORMAT.md's codegen rule — nobody else owns the regen, so
    it is not "waiting").
  - *What doesn't:* anything that is only a semantic match. Say *appears* in the report
    and leave the body alone.

**Never:**

- close or cancel a Linear ticket — a landing may implement half a ticket, and a
  wrongly closed ticket vanishes from the only queue the user reads;
- write inference into a ticket (appears-satisfied, appears-redundant, bullet-to-landing
  mappings) — report first, edit after the user confirms; a wrong "this may be moot" in
  a shared ticket is noise the team sees;
- leave a landing as a comment instead of updating the body;
- tick or untick an AC — the boxes are the implementer's record, and a tick from
  the sweep's own reading is inference in the shared body;
- apply `agent-ready` to an already-open ticket — nomination is report-only; the one
  pre-authorised exception is 6a's filing-time label on tickets the sweep itself files;
- write to Linear from any worker other than `ticket-pass` — `slack-digest` only reads
  it, to link items to the tickets they concern;
- create, edit or delete a file under `decisions/` — Pensieve writes them, the sweep
  and its workers only read and commit them; a decision the sweep disagrees with is a
  report line, not a file change;
- post to Slack, push git, or guess frontmatter.

Anything needing the user's judgement goes in the report, not into a file.

## Running it

`bun run sweep` (`claude '/loop 30m /sweep' --model claude-sonnet-5 …`) is the intended
mode; self-paced `/loop` also works. **Two model tiers, on purpose:** the loop session
runs on Sonnet because the sweep is a scheduler — greps, a join over compact lists, a
report — and every worker that writes (`slack-digest`, `log-change`, `feature-docs`,
`ticket-pass`) pins `model: "opus"` in its own spawn spec, so ticket and doc quality
doesn't depend on which model the session was launched with. To raise the judgement
tier, change those spawn specs, not the loop flag. The loop only runs while a session is
alive — fine, because the design is catch-up-safe: the first tick after any gap
backfills. If it must run with no machine awake, that is `/schedule` (cloud cron), not a
longer loop.
