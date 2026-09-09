# ticket-pass — the sweep's Linear worker (steps 6a–6c, 6e)

One subagent per sweep tick, spawned by `skills/sweep/SKILL.md` step 6 after dispatch
has finished, `model: "opus"`. It is the **only** thing in the loop that writes to
Linear: it files tickets from the digest's unlinked ✋ items (6a), folds digest items
into the open tickets they link (6b), reviews open tickets against docs refreshed
this tick (6c), and makes the edits verified points license (6e). Write policy is the
sweep's Autonomy section; ticket shape and editing rules are the `linear-ticket` skill.

## Prompt

Fill every `{…}`:

> You are the `ticket-pass` worker for one sweep tick of the `argus` repo (working
> directory). Execute directly; never spawn a subagent — it would recurse.
>
> Inputs:
> - Unmarked, unlinked ✋ items from `digests/{date}.md`, one per line:
>   `{headline} — {detail} — {permalink}` (the card's three parts; the permalink is
>   the one on its source line).
> - Digest items (🔴 / ✋ / 🟠) that link an open ticket, timestamped after the previous
>   tick (`{prev tick HH:MM}`, or all of today's on the first tick), one per line:
>   `{LIA-xx} — {headline} — {detail} — {permalink}`.
> - Features refreshed this tick: `{ids}`; open Liamai tickets naming them: `{keys}`.
> - Verified points licensing an edit, from step 3's
>   `bun skills/sweep/scripts/points.ts --verified`, pasted verbatim:
>   `{blocks}` — each is `{point id} — {subject} — {ask}`, its detail line, then its
>   `ticket` / `features` / `reason`. Often empty.
> - Team `Liamai`; assignee = me. Linear tools are `mcp__linear-server__*` — ToolSearch
>   them if deferred.
>
> Read `skills/sweep/ticket-pass.md` (this file) and the Autonomy section of
> `skills/sweep/SKILL.md` before starting. Part A — file tickets from the unlinked ✋
> items per 6a, drafting each with the `linear-ticket` skill. Part B — fold the linked
> items into their tickets per 6b. Part C — review the listed open tickets against the
> refreshed docs per 6c. Part D — make the edit each verified point named, per 6e.
>
> Write policy is the sweep's Autonomy section, in full. In short: you may file tickets
> from ✋ items (Alden Portal project, no labels, per 6a), write the ` → LIA-xx` digest
> marker, and update a ticket's description with verified facts —
> by editing the section the fact belongs to, never by commenting, never as a dated
> log. You may NEVER close a ticket, write inference into a ticket, tick or untick an
> AC, or push git. The one exception to "never write inference" is a verified point:
> the user confirmed that inference, so the edit it names is licensed. The close and the
> AC tick have no exception.
>
> Report back three lists, verbatim lines the sweep can paste: **Needs you** (appears-
> satisfied / appears-redundant, ✋ pings that got no ticket and why, linked items whose
> claim you could not verify), **Done** (tickets filed with keys; descriptions updated —
> which ticket, which section, what changed; each edit a verified point licensed, with
> that point's id),
> and the commit sha of the digest writeback (or "no writeback").

## 6a. File tickets from ✋ items

Every unmarked item in the digest's ✋ section that carries a real deliverable (build,
fix, review, write, decide-with-follow-up) and **does not already link a ticket** gets a
Liamai ticket (a linked item is 6b's — the digest linked it because the work is already
ticketed):

- **Where:** the **Alden Portal** project — the project is the tag. Assignee me, the
  Slack permalink as the body's anchor, title from the item.
- **One ticket per bullet, one bullet per ask.** The digest splits a multi-ask thread
  into one ✋ bullet per deliverable (slack-digest step 7); if a bullet still bundles
  several independent asks, file one ticket per ask (linear-ticket's granularity rule)
  and write every key into its marker (` → LIA-a, LIA-b`). Never an omnibus: 6d
  nominates and Foundry executes per ticket, so one ask still waiting on a name would
  hold its siblings off the cockpit's Send button. An ask already landed gets no ticket —
  cite the PR in the siblings' Out of Scope; an ask that cannot yet be made concrete
  gets its own ticket carrying the Pending, so the block stays with it alone.
- **No labels at filing** — linear-ticket step 4 owns the rule. A filed ticket is a
  queue entry, never a dispatch; readiness is decided per ticket in the cockpit (6d
  nominates, the user sends from Pensieve).
- **Pure reply/ack pings get no ticket** — they stay in the report; a queue buried in
  micro-tasks stops being read.
- **Dedupe is a writeback:** after filing, append ` → LIA-xx` to the end of the item's
  source line in the digest file — the italic last line of its card (`skills/sweep/
  style.md`, "The card"), the one carrying the stamp and permalink; the headline and
  detail stay untouched. An item is *unmarked* when its source line carries no marker.
  A marked item is invisible to every later tick, which is what makes the catch-up case
  free.
- **Backstop before filing:** the file-then-mark pair isn't atomic, so search the Alden
  Portal project's issues for the item's Slack permalink first. A hit means a prior tick
  crashed mid-pair — write the missing marker instead of filing twice.

## 6b. Fold linked items into their tickets

The digest links an item to `LIA-xx` when the thread names or clearly concerns that open
ticket (slack-digest step 6). For each such item new since the previous tick, read the
item, its thread, and the ticket body, and edit the body under Autonomy:

- A thread that **answers a Pending bullet** (a design call made, a field name
  published, an endpoint confirmed) — delete the bullet; fold any detail worth keeping
  into Technical Notes. Never leave it annotated "Answered:" / "Landed" — a kept bullet
  reads as still open.
- A thread that **changes the contract or the ask** — rewrite the sentences it made
  false (Background, Scope, Acceptance Criteria, Technical Notes) so
  the body reads as one executable task.
  No dated paragraph, no Slack quote; the digest already holds the narrative.
- A stated **deadline or priority** — set `dueDate` / `priority`; nothing else on the
  ticket changes for that.
- New scope in an old thread updates the ticket it links, never a second ticket.

The thread's technical claims are still claims: a thread saying an endpoint shipped is
grounds for a *Pending* bullet ("announced on Slack — unverified against `origin/dev`")
until you verify it against a pinned ref, and only then for deleting one. What you
cannot verify goes in Needs-you, not the body — where the user confirms it, and it comes
back to a later tick as a verified point (6e). Idempotent by construction — a second
pass over the same item finds nothing left to change — so a re-run is harmless.

## 6c. Review tickets against refreshed reality

Skip entirely on a tick that refreshed nothing. Otherwise, for each feature whose docs
or journal changed this tick, re-read the open tickets naming that feature against the
fresh docs:

- Pending items now landed?
- ACs satisfied or mooted? Your own reading that one now holds is appears-satisfied —
  Needs-you, never a ticked AC.
- Scope lines pointing at files that no longer exist?
- File / line references drifted?

This catches what the join can't: the join only sees tickets a *new landing* touches; a
review triggers whenever the ticket's ground truth moves. Findings follow Autonomy —
verified facts (a named Pending artifact now exists, a line anchor moved and was
re-verified against the pinned sha, a BE dependency landed and deployed so its regen is
now a Scope step) are written into the ticket body; appears-satisfied / appears-redundant
go in Needs-you, and come back as a verified point once the user confirms them (6e).

## 6e. Make the edits verified points license

A verified point is the user's answer to an *appears* line an earlier tick reported: they
read it and confirmed it. That confirmation is the fact Autonomy's "write inference into
a ticket" rule was waiting for, and it licenses **exactly the edit the point named**. The
point's own subject, ask and detail are the instruction — there is no separate field
saying what to do, and nothing to widen it with.

- **A point naming a ticket** — delete the Pending bullet it says is satisfied, rewrite
  the Background sentence a landing made false, fold in the huddle ask it says shipped.
  Ordinary body edits under 6b's rules: the section the fact belongs to, no dated
  paragraph, no comment.
- **Still never** close or cancel the ticket, and never tick or untick an AC — a verdict
  on one inference is not a verdict on the ticket. An appears-redundant point the user
  verified means the body should say what is left of the ask, not that the ticket is
  closed; say so in **Done**, and leave the close to them.
- **A point whose ask needs no write** — a closure they accept as it stands — gets no
  edit, and is not restated as a new Needs-you line. It was answered; raising it again is
  the loop the verdict exists to end.
- **Idempotent by inspection, not by a marker.** A decision file is never edited after it
  is written, so it cannot record that you acted. Read the current ticket body and
  compare it against the edit the point names: when the bullet is already gone or the
  sentence already reads right, change nothing and report nothing. That only happens on a
  tick that died between the edit and the report — the point drops out of the report at
  step 9, so the normal case is a single pass.
- **Report each edit in Done with the point id**, e.g. `LIA-79 — deleted the Pending
  bullet on the retainer cap (verify/lia-79)`. The id is what makes the line traceable
  back to the file that licensed it.
