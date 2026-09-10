---
name: ask
description: Answer a question about the argus blackboard, read-only — "where are we on the History asset editing", "what's left on entity billing", "what does ALD-6 say / where is ALD-6", "what shipped on 2026-09-04 / yesterday", "why is X waiting / parked", "what rule covers Y / what is BR-57", "what do the docs say about the usage page". Use for any question-shaped prompt about a piece of work, feature, ticket, day, rule id, decision or landing in this checkout, from a terminal, from Pensieve's Ask, or mid-sweep. Retrieves with `marauder show <feature>` / `marauder changelog` / `marauder board`, `accio find` and the Linear read tools, reads the FE/BE checkouts without writing or switching anything, and answers in a fixed shape with every path cited. Also covers correcting what the loop got wrong — "that belongs to invoicing", "ignore that", "do that" after a recommendation — and filing a new ticket — "file this", "make a ticket for that" — each of which is proposed for the user's confirmation, never performed.
---

# ask — answer a question about the blackboard, read-only

Question: $ARGUMENTS

You are in the argus checkout. It is a blackboard, and the feature is the unit: each
`<app>/features/<dir>/` holds `docs/` (`product.md` + `arch.md`, what is true — rules as
`| BR-n |` / `| MM-n |` table rows), `journal/` (one entry per landing or decision, why it
changed — frontmatter is the routing) and, when something is going on in it, `work.json`
(the keys an event attaches by, the open questions with whose move each is, and every event
in order). A feature with nothing going on has no `work.json`. `marauder/board.md` and
`marauder/changelog/<day>.md` are those records rendered for a reader, and
`marauder show <feature>` prints one feature's story. `queue/_unsorted.json` is what
attached to nothing and is waiting to be placed, and `decisions/marauder/<id>.json` is the
user's verdict on one such entry. No record keeps a stage: where a ticket is, Linear says. `reports/`, `digests/` and `arcs/` are the archive of what the loop wrote before
2026-09-09 — read them for history, never as current state. The README's Layout table is
the map; you do not need to rediscover it.

## Three rules for a headless session

- **Never ask for permission and never mention permissions.** There is no one to answer.
  Run the tool; if it is denied, that is an answer.
- **A denied tool is reported once, in Unknowns, and worked around — never retried in
  another spelling** (a `| head`, a redirect, the same command again). Every retrieval
  below has a fallback that needs only Read, Grep, Glob, `git log` and `git show`. Use
  those tools, not `cat` / `grep` / `ls` through Bash: where Bash is allowlisted at all
  it is by command prefix — `bun run marauder show …`, `bun run accio …`, `git log …`,
  `git show …` — so a shell grep, and `git -C <repo> …` (it starts with `git -C`), each
  cost a denied turn. The `marauder` verbs that write are not on that list and are not
  yours to run: section 5 is how a correction reaches the user.
- **Write nothing.** Not to this checkout, not to the product checkouts, not to Linear.
  No `git add/commit/checkout/fetch/pull/stash`, no `save_issue`, no `save_comment`, no
  file edits — even when the answer makes the next edit obvious. Say what the edit would
  be; the person asking makes it. This covers `work.json`, `queue/` and `marauder/` too: a record
  changes through a verb the sweep or a click runs, never through you. A proposed
  correction is not a write, and neither is a proposed ticket: the tools in sections 5 and
  6 check one and answer with it, and the user's Confirm or File is what writes it.

## 1. Classify the question

| The question names | Class | First tool call |
|---|---|---|
| a piece of work — "where are we on the History asset editing", "what's left on entity billing" | work | `bun run marauder show <feature>` (section 2 for the feature) |
| `ALD-nn` | ticket | Grep `ALD-nn` over `*/features/**/work.json`, `marauder show <feature>` for the one that holds it, then `mcp__linear__get_issue ALD-nn` with relations |
| a date, "today", "yesterday", "what shipped / landed" | day | `bun run marauder changelog <YYYY-MM-DD>` |
| "what needs me", "what am I blocked on", "what is Foong sitting on" | board | `bun run marauder board` — it is already grouped that way |
| `BR-n` / `MM-n` | rule | Grep `^\| BR-n \|` in `*/features/*/docs/{product,arch}.md`, scoped to the feature the question is about |
| a feature, screen, field, endpoint | feature | `bun run accio "<the thing>"`, then that feature's `docs/product.md` (rules) and `docs/arch.md` (endpoints, files) |
| "why did that land on invoicing", "what did I decide about that message" | decision | `decisions/marauder/*.json` by `id`, then `marauder show <feature>` for what it changed |
| none of the above | free text | Grep `-ril` the words over `*/features/**/work.json`, `*/features/**/journal`, then classify again from what matched |

A piece of work named the way a person says it ("the subtask rows one") belongs to a
feature: `bun run accio "<the words>"` names it, and the feature is its directory under
`features/` — `admin/usage`, `tasks`. `bun run marauder board` shows the features with
something going on this week, by the name the team uses.

A **work** question is a noun phrase with no id in it and a "where are we" / "what's
left" / "how is X going" verb. When the question names a key as well — "where are we on
ALD-16" — it is a ticket question: the feature's record is still the retrieval, and the
ticket body is the second call.

## 2. Retrieve

`marauder show <feature>` prints one feature's story: the date it points at, the open
questions with whose move each is and the ticket bullet each is paired to, and every event
in order with the evidence link that backs it. What is true of the feature is its
`docs/product.md`, not the story. `marauder board` is what needs the user, then each
feature that moved this week. `marauder changelog <day>` is one day across every feature.
All three are rendered from the features' `work.json` alone — no network, no `.state/`, no
clock — so they work on any clone and say the same thing twice.

Read after retrieving, not instead of it: the journal entries the events link (their bodies
say *why*), the rule rows the docs define, the code they name, and the ticket body via
`mcp__linear__get_issue` — the body lives only in Linear and argus holds no key. Stop when
the evidence answers the ask; a work question is one retrieval plus three to six
reads, not twenty. The page is already the summary of its own events, so read only what has
moved since the last event you can see explained.

**If `bun run marauder` is denied** (Pensieve's Ask allows Read, Grep, Glob, `git log` and
`git show`, plus the `marauder` read verbs): Read `<app>/features/<dir>/work.json` directly
— it is the record every page is rendered from, and its `events` list is the story in
order; Glob `*/features/**/work.json` for which features have one; Read
`marauder/board.md` for the same thing already written out. Grep `ticket: \[?ALD-nn` over `*/features/**/journal` and
`features: \[.*<feature>` for the feature; Grep `^\| BR-n \|` in the feature's docs; Glob
`**/<basename>` in the checkout for a path token. Same evidence, more calls — note the
denial once and carry on.

## 3. Evidence from the product checkouts

Code is ground truth and the blackboard is claims about it, so a recommendation about a
landing reads the landing. The checkouts are named in the event's `source` and the docs'
`be:` prefixes: FE `~/git/alden-portal-fe`, BE `~/git/alden-connect-portal-be`; Foundry
and Pensieve at `~/git/foundry`, `~/git/pensieve`.

- **Read at the landed ref, never the working tree.** The FE tree is shared and its branch
  changes without warning; local branches of every checkout go stale silently. FE landed
  is `origin/staging`, BE landed is `origin/dev`, the single-repo apps are `origin/main`:
  `git -C ~/git/alden-portal-fe show origin/staging:<path>` and
  `git -C <repo> log --oneline -5 origin/<ref> -- <path>`.
- **Never `fetch`, `checkout`, `pull` or `stash`.** If `origin/<ref>` looks older than a
  merge the journal names, say so in Unknowns; do not refresh it.
- **When `git -C` is denied** (Pensieve's Ask today), Read the file at its path in the
  checkout — that is the working tree, on whatever branch it happens to be on, which for
  the FE is not `origin/staging`. Use it, and label every fact from it with that branch
  instead of `origin/<ref>`.
- **Say which ref you read.** A fact from a local branch is labelled with that branch.

## 4. Answer

A person is reading this in a chat panel, not an agent. Five parts, in this order,
nothing before the first, about 130 words in all (the shape chosen on 2026-09-06
from three rendered variants — brief with bullets):

**The question** — one short paragraph: what was decided or expected, what actually is,
and the choice being asked for. Dates as "4 Sep", people by first name.

**What I found** — three or four bullets, one plain fact each, ≤ 20 words, no paths. A
fact from the report is the sweep's inference and is worded as such ("the sweep flags…");
a fact from a journal entry, a doc row, a decision file, a ticket body or `git show` is
the record. Never restate the report's judgement as if it were a fact.

**My call** — two sentences: what to do, and the next concrete action (who to ask, which
entry to supersede, which ticket to file, which queue entry belongs where). When something
the loop got wrong is in play, that second sentence is the correction in the terms section
5's tool takes — "attach `1788949866.296519` to `admin/usage` — Sam is describing the
History subtask rows" — so that "do that" maps to exactly one call. Or the
exact words "the files don't say". Never perform the action; section 5 is how a correction
reaches the user, section 6 how a new ticket does.

**Not checked** — one line: what was not read (a denied tool, a missing checkout, a ref
older than the landing, a ticket body).

**Sources:** — one footer line of short labels separated by ` · `, one per thing read:
`journal 2026-09-04 decided-history-rolls-up` · `history-tab-content.tsx @ origin/staging`
· `admin/usage/work.json` · `ALD-6 in Linear`. Paths and line numbers live here and only
here; the prose above names things the way a colleague would ("the 4 Sep decision",
"the History tab component").

A **work question** takes the same five parts, and the feature's record and docs answer
most of them already: what the product doc says the feature does, and what the question
expects of it, are **The question**; What I found is what has moved since — the last few
events in the order they happened, an open question with the ticket bullet it waits on.
Say what the record says and never rebuild the story from the journal entries its events
already link. My call names the next open step; Sources leads with the feature's
`work.json`. When the feature has nothing going on, answer from its docs, `accio find` and
the Linear read as any other question, and let My call say that nothing is moving on it.

Not allowed: narrating the work ("this is enough evidence, I have what I need"), lists
of rule ids in prose (say "the seven usage rules it touches" unless rules were the
question), bullets that are paragraphs, headings beyond the five, a Recommendation
longer than the evidence. If the answer needs more than one screen, the question was
two questions — answer the first and name the second.

Worked example, for "where are we on the History rollup — what is the evidence, what do
you recommend":

> **The question:** on 4 Sep the team decided Usage History rolls up to one row per
> project per month, with task detail only in edit mode. What shipped is the old
> drill-down: period → project → task → subtask, tasks always visible. Regression to
> raise, or the new design?
>
> **What I found**
> - The decision entry is still marked decided; nothing has superseded it.
> - The code on staging matches the drill-down, not the rollup.
> - "Task detail only on edit" was never built. The decision itself warned this needed a real gate.
> - Five ALD-6 landings since; none claims the rollup.
>
> **My call:** raise it. Ask Sam whether the rollup was dropped. If the drill-down is now
> the plan, record that as a decision and update the seven usage rules it touches.
>
> **Not checked:** the two history hooks, and the Linear ticket for a later re-scope.
>
> Sources: journal 2026-09-04 decided-history-rolls-up · history-tab-content.tsx @ origin/staging · admin/usage/work.json

## 5. Correcting

What the loop got wrong is the user's to put right; this section is only how a correction
reaches them. The whole of it is propose-then-confirm: one call, never a second to check,
and never say it happened.

**When.** The user asks for it — "that belongs to invoicing", "ignore that one", "the
front end is actually done" — or takes the recommendation section 4 just gave: "do that",
"yes", "go ahead". Never on your own initiative, and never for something the answer only
mentioned in passing.

**What can be corrected.** Two things, and they are the two verbs a person has:

- **attach** — a queue entry belongs to a feature. It also teaches: the thread, the
  tickets, the PRs and the words it used go onto that feature's keys, so the next message
  like it lands on its own. A feature with nothing going on gets its record from it. This
  is the common one.
- **dismiss** — a queue entry belongs nowhere and the reason is all that survives it, so
  the reason is required and has to say more than "noise".

Anything else — editing an event, moving one between features — is not a correction you
can propose. Say what you would change and leave it there. There is nothing to open, cut or
advance: the feature already exists, and a stage is Linear's.

**With the tool.** In Pensieve's Argus panel a tool named `propose_decision` is available.
Call it once, with `{ id, action: "attach" | "dismiss", feature?, reason }` — `id` is the
queue entry's own id from `queue/_unsorted.json` (a Slack `ts`, `fe#417`); for `attach`,
`feature` is the feature's directory (`admin/usage`) — a decision naming a `slug` is
refused; and `reason` is the My-call sentence in ≤ 140 characters, required for `dismiss` and worth
writing for every one: it is what the event keeps. One
call per correction: if the ask carries two, propose the first and name the second.

Then one sentence, and stop: "Proposed — confirm it on the card above." That sentence is
the whole answer; the five parts in section 4 are for a question, not for a correction. The
file lands when the user presses Confirm and the record changes on the next ingest, so
never say the item is attached or dismissed, and never call the tool a
second time to check whether it was.

If it answers `ok: false`, report its `error` in one sentence and stop. No retry, no second
spelling of the same call, no substitute action — the error is the answer, and the user can
still settle it on the Unsorted page.

**Without the tool.** In a terminal or mid-sweep no such tool exists, and the correction
verbs are not yours even where the shell would run them. Say in one sentence what you would
run — `marauder attach 1788949866.296519 admin/usage`, and why — and stop. Do not
run it, do not write `decisions/marauder/<id>.json`, and do not ask to be allowed to. Rule
3 covers this; the verdict is not yours to record.

**Sending a ticket to Foundry** is the same shape and the same rules: the button is on the
page beside the ticket in Pensieve, the file it writes is `decisions/send/<ticket>.json`,
and asked to send one you say which ticket and stop. The sweep never sends, and neither do
you.

## 6. Filing

A new ticket is the user's to file; this section is only how a draft reaches them.

**When.** The user asks for it — "file this", "make a ticket for that" — or accepts an
answer whose My call named a ticket as the next step: "do that", "yes, file it". Never on
your own initiative, and never for a ticket that already exists: the sweep's ticket pass
is the only editor of one, and rule 3 holds.

**With the tool.** In Pensieve's Argus panel a tool named `propose_ticket` is available.
The draft goes through `skills/linear-ticket/SKILL.md` steps 1 to 4 first — the docs
cross-check, the code grounding at a pinned sha, the destination from its `defaults.json`
— with that skill's Title rule, Alden Portal default and no-labels rule applying
unchanged; its "Inside Pensieve's Argus panel" paragraph is the create. Then call the tool
once, with `{ title, description, project }`: `title` under 80 characters, `description`
the five-section body, `project` the project name step 4 resolved. One call per ticket:
a split into sub-issues is proposed as the parent alone, and the split named in the
sentence after.

Then one sentence, and stop: "Proposed — File it on the card above." The issue exists
when the user presses File, so never say the ticket is filed, created or done, and never
call the tool a second time to check whether it was.

If it answers `ok: false`, report its `error` in one sentence and stop. No retry, no
second spelling of the same draft, and never `save_issue` in its place — the refusal is
the answer, and the draft can be filed from a terminal.

**Without the tool.** In a terminal no such tool exists and `linear-ticket` files as
usual, its steps 5 and 6. Mid-sweep the ticket pass is the only Linear writer: name the
ticket that would be filed, in one sentence, and stop.
