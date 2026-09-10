---
name: sweep
description: One idempotent pass over the whole workspace loop — marauder ingest takes in the base branches and the channel, the sweep places what attached to nothing, dispatches log-change and feature-docs per landing, runs the event-driven ticket pass, then renders the board and commits. Run via /loop 15m /sweep or on demand; every stage is state-driven and catch-up-safe, so the first run after days away backfills everything. Use when the user says "sweep", "run the sweep", "catch me up on everything", or asks to run the workspace loop.
---

# sweep — the scheduler for the workspace loop

The workspace is a blackboard: durable state lives in files — per feature, `docs/` (what is
true), `journal/` (why it changed) and `work.json` (what is going on, if anything), plus
`queue/` for what attached to nothing — reconciliation is deterministic (`marauder ingest`, `pr-facts`,
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
the arc were replaced by marauder's records and the pages rendered from them. They stay
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
`verified-landing` event on every feature it touched — the features its journal entry
names, else the ones `pr-facts` maps its files to. Then the channel since the cursor runs
down the attachment ladder over features — a thread a feature has learned, a ticket or PR
in its keys, then words only one feature claims (its learned vocabulary, or a manifest
alias of two or more words or an identifier's shape) — and becomes events wherever both
the feature and the kind are provable. A feature with nothing going on gets its
`work.json` the first time something lands on it. Everything else goes to
`queue/_unsorted.json`. No script here calls a model.

The cursor is `queue/.state.json`, and `slack-pull` advances it into
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
`{ kind, feature, summary, to, why, text, name, date, owner }`:

- `summary` is the sentence a reader sees, in `style.md`'s voice: a person does something,
  about twenty words (the page prints the date in front, inside the ceiling), a full stop
  at the end. "Foong asked you to review Sam's pages
  before the launch", never "Slackbot: review pages pushed by".
- `kind` is the event kind: `contract-change` for a thing settled, `new-ask` for work asked
  for, `directed-at-person` for an ask aimed at a person (`to`, with `you` for the reader),
  `deadline` for a date (`name`, `date`, `owner`), `chat` for anything not about the work.
- `feature` is the feature it belongs to, as its directory under `features/`
  (`admin/usage`, `tasks`), when you would bet on it, `null` when you would not. A point
  naming no feature stays in the queue with the features the ladder would look at; one
  aimed at you keeps its `to`; a date naming no feature is only a milestone.
- `chat` is small talk, and logistics that name nobody on the record — "Carlos monitors
  New York hours after launch". It is never recorded. Logistics aimed at you is an ask.
- `text` is the bullet it came from, verbatim, so the feature learns its vocabulary.

The verb validates the file and refuses it whole, naming the point, when a sentence breaks
a style rule, a feature has no directory under any app's `features/`, or a deadline lacks
its date. Reading the same notes
again replaces every point the sweep recorded before and keeps any a person placed.

**2. Place what attached to nothing.** `queue/_unsorted.json`, every entry with
`needs: "read"`. Ingest deliberately stops at what it can prove; this is the step that
reads. Each entry carries its own words, its candidates and why none of them was certain;
read it against the features — `bun run marauder board` for the ones with something going
on, `bun run accio "<the words>"` for which feature a screen or field belongs to:

- it plainly belongs to one feature →
  `bun run marauder attach <id> <feature> --auto --reason "<why, in one clause>"`. `--auto`
  records it as the sweep's own reading rather than a person's decision, which is what
  lets a wrong one be recognised later. A feature with nothing going on gets its record.
- it probably does, and you would not bet on it → `bun run marauder suggest <id> <feature>`.
  It stays in the queue carrying the guess, and one click in Pensieve settles it.
- it belongs to no feature → leave it. **Dismissing is the user's** (Autonomy).

Attaching teaches: the thread root, the tickets, the PRs and the identifiers the item used
go onto that feature's `keys`, so the next message like it attaches on its own. That is
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

- the features ingest attached it to, and the ticket the landing or those features'
  `keys.tickets` name — `bun run marauder show <feature>` is the story in one page;
- the open `decided` entry it supersedes, if any:
  `grep -rln 'status: decided' alden/alden-portal/features/*/journal/ alden/alden-portal/features/*/*/journal/ 2>/dev/null`
  (both globs — nested features like `admin/invoicing` keep their journal a level deeper).
  The landing entry must link back and flip that decision to `superseded` (log-change 2b);
- the permalink of the event that announced it, as `source:`.

log-change step 6 then drives `feature-docs` for the affected features.

**The join is smaller than it used to be.** A landing's ticket was once inferred against
every open ticket in Linear, one semantic guess per landing. Ingest has already attached
the landing to the features it touched, and the branch, the title and those features'
keys name its tickets — so the attribution is a record, not a guess. A landing
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
event on its feature, and that is where it stays. A fact the sweep verifies reaches the
docs the same way, through a journal entry, never as a second record on the feature.

**4c. Stale pass.** `bun run accio stale` — one line per feature whose docs no longer
describe the code, with why (`tiers`, `fe-core`, `be-handlers`, `journal`). Dispatch
`feature-docs` for each, **sequentially, at most three per tick**, oldest product stamp
first, skipping any feature already refreshed this tick. `tiers` is authoritative:
`accio sync` only advances an arch stamp when the feature's core files or owned endpoints
changed since the product tier was read, so a disagreement is a stale product doc, never
bookkeeping, and `accio audit` fails on it until the product tier catches up. Three per
tick is a cost cap, not a judgement: the list is state, so the remainder is picked up next
tick.

**5. (Retired.)** The coherence check went with the workstreams on 2026-09-10: a feature
cannot stop being one thing, so there is nothing to split. The number is kept so the steps
after it keep theirs.

**6. Ticket pass.** Linear is the sweep's terminal surface — the queue the user actually
reads — so this stage makes it current, through the `ticket-pass` worker (the loop's only
Linear writer, Autonomy). The work runs in **one `ticket-pass` subagent**, a bulky reader
of ticket bodies and doc trees.

Its inputs are this tick's events by feature (`bun run marauder changed --since <prev
tick ISO>`), and for each ticket the diff `bun run marauder ticket-plan` computes between
the body and the feature's events and `open_questions`. Each event's kind decides its own
action, and what needs a person comes back as a flag rather than an edit (ARG-159). The
worker's procedure, its action table and its prompt are `skills/sweep/ticket-pass.md`.

**Skip the spawn** when there is nothing for it: no feature gained an event this tick and
no feature was refreshed this tick.

Otherwise, **after dispatch has finished** (a parallel writer would trip over dispatch's
tree), spawn ONE general-purpose subagent via the Agent tool with **`model: "opus"`**
(Running it, below), using the prompt in `ticket-pass.md` with its `{…}` filled from steps
1–4. Hand it conclusions, not sources.

When it returns, re-read the record rather than trusting what it says: the worker writes
what it did back onto the features' records (`marauder ticket`, `resolved`, `held`), so
`bun run marauder changed --since <prev tick>` says what happened and the board renders it.
A flag it could not act on is already an event; one it only mentioned is lost, so anything
in its Needs-you list naming no feature goes in this tick's terminal output.

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

`render` rewrites `marauder/board.md` and today's changelog from the features' `work.json`
and nothing else. A run that changed no record writes no byte, and a
page that breaks one of `skills/sweep/style.md`'s three mechanical rules is never written —
the run exits non-zero naming the line, and that is a bug in the record or the renderer,
not something to work around.

Then commit — one commit per writer, as today, with the render's last:

```sh
git add '*/work.json' queue/ marauder/ decisions/
git commit -m "<the board's first Needs-you headline, or: quiet tick>"
mv queue/.state.next.json queue/.state.json
```

Any decision file Pensieve wrote since the last tick rides in that commit, untouched. The
cursor is promoted only once the commit has succeeded, which is what makes a crashed tick
replay rather than skip.

**Previewing a tick.** Every verb that writes takes `--dry-run`:

```sh
bun run marauder ingest --landings --slack --dry-run
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
- **the events ingest writes onto a feature's `work.json`** — a merge on a base branch, a
  message the ladder places — opening the record of a feature that had nothing going on,
  and the three readings the sweep makes of what ingest could not: `huddle` (step 1),
  `attach --auto` and `suggest` (step 2). Each is marked as the sweep's own reading, which
  is what makes a wrong one findable;
- **the ticket pass's own corrections** — `marauder ticket` writing back the key it filed,
  `pending` recording a question-to-bullet pairing, `resolved` taking an answered question
  off the record, `held` putting a withheld edit in front of the reader (ARG-159);
- filing Alden tickets from the asks a feature's events carry, and folding a tick's events
  into the tickets they name — both in `ticket-pass`, the loop's only Linear writer;
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
- **dismiss a queue entry.** `dismiss` is the user's verdict and arrives as
  `decisions/marauder/<id>.json` from Pensieve, reason and all;
- create, edit or delete a file under `decisions/` — Pensieve writes them, the sweep and
  its workers only read and commit them; a decision the sweep disagrees with is something
  it says in the terminal, not a file change;
- hand-edit a `work.json`, anything under `queue/` or anything under `marauder/`. The records change through
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
