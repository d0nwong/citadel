---
name: ask
description: Answer a question about the argus blackboard, read-only — "tell me about point decide/lia-71-history-rollup", "about the point X, what am I deciding, what is the evidence, what do you recommend", "what does LIA-71 say / where is LIA-71", "what shipped on 2026-09-04 / yesterday", "why is X pending / on hold / ignored", "what rule covers Y / what is BR-57", "what do the docs say about the usage page". Use for any question-shaped prompt about a point, ticket, day, rule id, feature, decision or landing in this checkout, from a terminal, from Pensieve's Ask, or mid-sweep. Retrieves with `accio point` / `accio ticket` / `accio journal` / `accio find` and the Linear read tools, reads the FE/BE checkouts without writing or switching anything, and answers in a fixed shape with every path cited. Also covers deciding a point — "ignore it", "send it", "do that" after a recommendation — which is proposed for the user's confirmation, never performed.
---

# ask — answer a question about the blackboard, read-only

Question: $ARGUMENTS

You are in the argus checkout. It is a blackboard: `reports/<day>.md` is what the sweep
wants from the user, `reports/points.json` is that Needs-you section as records with stable
`<group>/<slug>` ids, `decisions/<group>/<slug>.json` is the user's Send / Ignore verdict on
a point, `digests/<day>.md` is Slack made durable, and each `<app>/features/<dir>/` holds
`journal/` (one entry per landing or decision, frontmatter is the routing) and `docs/`
(`product.md` + `arch.md`, rules as `| BR-n |` / `| MM-n |` table rows). The README's
Layout table is the map; you do not need to rediscover it.

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
  be; the person asking makes it. A proposal is not a write: the tool in section 5 checks
  a verdict and answers with it, and the user's Confirm is what writes the file.

## 1. Classify the question

| The question names | Class | First tool call |
|---|---|---|
| a `<group>/<slug>` id, or "the point about …" | point | `bun run accio point <id>` |
| `LIA-nn` | ticket | `bun run accio ticket LIA-nn`, then `mcp__linear__get_issue LIA-nn` with relations |
| a date, "today", "yesterday", "what shipped / landed" | day | `bun run accio journal <YYYY-MM-DD>`, then `reports/<day>.md` and `digests/<day>.md` |
| `BR-n` / `MM-n` | rule | Grep `^\| BR-n \|` in `*/features/*/docs/{product,arch}.md`, scoped to the feature the question is about |
| a feature, screen, field, endpoint | feature | `bun run accio "<the thing>"`, then that feature's `docs/product.md` (rules) and `docs/arch.md` (endpoints, files) |
| "why was X ignored / sent", "what did I decide" | decision | `decisions/<group>/<slug>.json`, then `accio point <id>` for what it was about |
| none of the above | free text | Grep `-ril` the words over `reports/`, `digests/`, `*/features/**/journal`, then classify again from what matched |

A point named only by subject ("the LIA-71 history one"): Grep the subject words in
`reports/points.json`, take the `id`, then `accio point`. Group ids are `decide`,
`verify`, `confirm`, `hold`, `housekeeping`.

## 2. Retrieve

`accio point` prints one markdown block: the record, its report bullet with the file and
line, the decision if any, every journal entry across every app that carries the ticket,
shares a feature, rewrites one of its rule ids, or is an open `decided` entry in the
features the ticket's entries live in (newest first), each rule id resolved to
the doc line that defines it, and each path-looking token resolved in the checkout with
its last three commits. `accio ticket` prints the open points, the journal entries with
that ticket, their rule ids, and ends with `body: mcp__linear__get_issue LIA-nn` — call
exactly that next; the ticket body lives only in Linear and argus holds no key. Both verbs
read no `.state/` file, so they work on any clone.

Read after retrieving, not instead of it: the journal entries the block lists (their
bodies say *why*), the rule rows it points at, the code it names. Stop when the evidence
answers the ask; a point question is one retrieval plus three to six reads, not twenty.

**If `bun run accio` is denied** (Pensieve's Ask allows Read, Grep, Glob, `git log` and
`git show` only): Read `reports/points.json` and find the id; Read the `## Needs you`
section of `reports/<its date>.md`; Read `decisions/<id>.json` if it exists; Grep
`ticket: \[?LIA-nn` over `*/features/**/journal` and `features: \[.*<feature>` for the
feature; Grep `^\| BR-n \|` in the feature's docs; Glob `**/<basename>` in the checkout
for a path token. Same evidence, more calls — note the denial once and carry on.

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
Send or Ignore and with what reason, who to ask, which entry to supersede). When a point
is in play, that second sentence is the verdict in the terms section 5's tool takes —
"Ignore `decide/lia-71-history-rollup` — reason: the drill-down is the current design" —
so that "do that" maps to exactly one call. Or the exact words "the files don't say".
Never perform the action; section 5 is how a verdict reaches the user.

**Not checked** — one line: what was not read (a denied tool, a missing checkout, a ref
older than the landing, a ticket body).

**Sources:** — one footer line of short labels separated by ` · `, one per thing read:
`journal 2026-09-04 decided-history-rolls-up` · `history-tab-content.tsx @ origin/staging`
· `reports/points.json` · `LIA-71 in Linear`. Paths and line numbers live here and only
here; the prose above names things the way a colleague would ("the 4 Sep decision",
"the History tab component").

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
