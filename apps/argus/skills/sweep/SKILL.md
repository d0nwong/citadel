---
name: sweep
description: One idempotent pass over the whole workspace loop — marauder ingest takes in the base branches and the channel, the sweep places what attached to nothing, dispatches log-change and feature-docs per landing, runs the coherence check and the event-driven ticket pass, then renders the board and commits. Run via /loop 15m /sweep or on demand; every stage is state-driven and catch-up-safe, so the first run after days away backfills everything. Use when the user says "sweep", "run the sweep", "catch me up on everything", or asks to run the workspace loop.
---

# sweep — the scheduler for the workspace loop

The workspace is a blackboard: durable state lives in files (`workstreams/`, per-feature
`journal/`, `docs/`), reconciliation is deterministic (`marauder ingest`, `pr-facts`,
`accio audit`), and agents are stateless workers. The sweep is the scheduler and stays
deliberately dumb: **the files decide what runs.** Every stage is idempotent, so a tick
after three days away does three days of work and a tick after ten quiet minutes does
nothing.

Three invariants:

- **Null over guess.** An unattributed landing gets `ticket: null` and an entry a person
  answers — never a plausible key. Wrong frontmatter silently misroutes every future grep.
- **The sweep reads files, not what a worker said.** Subagents make files current; triage
  always works off the file. That is what makes a half-crashed sweep safely re-runnable.
- **Verified facts go into files and tickets; anything needing the user's judgement
  becomes something the board shows them.** The full write policy is the Autonomy section
  below — every step that writes defers to it.

**Where the archive is.** `reports/`, `reports/points.json`, `digests/` and `arcs/` are
everything the loop wrote before 2026-09-09, when the report, the digest, the point and
the arc were replaced by the workstream and the pages rendered from it. They stay
readable in Pensieve as history. Nothing in this skill writes to them again.

## Procedure

**1. Ingest.**

```sh
bun run marauder ingest --landings --slack
```

Three things in one run, in this order. The verdicts a person gave in Pensieve
(`decisions/marauder/*.json`) are applied first, because each one names an entry in the
queue as it stands *before* this tick changes that queue. Then every merge on
`origin/staging` and `origin/dev` since each side's newest landing becomes a
`verified-landing` event and advances that side's stage. Then the channel since the cursor
runs down the attachment ladder — thread root, ticket or PR reference, code vocabulary,
author — and becomes events wherever both the workstream and the kind are provable.
Everything else goes to `workstreams/_unsorted.json`. No script here calls a model, and
none creates a workstream.

The cursor is `workstreams/.state.json`, and `slack-pull` advances it into
`.state.next.json`. **Promote it at step 7, after the commit** — a crashed tick has to
replay the channel, never skip it.

A huddle happened when the queue holds an entry saying its notes are unread (the `why`
names the ts). Read the canvas with `slack_read_file`, write its key points to a file, and
record them:

```sh
bun run marauder huddle <ts> --points <file> --reason "read the 09:34 huddle"
```

A key point is one thing the meeting settled, asked for or dated — not one bullet. The
canvas says everything twice, once under Summary and once under Action items; write each
thing once. A meeting is usually three to eight points. Each point is
`{ kind, slug, summary, to, why, text, name, date, owner }`:

- `summary` is the sentence a reader sees, in `style.md`'s voice: a person does something,
  about twenty words (the page prints the date in front, inside the ceiling), a full stop
  at the end. "Foong asked you to review Sam's pages
  before the launch", never "Slackbot: review pages pushed by".
- `kind` is the event kind: `contract-change` for a thing settled, `new-ask` for work asked
  for, `directed-at-person` for an ask aimed at a person (`to`, with `you` for the reader),
  `deadline` for a date (`name`, `date`, `owner`), `chat` for anything not about the work.
- `slug` is the workstream it belongs to when you would bet on it, `null` when you would
  not. A slug-less decision or ask becomes a proposal in the queue, named by `name`; a
  slug-less ask aimed at you stays in the queue with `to`; a slug-less date is a milestone.
- `chat` is small talk, and logistics that name nobody on the record — "Carlos monitors
  New York hours after launch". It is never recorded. Logistics aimed at you is an ask.
- `text` is the bullet it came from, verbatim, so the workstream learns its vocabulary.

The verb validates the file and refuses it whole, naming the point, when a sentence breaks
a style rule, a slug does not exist, or a deadline lacks its date. Reading the same notes
again replaces every point the sweep recorded before and keeps any a person placed.

**2. Place what attached to nothing.** `workstreams/_unsorted.json`, every entry with
`needs: "read"`. Ingest deliberately stops at what it can prove; this is the step that
reads. Each entry carries its own words, its candidates and why none of them was certain;
read it against the open list, which is `bun run marauder board` — every open workstream in
the team's own words, offline and free:

- it plainly belongs to one workstream →
  `bun run marauder attach <id> <slug> --auto --reason "<why, in one clause>"`. `--auto`
  records it as the sweep's own reading rather than a person's decision, which is what
  lets a wrong one be recognised later.
- it probably does, and you would not bet on it → `bun run marauder suggest <id> <slug>`.
  It stays in the queue carrying the guess, and one click in Pensieve settles it.
- it belongs to nothing that exists → leave it. A `kind: "new"` entry is a proposal, and
  **opening a workstream is the user's** (Autonomy).

Attaching teaches: the thread root, the tickets, the PRs and the identifiers the item used
go onto that workstream's `keys`, so the next message like it attaches on its own. That is
why the judgement is worth making here rather than deferring it every tick.

**3. Landings scan.** Both repos:

```sh
bun skills/log-change/scripts/pr-facts.ts --since <date>        # FE → staging
bun skills/log-change/scripts/pr-facts.ts --since <date> --be   # BE → origin/dev
```

`<date>` = 7 days back by default; widen if the newest journal entry is older than that.
The `NOT JOURNALED` marker is what makes the window stateless — already-journaled landings
drop out on their own, so overlapping windows are harmless. This is the same list step 1
ingested, read for a different question: which landings still have no journal entry.

**4. Dispatch.** One `log-change` run per unjournaled landing, **sequentially** — entries
for one feature share a folder and every run ends in a commit; parallel writers would trip
over the tree. Each run is a general-purpose subagent with **`model: "opus"`** (the entry
it writes is the "why" layer — judgement, not transcription) and gets, for its landing:

- the workstream ingest attached it to, and the ticket that workstream's `keys.tickets`
  names — `bun run marauder show <slug>` is the whole story in one page;
- the open `decided` entry it supersedes, if any:
  `grep -rln 'status: decided' alden/alden-portal/features/*/journal/ alden/alden-portal/features/*/*/journal/ 2>/dev/null`
  (both globs — nested features like `admin/invoicing` keep their journal a level deeper).
  The landing entry must link back and flip that decision to `superseded` (log-change 2b);
- the permalink of the event that announced it, as `source:`.

log-change step 6 then drives `feature-docs` for the affected features.

**The join is smaller than it used to be.** A landing's ticket was once inferred against
every open ticket in Linear, one semantic guess per landing. Ingest has already attached
the landing to a workstream by PR number, ticket reference or vocabulary, and that
workstream names its tickets — so the attribution is a record, not a guess. A landing
ingest could not place is one step 2 either placed or left alone; an unplaced landing is
journaled `ticket: null`, exactly as before, and its queue entry is the question the user
answers in Pensieve.

**4b. Decisions ahead of code.** The docs describe code, so a rule decided in the channel
is silently wrong in them until it lands. Every `contract-change` event this tick that
**changes a documented rule** (a Business Rules row, a Mismatch row, a Known Gap) and has
no landing behind it gets a `log-change` run **at decision time**: `status: decided`,
`pr: null`, `features:` naming the feature, `affects:` naming the rule ids it will rewrite
(read them off the product/arch docs). Docs are not touched; `accio sync` surfaces the
entry in that product doc's "Decided, not yet landed" region, and the landing entry later
supersedes it. Dedupe against step 4's `decided` grep: one entry per decision, not one per
tick. Product direction with no rule behind it yet is not a rule change — it is already an
event on its workstream, and that is where it stays.

**4c. Stale pass.** `bun run accio stale` — one line per feature whose docs no longer
describe the code, with why (`tiers`, `fe-core`, `be-handlers`, `journal`). Dispatch
`feature-docs` for each, **sequentially, at most three per tick**, oldest product stamp
first, skipping any feature already refreshed this tick. `tiers` is authoritative:
`accio sync` only advances an arch stamp when the feature's core files or owned endpoints
changed since the product tier was read, so a disagreement is a stale product doc, never
bookkeeping, and `accio audit` fails on it until the product tier catches up. Three per
tick is a cost cap, not a judgement: the list is state, so the remainder is picked up next
tick.

**5. Coherence check.** `bun run marauder check` — the workstreams busy enough that two
capabilities could be hiding in one of them, each with what done means and its recent
events. Read them. Where two separable pieces of work are plainly visible:

```sh
bun run marauder propose-split <slug> --groups '[{"name":"…","events":["…"]},{"name":"…","events":["…"]}]'
```

That queues the proposal for a person to accept; **nothing here cuts a workstream** (below).
Where a workstream still reads as one thing, say nothing — asking twice about the same
one is noise, and a proposal already waiting keeps it off this list anyway.

**6. Ticket pass.** Linear is the sweep's terminal surface — the queue the user actually
reads — so this stage makes it current, through the `ticket-pass` worker (the loop's only
Linear writer, Autonomy). The work runs in **one `ticket-pass` subagent**, a bulky reader
of ticket bodies and doc trees.

Its inputs are this tick's workstream events (`bun run marauder changed --since <prev
tick ISO>`), and for each ticket the diff `bun run marauder ticket-plan` computes between
the body and its workstream's `open_questions` and `facts`. Each event's kind decides its
own action, and what needs a person comes back as a flag rather than an edit (ARG-159).
The worker's procedure, its action table and its prompt are `skills/sweep/ticket-pass.md`.

**Skip the spawn** when there is nothing for it: no workstream gained an event this tick
and no feature was refreshed this tick.

Otherwise, **after dispatch has finished** (a parallel writer would trip over dispatch's
tree), spawn ONE general-purpose subagent via the Agent tool with **`model: "opus"`**
(Running it, below), using the prompt in `ticket-pass.md` with its `{…}` filled from steps
1–4. Hand it conclusions, not sources.

When it returns, re-read the record rather than trusting what it says: the worker writes
what it did back onto the workstreams (`marauder ticket`, `resolved`, `held`), so
`bun run marauder changed --since <prev tick>` says what happened and the board renders it.
A flag it could not act on is already an event; one it only mentioned is lost, so anything
in its Needs-you list naming no workstream goes in this tick's terminal output.

**7. Audit, render, commit.**

```sh
bun run accio audit
bun run marauder render
```

**Audit is a check on the loop, not a page for the reader.** Its problems — a missed doc
refresh, two doc tiers disagreeing, a journal entry that cannot be routed — print in this
tick's terminal output; the docs ones clear themselves through the next tick's stale pass.
None of them reaches the board, which holds the work, not the loop's own housekeeping.
Never silence one by inventing the missing fact.

`render` rewrites `marauder/board.md`, one page per workstream and today's changelog, from
`workstreams/*.json` and nothing else. A run that changed no record writes no byte, and a
page that breaks one of `skills/sweep/style.md`'s three mechanical rules is never written —
the run exits non-zero naming the line, and that is a bug in the record or the renderer,
not something to work around.

Then commit — one commit per writer, as today, with the render's last:

```sh
git add workstreams/ marauder/ decisions/
git commit -m "<the board's first Needs-you headline, or: quiet tick>"
mv workstreams/.state.next.json workstreams/.state.json
```

Any decision file Pensieve wrote since the last tick rides in that commit, untouched. The
cursor is promoted only once the commit has succeeded, which is what makes a crashed tick
replay rather than skip.

**Previewing a tick.** Every verb that writes takes `--dry-run`:

```sh
bun run marauder ingest --landings --slack --dry-run
bun run marauder check
bun run marauder render --dry-run
```

With steps 2, 4, 4b, 4c and 6 skipped, that is the whole procedure with nothing written
and nothing committed — what the first real tick after a change to this skill would do.

## Autonomy

Runs unattended under `/loop`, so the write policy is fixed. This is the single source for
every write the sweep and its workers make; the steps above and `ticket-pass.md` refer here
rather than restating it.

**Yes:**

- journal entries, doc regeneration, the rendered pages under `marauder/`, local git
  commits — and those commits include whatever Pensieve has written under `decisions/`
  (step 7), as-is;
- **the events ingest writes onto `workstreams/*.json`** — a merge on a base branch, a
  message the ladder places, the stage a landing implies — and the three readings the
  sweep makes of what ingest could not: `huddle` (step 1), `attach --auto` and `suggest`
  (step 2). Each is marked as the sweep's own reading, which is what makes a wrong one
  findable;
- **queueing a split** with `propose-split` when a workstream has stopped being one thing
  (step 5). The proposal is a queue entry; the cut happens when a person accepts it;
- **the ticket pass's own corrections** — `marauder ticket` writing back the key it filed,
  `pending` recording a question-to-bullet pairing, `resolved` taking an answered question
  off the record, `held` putting a withheld edit in front of the reader (ARG-159);
- filing Alden tickets from the asks a workstream carries, and folding a tick's events
  into the tickets its workstream names — both in `ticket-pass`, the loop's only Linear
  writer;
- **deleting a Pending bullet once its question is answered**, and writing the answer into
  Technical Notes. Settled 2026-09-09: the bullet is wrong the moment the question is
  answered, and one annotated "Answered:" reads as still open. The pairing between a
  question and its bullet is recorded on the question (`pending_ref`) the first time it is
  made, so no later tick reads the same two texts again;
- **Linear ticket description updates backed by verified facts.** The rules are
  linear-ticket's ("Keep the ticket current by editing it, not commenting on it" and
  "The ticket is the current task, not its history"); in sweep terms:
  - *Where:* the description, in the section the fact belongs to, via `save_issue`
    `patch`. Never a comment — a comment leaves the body saying the old thing, and the
    body is what Foundry executes and what the user reads, so the body is what has to
    be true.
  - *How:* rewrite the sentence the fact made false. No dated "Landed …" / "Decided …"
    paragraphs, no channel quotes; the journal owns history.
  - *What counts as verified:* delete a Pending bullet whose named artifact (endpoint,
    field, table) is in the landing's diff; rewrite a Background sentence the landing made
    false; fix a Technical Note whose line anchor or function name moved (a drift
    re-verified against the pinned sha is a fact, not an inference); move a BE dependency's
    client regen into Scope once it is on `origin/dev` *and deployed* to the spec's export
    server (FORMAT.md's codegen rule — nobody else owns the regen, so it is not "waiting").
  - *What doesn't:* anything that is only a semantic match. It is a flag, and a flag
    reaches the reader as an event, never as a body edit.

**Never:**

- close or cancel a Linear ticket — a landing may implement half a ticket, and a wrongly
  closed ticket vanishes from the only queue the user reads;
- write inference into a ticket (appears-satisfied, appears-redundant, bullet-to-landing
  mappings) — flag first, edit after the user confirms; a wrong "this may be moot" in a
  shared ticket is noise the team sees. The confirmation is a `verified` decision naming
  that event, and it lifts this rule for the one edit the event named, nothing wider —
  never a close, never an AC tick;
- leave a landing as a comment instead of updating the body;
- tick or untick an AC — the boxes are the implementer's record, and a tick from the
  sweep's own reading is inference in the shared body;
- **edit a ticket Foundry is executing** — one whose Linear state is In Progress and which
  a `decisions/` file with `action: "sent"` names. The edits are computed and held, and
  reach the reader as a `directed-at-person` event carrying the diff, so they decide
  whether to interrupt the run. Their yes comes back as a `verified` decision, the next
  ingest stamps that event `confirmed: …`, and only then are those edits applied;
- **rewrite the ask itself.** A fact that may have unsaid a Scope sentence is a flag, not
  an edit: the worker quotes the sentence and the fact, and leaves the body alone;
- write to Linear from any worker other than `ticket-pass`;
- **open, cut, park or dismiss a workstream, or say where a side has really got to.**
  `new`, `split`, `dismiss` and `stage` are the user's verdicts and arrive as
  `decisions/marauder/<id>.json` from Pensieve; a stage a person set outranks what a
  landing implies until the next landing, which is exactly the judgement the sweep must
  not make for them;
- create, edit or delete a file under `decisions/` — Pensieve writes them, the sweep and
  its workers only read and commit them; a decision the sweep disagrees with is something
  it says in the terminal, not a file change;
- hand-edit `workstreams/*.json` or anything under `marauder/`. The records change through
  the verbs and the pages are rendered from them; an edit by hand is a fact with no
  provenance and the next render throws it away;
- write anything under `reports/`, `digests/` or `arcs/`. They are the archive;
- post to Slack, push git, or guess frontmatter.

Anything needing the user's judgement reaches them on the board, not in a file they have
to be told to open.

## Running it

`bun run sweep` (`claude '/loop 15m /sweep' --model claude-sonnet-5 …`) is the intended
mode; self-paced `/loop` also works. **Two model tiers, on purpose:** the loop session runs
on Sonnet because the sweep is a scheduler — a queue to read, a join already made, a
render — and every worker that writes (`log-change`, `feature-docs`, `ticket-pass`) pins
`model: "opus"` in its own spawn spec, because filing, journaling and review are judgement
calls and a weaker model files worse tickets. To raise the judgement tier, change those
spawn specs, not the loop flag. The loop only runs while a session is alive, which is fine
because the first tick after any gap backfills; if it must run with no machine awake, that
is `/schedule` (cloud cron), not a longer loop.

The general rule for what gets a subagent: a stage earns one when its input is bulky (doc
trees, diffs, ticket bodies) *and* its output is a blackboard write the sweep can re-read
afterwards — not because it is a stage. Bulky reading happens in the worker; the sweep
keeps only conclusions.
