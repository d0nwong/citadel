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

**3. Open state.** Greps, one API call, one script:

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
  reads each point's `repo` off it.
- verified points: `bun skills/sweep/scripts/points.ts --verified` — points the cockpit
  confirmed since the last tick, each licensing exactly the edit its own text names
  (Autonomy): a feature point goes to dispatch (5), a ticket point into the ticket-pass
  brief (6). Read here, because `points.ts` next runs at step 8, after both; that run
  drops the bullet, so each point is listed once. Usually empty.

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
  rescope?" The ticket is edited after the user confirms; cancelling is closing, and
  closing is manual (Autonomy) — part of the ask may survive the rewrite.
- **Match to an open `decided` entry → pass it to dispatch.** The landing entry must link
  back and flip the decision to `superseded` (log-change step 2b).
- **No match → journal with `ticket: null`** and ask in the report ("unattributed landing
  touched admin-invoicings — is this LIA-xx?").

**5. Dispatch.** One `log-change` run per unjournaled landing, **sequentially** — entries
for one feature share a folder and every run ends in a commit; parallel writers would
trip over the tree. Each run is a general-purpose subagent with **`model: "opus"`** (the
entry it writes is the "why" layer — judgement, not transcription) and gets the join's
findings for its landing (ticket or null, decided entry to supersede, digest permalink as
`source:`). log-change step 6 then drives `feature-docs` for the affected features. Two
more things get a `feature-docs` run here: entries left `implemented` by a previous sweep
(audit's "refresh missed" nag), and each step-3 verified point that names a feature
rather than a ticket — a doc sentence the user confirmed is stale; the point's own text
says which.

The general rule for what gets a subagent: a stage earns one when its input is bulky
(threads, doc trees, diffs) *and* its output is a blackboard write the sweep can re-read
afterwards — not because it is a stage. Bulky reading happens in the worker; the sweep
keeps only conclusions.

**5b. Decisions ahead of code.** The docs describe code, so a rule decided in Slack is
silently wrong in them until it lands. Every 🔴 item in today's digest that **changes a
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
first, skipping any feature already refreshed this tick. `tiers` is authoritative:
`accio sync` only advances an arch stamp when the feature's core files or owned endpoints
changed since the product tier was read, so a disagreement is a stale product doc, never
bookkeeping, and `accio audit` fails on it until the product tier catches up. Three per
tick is a cost cap, not a judgement: the list is state, so the remainder is picked up
next tick.

**6. Ticket pass.** Linear is the sweep's terminal surface — the queue the user actually
reads — so this stage makes it current, through the `ticket-pass` worker (the loop's only
Linear writer, Autonomy). Four parts run in **one `ticket-pass` subagent** — 6a file
tickets from unlinked ✋ items, 6b fold digest items into the open tickets they link, 6c
review open tickets against refreshed docs, 6e make the edit each verified point licensed
— bulky readers of threads, doc trees and ticket bodies, per the dispatch rule; 6d stays
inline because it is one judgement per ticket over a list the sweep already holds. The
worker's procedure and prompt are `skills/sweep/ticket-pass.md`.

**Skip the spawn** when there is nothing for it: no unmarked unlinked ✋ items, no
ticket-linked digest item newer than the previous tick's `_Tick` stamp in
`reports/<today>.md`, no feature refreshed this tick, *and* no step-3 verified point
naming a ticket (step 8 drops that point's bullet whether or not the worker ran — skip
it and the edit is lost for good).

Otherwise, **after dispatch has finished** (the worker writes the digest file and
commits — a parallel writer would trip over dispatch's tree), spawn ONE general-purpose
subagent via the Agent tool with **`model: "opus"`** (Running it, below), using the
prompt in `ticket-pass.md` with its `{…}` filled from steps 1–5. Hand it conclusions,
not sources.

When it returns, re-read what the blackboard can answer rather than trusting the report:
the digest file for ` → LIA-xx` markers, and the step-3 ticket query for the new keys —
that refreshed list is also what 6d and "Linear today" run over. Only the inference lines
(Needs-you) come from the report, because no file holds them; a subagent's report is
never shown to the user, so an unrelayed finding is a lost one.

**6d. Nominate ready tickets** (inline, every tick). Over the step-3 open-ticket list as
refreshed after the worker returned: a ticket qualifies when its Pending section is
absent, it has no blocked-by relation, and every Acceptance Criterion is concrete — an
observable outcome with a Technical Note naming where it is met (linear-ticket's "ACs are
executable" bar). A qualifying ticket gets a Decide line whose subject is the ticket key:
"**LIA-xx is ready** — send to Foundry?". That shape is load-bearing: a subject naming
one LIA key is how `points.ts` sets the point's `ticket` (and from it `repo`), and a
point without `ticket` has no Send button in the cockpit, only Ignore — so nominate only
a ticket that clears the bar, and write the key into the subject. The concreteness call
is judgement, so nomination stays report-only (Autonomy): sending dispatches an agent
against the body as written, precisely the decision the report exists to surface, not
make — the user settles it in Pensieve (README, "Downstream"). Like holds, an undecided
nomination restates every tick until decided or disqualified.

**7. Audit.** `bun run accio audit`. Problems it still reports after dispatch go in the
report, every one, in step 8's Audit shape — never silence one by inventing the missing
fact. `tiers disagree` lines left over are the stale features 5c's cap did not reach:
report them as a count with the feature ids ("4 product tiers still behind their arch
tier, next tick: …"), not as a decision for the user; they clear as 5c works through
the list.

**8. Report.** One screen, in this order, skipping empty sections. **"One screen" is a
budget: ≤ 1,200 words for a full day.** The 2026-09-01 report reached 3,981, almost all
`Done today` written as per-tick essays, and had to be rewritten. A Done-today block is
**1–3 bullets** naming what changed and the commit that holds it; the journal entry, the
docs and the diff carry the detail, so link rather than retell. Consecutive quiet ticks
collapse onto one line (`### 14:19 · 15:18 · 17:17`). Needs you follows the digest's
current-state rule: each bullet says what is open *now*, not how it got there.

1. **Needs you** — grouped by what is being asked of the user, as bold labels in
   this fixed order, empty groups omitted:
   - **Decide** — only the user can settle it: revert or accept, ticket or not, close
     or rescope, send a ready ticket to Foundry (6d nominations), attribute an
     unattributed landing.
   - **Verify** — an inference to check: appears-implemented or appears-redundant
     tickets, Pending bullets that only *appear* satisfied, partial matches awaiting an
     AC edit, 6b/6c findings. The confirmation comes back as a `verified` decision that
     licenses the edit the bullet could only report (Autonomy) — so write the ask as the
     edit you would make, not as "did I read this right?".
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
   line is the fact, never the history — link the journal entry, doc, ticket or diff
   rather than retell it. ✋ items that got tickets appear by key, not restated. Three rules come from `points.ts` (below), which owns ids, ages and
   decisions:
   - **The subject is the item's identity** — the point's id derives from it, so an
     open item keeps its subject text verbatim from tick to tick; rewording restarts
     its age and brings a decided point back as a new one.
   - **You don't compute ages.** Write `· new` for anything you believe is new, keep
     the previous tick's suffix otherwise; the script rewrites every suffix.
   - **Write every open point, decided or not.** You never read `decisions/` to
     compose this section; the script drops decided points. A point you leave out
     because "it was decided" is one the script can no longer tell apart from one whose
     condition cleared.
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

**The report is a file**, `reports/<today>.md`, **updated in place, not replaced**, and
it is the human copy of the one thing on the blackboard that holds an inference — a
report that only went to the terminal is a report that was lost. Its sections have two
natures:

- **Needs you, Linear today, Audit are state.** Each tick re-emits them from this
  tick's findings, replacing the previous body: an item still open restates, an item
  resolved drops out, nothing is appended — a snapshot that accumulated stale bullets
  would be worse than none.
- **Done today is a log.** Append this tick's `### HH:MM` sub-block at the end; never
  rewrite or drop an earlier tick's. This is the one place the file remembers the day's
  sequence, so a reader doesn't need `git log -p reports/`.

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
untouched).

**`points.json` is Needs-you as data**, the machine copy of the report: one record per
Decide / Verify / Confirm / On-hold / Housekeeping bullet, with `id` (`<group>/<slug>` of
the subject), `group`, `subject`, `ask`, `detail`, `firstSeen`, `ticket` / `repo` /
`features` when the line carries them, and `decision` (the `decisions/` file body,
copied) on a point the cockpit has sent, ignored or verified — the shape Pensieve lists
to offer Send / Ignore / Verify per point. It is **derived from the report, never
hand-written**: two shapes of one list, and deriving one from the other is what keeps
them from drifting. The script owns:

- **ages** — `· new` on the day a subject first appears, `· Nd` after. `firstSeen`
  carries over from the previous `points.json` by id, so it survives the day rollover
  and the decided-point drop, and every suffix is rewritten to agree with it, never
  with tick memory;
- **`ticket` and `repo`** — `ticket` when the subject or detail names exactly one LIA
  key; `repo` from that ticket's `[FE]` / `[BE]` title tag in `.state/linear-titles.json`
  (step 3); no tag, no `repo` — the cockpit asks;
- **decisions** — `decisions/<group>/<slug>.json`, matched by the file's `point` id, not
  its path, and only against a point in this tick's report: a decision for a point that
  is gone changes nothing, a reworded subject renders undecided with the stale file left
  alone, and the match is re-checked every tick against a point you still observe. A
  matched point is dropped from the report's Needs-you and kept in `points.json` with
  the `decision` attached — the one asymmetry between the two shapes. So an ignored
  point stops reappearing, a sent point stops asking, and a verified point stops asking
  because this tick already made the edit it licensed (step 3) — the drop records that,
  it does not stand in for it;
- **two report lines** — `- N points decided (decisions/)` under Housekeeping (absent
  when N is 0) and an `**Unreadable decision files**` block under Audit naming any file it
  could not parse (that point renders undecided until the file is fixed). Rewrite
  neither; it rewrites both each run.

**A quiet tick never shrinks the file.** "Nothing new" is relative to the previous tick;
the file is read in the morning with no previous tick in view, and Pensieve renders it
as the day's state. The quiet update is: new `_Tick …_` line, state sections re-emitted
(identical), no Done-today block, `sweep: nothing new` under the tick line if you want
the quietness recorded — and `points.ts` runs all the same, so the file gets a new `tick`
and the same points. The terminal one-liner ("sweep: nothing new") is a courtesy, never
the file's content, and on its own it is only correct on the first tick of a day when
there is genuinely nothing open — step 3 found no holds, no nominations, and audit is
clean — not merely nothing *new*.

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
    it is not "waiting"); and **the edit a point with a `verified` decision named** —
    the user's confirmation is the fact, so the *appears*-satisfied bullet it names is
    deleted, the *appears*-stale sentence rewritten: exactly that edit, once, in its
    section. A verified point whose ask needs no write gets none, and is not restated.
  - *What doesn't:* anything that is only a semantic match. Say *appears* in the report
    and leave the body alone.

**Never:**

- close or cancel a Linear ticket — a landing may implement half a ticket, and a
  wrongly closed ticket vanishes from the only queue the user reads;
- write inference into a ticket (appears-satisfied, appears-redundant, bullet-to-landing
  mappings) — report first, edit after the user confirms; a wrong "this may be moot" in
  a shared ticket is noise the team sees. The confirmation is a `verified` decision, and
  it lifts this rule for the one edit that point named, nothing wider — never a close,
  never an AC tick;
- leave a landing as a comment instead of updating the body;
- tick or untick an AC — the boxes are the implementer's record, and a tick from
  the sweep's own reading is inference in the shared body;
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
`ticket-pass`) pins `model: "opus"` in its own spawn spec — filing, journaling and
review are judgement calls, and a weaker model files worse tickets — so ticket and doc
quality doesn't depend on the model the session was launched with. To raise the
judgement tier, change those spawn specs, not the loop flag. The loop only runs while a
session is alive, which is fine because the first tick after any gap backfills; if it
must run with no machine awake, that is `/schedule` (cloud cron), not a longer loop.
