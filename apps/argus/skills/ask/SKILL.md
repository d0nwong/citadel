---
name: ask
description: Answer a question about the argus blackboard, read-only — "tell me about point decide/lia-71-history-rollup", "about the point X, what am I deciding, what is the evidence, what do you recommend", "what does LIA-71 say / where is LIA-71", "what shipped on 2026-09-04 / yesterday", "why is X pending / on hold / ignored", "what rule covers Y / what is BR-57", "what do the docs say about the usage page", "where are we on invoice emails / what's left on entity billing". Use for any question-shaped prompt about a point, ticket, day, rule id, feature, initiative, decision or landing in this checkout, from a terminal, from Pensieve's Ask, or mid-sweep. Retrieves with `accio point` / `accio ticket` / `accio journal` / `accio find` / `accio arc` and the Linear read tools, reads the FE/BE checkouts without writing or switching anything, and answers in a fixed shape with every path cited. Also covers deciding a point — "ignore it", "send it", "do that" after a recommendation — filing a new ticket — "file this", "make a ticket for that" — and opening an arc for an initiative — "track this", "open an arc for invoice emails" — each of which is proposed for the user's confirmation, never performed.
---

# ask — answer a question about the blackboard, read-only

Question: $ARGUMENTS

You are in the argus checkout. It is a blackboard: `reports/<day>.md` is what the sweep
wants from the user, `reports/points.json` is that Needs-you section as records with stable
`<group>/<slug>` ids, `decisions/<group>/<slug>.json` is the user's Send / Ignore verdict on
a point, `digests/<day>.md` is Slack made durable, and each `<app>/features/<dir>/` holds
`journal/` (one entry per landing or decision, frontmatter is the routing) and `docs/`
(`product.md` + `arch.md`, rules as `| BR-n |` / `| MM-n |` table rows). `arcs/<slug>.md`
is the running story of one initiative over those records, written by the sweep. The
README's Layout table is the map; you do not need to rediscover it.

## Three rules for a headless session

- **Never ask for permission and never mention permissions.** There is no one to answer.
  Run the tool; if it is denied, that is an answer.
- **A denied tool is reported once, in Unknowns, and worked around — never retried in
  another spelling** (a `| head`, a redirect, the same command again). Every retrieval
  below has a fallback that needs only Read, Grep, Glob, `git log` and `git show`. Use
  those tools, not `cat` / `grep` / `ls` through Bash: where Bash is allowlisted at all
  it is by command prefix — `bun run accio …`, `git log …`, `git show …` — so a shell
  grep, and `git -C <repo> …` (it starts with `git -C`), each cost a denied turn.
- **Write nothing.** Not to this checkout, not to the product checkouts, not to Linear.
  No `git add/commit/checkout/fetch/pull/stash`, no `save_issue`, no `save_comment`, no
  file edits — even when the answer makes the next edit obvious. Say what the edit would
  be; the person asking makes it. A proposed verdict is not a write, and neither is a
  proposed ticket or a proposed arc: the tools in sections 5, 6 and 7 check one and answer
  with it, and the user's Confirm, File or Open is what writes the file or the issue.

## 1. Classify the question

| The question names | Class | First tool call |
|---|---|---|
| a `<group>/<slug>` id, or "the point about …" | point | `bun run accio point <id>` |
| `LIA-nn` | ticket | `bun run accio ticket LIA-nn`, then `mcp__linear__get_issue LIA-nn` with relations |
| a date, "today", "yesterday", "what shipped / landed" | day | `bun run accio journal <YYYY-MM-DD>`, then `reports/<day>.md` and `digests/<day>.md` |
| `BR-n` / `MM-n` | rule | Grep `^\| BR-n \|` in `*/features/*/docs/{product,arch}.md`, scoped to the feature the question is about |
| a feature, screen, field, endpoint | feature | `bun run accio "<the thing>"`, then that feature's `docs/product.md` (rules) and `docs/arch.md` (endpoints, files) |
| an initiative — "where are we on invoice emails", "what's left on entity billing" | initiative | `bun run accio arc <slug>` (section 2 for the slug), or `bun run accio arc` to find it |
| "why was X ignored / sent / verified", "what did I decide" | decision | `decisions/<group>/<slug>.json`, then `accio point <id>` for what it was about |
| none of the above | free text | Grep `-ril` the words over `reports/`, `digests/`, `*/features/**/journal`, then classify again from what matched |

A point named only by subject ("the LIA-71 history one"): Grep the subject words in
`reports/points.json`, take the `id`, then `accio point`. Group ids are `decide`,
`verify`, `confirm`, `hold`, `housekeeping`.

An initiative is a story rather than a key, so the tell is a noun phrase with no id in it
and a "where are we" / "what's left" / "how is X going" verb. When the question names a
key as well — "where are we on LIA-133" — it is a ticket question and the arc is one of
its Sources, not the retrieval. `accio arc` with no slug lists every arc there is: run it
whenever the phrase does not obviously map to one, and when none does, the question is a
feature or free-text one (section 4 says what the answer then owes).

## 2. Retrieve

`accio point` prints one markdown block: the record, its report bullet with the file and
line, the decision if any, every journal entry across every app that carries the ticket,
shares a feature, rewrites one of its rule ids, or is an open `decided` entry in the
features the ticket's entries live in (newest first), each rule id resolved to
the doc line that defines it, and each path-looking token resolved in the checkout with
its last three commits. `accio ticket` prints the open points, the journal entries with
that ticket, their rule ids, and ends with `body: mcp__linear__get_issue LIA-nn` — call
exactly that next; the ticket body lives only in Linear and argus holds no key.
`accio arc <slug>` prints the arc's frontmatter and seeds, its `## Where we are`
paragraph as the sweep last wrote it, the `Landed` rows in the file, and then re-derives
from the blackboard the journal entries and the open and decided points its seeds name,
ending with `body: mcp__linear__get_issue LIA-nn` per seeded ticket — same rule, call
those next. `accio arc` alone lists every arc, its status and the day it was last
rewritten. The slug is the point-id rule (PLAN.md, "Shared contracts", where the sweep
owns it): lowercased, runs of non-alphanumerics to one `-`, trimmed — "invoice emails" is
`invoice-emails`. None of these verbs reads a `.state/` file, so they work on any clone.

Read after retrieving, not instead of it: the journal entries the block lists (their
bodies say *why*), the rule rows it points at, the code it names. Stop when the evidence
answers the ask; a point question is one retrieval plus three to six reads, not twenty.
An arc is fewer still: its paragraph is the sweep's summary of exactly those entries, so
read only what has moved since — the rows and open points the block prints — and the
ticket bodies behind them.

**If `bun run accio` is denied** (Pensieve's Ask allows Read, Grep, Glob, `git log` and
`git show` only): Read `reports/points.json` and find the id; Read the `## Needs you`
section of `reports/<its date>.md`; Read `decisions/<id>.json` if it exists; Grep
`ticket: \[?LIA-nn` over `*/features/**/journal` and `features: \[.*<feature>` for the
feature; Grep `^\| BR-n \|` in the feature's docs; Glob `**/<basename>` in the checkout
for a path token; Read `arcs/<slug>.md` for an arc, which carries the paragraph, the
`Landed` table and the `Open` list as written (Glob `arcs/*.md` when the slug is a
guess). Same evidence, more calls — note the denial once and carry on.

## 3. Evidence from the product checkouts

Code is ground truth and the blackboard is claims about it, so a recommendation about a
landing reads the landing. The checkouts are named in the point's `repo` and the docs'
`be:` prefixes: FE `~/git/alden-portal-fe`, BE `~/git/alden-connect-portal-be`; Foundry
and Pensieve at `~/git/foundry`, `~/git/pensieve`.

- **Read at the landed ref, never the working tree.** The FE tree is shared and its branch
  changes without warning; local branches of every checkout go stale silently. FE landed
  is `origin/staging`, BE landed is `origin/dev`, the single-repo apps are `origin/main`:
  `git -C ~/git/alden-portal-fe show origin/staging:<path>` and
  `git -C <repo> log --oneline -5 origin/<ref> -- <path>`.
- **Never `fetch`, `checkout`, `pull` or `stash`.** If `origin/<ref>` looks older than a
  merge the journal names, say so in Unknowns; do not refresh it.
- **When `git -C` is denied** (Pensieve's Ask today), Read the file at the checkout path
  the `accio point` block printed — that is the working tree, on whatever branch the
  block's `Files` line names (`on liam/usage-history @ 443ddeefb, not fetched`). Use it,
  and label every fact from it with that branch and sha instead of `origin/<ref>`.
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

**My call** — two sentences: what to do, and the next concrete action (which point to
Send or Ignore and with what reason, who to ask, which entry to supersede, which ticket
to file). When a point is in play, that second sentence is the verdict in the terms
section 5's tool takes — "Ignore `decide/lia-71-history-rollup` — reason: the drill-down
is the current design" — so that "do that" maps to exactly one call. Or the exact words
"the files don't say". Never perform the action; section 5 is how a verdict reaches the
user, section 6 how a new ticket does.

**Not checked** — one line: what was not read (a denied tool, a missing checkout, a ref
older than the landing, a ticket body).

**Sources:** — one footer line of short labels separated by ` · `, one per thing read:
`journal 2026-09-04 decided-history-rolls-up` · `history-tab-content.tsx @ origin/staging`
· `reports/points.json` · `LIA-71 in Linear`. Paths and line numbers live here and only
here; the prose above names things the way a colleague would ("the 4 Sep decision",
"the History tab component").

An **initiative question** takes the same five parts, and the arc's `## Where we are` is
**The question**: the sweep wrote that paragraph over this evidence, so say what it says
and what is still open, and never rebuild the story from the journal entries the arc
already lists. What I found is what has moved since the paragraph was last rewritten —
the `Landed` rows and the open points the block printed, in the order they landed; My
call names the next open step; Sources leads with `arcs/<slug>.md`. When the initiative
has no arc, answer from `accio find` / `accio ticket` as any other question, and let My
call name the arc that would hold it — the slug, and the keys it would be seeded by —
without proposing it; section 7 is where a proposal comes from, and only when asked.

Not allowed: narrating the work ("this is enough evidence, I have what I need"), lists
of rule ids in prose (say "the seven usage rules it touches" unless rules were the
question), bullets that are paragraphs, headings beyond the five, a Recommendation
longer than the evidence. If the answer needs more than one screen, the question was
two questions — answer the first and name the second.

Worked example, for "about the point decide/lia-71-history-rollup — what am I deciding,
what is the evidence, what do you recommend":

> **The question:** on 4 Sep the team decided Usage History rolls up to one row per
> project per month, with task detail only in edit mode. What shipped is the old
> drill-down: period → project → task → subtask, tasks always visible. Regression to
> raise, or the new design?
>
> **What I found**
> - The decision entry is still marked decided; nothing has superseded it.
> - The code on staging matches the drill-down, not the rollup.
> - "Task detail only on edit" was never built. The decision itself warned this needed a real gate.
> - Five LIA-71 landings since; none claims the rollup.
>
> **My call:** raise it. Ask Sam whether the rollup was dropped. If the drill-down is now
> the plan, record that as a decision and update the seven usage rules it touches.
>
> **Not checked:** the two history hooks, and the Linear ticket for a later re-scope.
>
> Sources: journal 2026-09-04 decided-history-rolls-up · history-tab-content.tsx @ origin/staging · reports/points.json

## 5. Deciding

The verdict on a point is the user's; this section is only how it reaches them.

**When.** The user asks for it — "ignore it", "send it to Foundry" — or takes the
recommendation section 4 just gave: "do that", "yes", "go ahead". Never on your own
initiative, and never for a point the answer only mentioned in passing.

**With the tool.** In Pensieve's Ask a tool named `propose_decision` is available. Call it
once, with `{ point, action: "ignored" | "sent", reason?, repo? }` — `point` is the
`<group>/<slug>` id from the question or from the conversation's own point, `action` is
the verdict, `reason` is the My-call sentence in ≤ 140 characters and is **required for
`ignored`**, `repo` comes from the point record and is required for `sent`. One call per
verdict: if the ask carries two, propose the first and name the second.

Then one sentence, and stop: "Proposed — confirm it on the card above." That sentence is
the whole answer; the five parts in section 4 are for a question, not for a verdict. The
file lands when the user presses Confirm, so never say the point is ignored, sent, decided or
done, and never call the tool a second time to check whether it was.

If it answers `ok: false`, report its `error` in one sentence and stop. No retry, no
second spelling of the same call, no substitute action — the error is the answer, and
the user can still decide on the Points page.

**Without the tool.** In a terminal or mid-sweep no such tool exists. Say in one sentence
that the decision is made on Pensieve's Points page, or from its Ask, and stop — do not
write `decisions/<group>/<slug>.json`, do not `POST` to Foundry, and do not ask to be
allowed to. Rule 3 covers this; the verdict is not yours to record.

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

## 7. Arcs

An arc is opened by the user's click, never by a session; this section is only how a
proposal reaches them. Answering *from* an arc is sections 1, 2 and 4 — this is the other
direction, and section 5's rules hold here word for word: one call, never a second to
check, never say it happened.

**When.** The user asks for one — "track this", "open an arc for invoice emails" — or
accepts an answer whose My call named the arc that would hold a cluster: "do that", "yes".
Never on your own initiative, never for a slug `accio arc` already lists (say where that
arc is instead), and never for a single ticket: an arc is a story with more than one open
item behind it, and one ticket is what `accio ticket` already answers.

**With the tool.** In Pensieve's Argus panel a tool named `propose_arc` is available. Call
it once, with `{ slug, title, seeds: { tickets, rules, prs, features } }`: `slug` by the
section-2 rule, `title` the initiative in the words the user uses for it, and `seeds` at
least one key — `tickets` as `LIA-nn`, `rules` as `BR-n` / `MM-n`, `prs` as the journal
writes them, `features` as feature dirs. **Every seed is a key this conversation
retrieved**: a ticket `accio` or the Linear read returned, a rule id resolved to its doc
row, a PR named by a journal entry, a feature dir the manifest carries. Never a key you
did not see — a guessed seed files the wrong evidence against the arc on every tick after.
If nothing retrieved gives a seed, say that in one sentence and propose nothing.

Then one sentence, and stop: "Proposed — open it on the card above." The seed file lands
when the user presses Open and the arc itself is written by the next sweep tick, so never
say the arc exists, is open, or is tracking anything.

If it answers `ok: false`, report its `error` in one sentence and stop — section 5's rule,
unchanged. The two it has of its own are a slug already under `arcs/` or `decisions/arc/`
(the arc is already there; say where) and a seed naming no open ticket, no journal entry
and no feature dir (the key was wrong; do not respell it).

**Without the tool.** In a terminal or mid-sweep no such tool exists. Name in one sentence
the slug and the seeds you would propose, and stop — do not write `arcs/<slug>.md` or
`decisions/arc/<slug>.json`, and do not ask to be allowed to. Rule 3 covers it: the seed
file is the user's verdict and the arc file is the sweep's to write from it.

**Closing.** Closing an arc is a verdict too, and its button is on that arc's page in
Pensieve. Asked to close one, say so in one sentence; there is no tool here for it, and
the sweep never closes an arc either — one with nothing open says so in its paragraph.
