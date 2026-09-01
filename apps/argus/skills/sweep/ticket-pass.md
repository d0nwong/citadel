# ticket-pass — the sweep's Linear worker (steps 6a–6c)

One subagent per sweep tick, spawned by `skills/sweep/SKILL.md` step 6 after dispatch
has finished, `model: "opus"`. It is the **only** thing in the loop that writes to
Linear: it files tickets from the digest's unlinked ✋ items (6a), folds digest items
into the open tickets they link (6b), and reviews open tickets against docs refreshed
this tick (6c). Write policy is the sweep's Autonomy section; ticket shape and editing
rules are the `linear-ticket` skill.

## Prompt

Fill every `{…}`:

> You are the `ticket-pass` worker for one sweep tick of the `ai-workspace` repo (working
> directory). Execute directly; never spawn a subagent — it would recurse.
>
> Inputs:
> - Unmarked, unlinked ✋ items from `digests/{date}.md`, one per line:
>   `{line text} — {permalink}`.
> - Digest items (🔴 / ✋ / 🟠) that link an open ticket, timestamped after the previous
>   tick (`{prev tick HH:MM}`, or all of today's on the first tick), one per line:
>   `{LIA-xx} — {line text} — {permalink}`.
> - Features refreshed this tick: `{ids}`; open Liamai tickets naming them: `{keys}`.
> - Team `Liamai`; assignee = me. Linear tools are `mcp__linear-server__*` — ToolSearch
>   them if deferred.
>
> Read `skills/sweep/ticket-pass.md` (this file) and the Autonomy section of
> `skills/sweep/SKILL.md` before starting. Part A — file tickets from the unlinked ✋
> items per 6a, drafting each with the `linear-ticket` skill. Part B — fold the linked
> items into their tickets per 6b. Part C — review the listed open tickets against the
> refreshed docs per 6c.
>
> Write policy is the sweep's Autonomy section, in full. In short: you may file tickets
> from ✋ items (Alden Portal project, `agent-ready` at filing time per 6a), write the
> ` → LIA-xx` digest marker, and update a ticket's description with verified facts —
> by editing the section the fact belongs to, never by commenting, never as a dated
> log. You may NEVER close a ticket, write inference into a ticket, apply `agent-ready`
> to a ticket you did not file this tick, or push git.
>
> Report back three lists, verbatim lines the sweep can paste: **Needs you** (appears-
> satisfied / appears-redundant, ✋ pings that got no ticket and why, linked items whose
> claim you could not verify), **Done** (tickets filed with keys; descriptions updated —
> which ticket, which section, what changed),
> and the commit sha of the digest writeback (or "no writeback").

## 6a. File tickets from ✋ items

Every unmarked item in the digest's ✋ section that carries a real deliverable (build,
fix, review, write, decide-with-follow-up) and **does not already link a ticket** gets a
Liamai ticket (a linked item is 6b's — the digest linked it because the work is already
ticketed):

- **Where:** the **Alden Portal** project — the project is the tag, no `digest` /
  `alden-portal` labels. Assignee me, the Slack permalink as the body's anchor, title
  from the item.
- **`agent-ready` at filing time** when the body carries no Pending section and the
  ticket has no blocked-by relation (linear-ticket's "Slack-derived alden-portal
  tickets" rule). This is the one place the sweep applies the label itself; every
  already-open ticket is nomination-only (step 6d).
- **Pure reply/ack pings get no ticket** — they stay in the report; a queue buried in
  micro-tasks stops being read.
- **Dedupe is a writeback:** after filing, append ` → LIA-xx` to the item's line in the
  digest file. A marked item is invisible to every later tick, which is what makes the
  catch-up case free.
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
  false (Background, Scope, Technical Notes) so the body reads as one executable task.
  No dated paragraph, no Slack quote; the digest already holds the narrative.
- A stated **deadline or priority** — set `dueDate` / `priority`; nothing else on the
  ticket changes for that.
- New scope in an old thread updates the ticket it links, never a second ticket.

The thread's technical claims are still claims: a thread saying an endpoint shipped is
grounds for a *Pending* bullet ("announced on Slack — unverified against `origin/dev`")
until you verify it against a pinned ref, and only then for deleting one. What you
cannot verify goes in Needs-you, not the body. Idempotent by construction — a second
pass over the same item finds nothing left to change — so a re-run is harmless.

## 6c. Review tickets against refreshed reality

Skip entirely on a tick that refreshed nothing. Otherwise, for each feature whose docs
or journal changed this tick, re-read the open tickets naming that feature against the
fresh docs:

- Pending items now landed?
- Scope bullets satisfied or mooted?
- File / line references drifted?

This catches what the join can't: the join only sees tickets a *new landing* touches; a
review triggers whenever the ticket's ground truth moves. Findings follow Autonomy —
verified facts (a named Pending artifact now exists, a line anchor moved and was
re-verified against the pinned sha, a BE dependency landed and deployed so its regen is
now a Scope step) are written into the ticket body; appears-satisfied / appears-redundant
go in Needs-you.
