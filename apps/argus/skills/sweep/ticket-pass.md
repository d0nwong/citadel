# ticket-pass — the sweep's Linear worker

One subagent per sweep tick, spawned by `skills/sweep/SKILL.md` step 6 after ingest has
finished, `model: "opus"`. It is the **only** thing in the loop that writes to Linear.
Write policy is the sweep's Autonomy section; ticket shape and editing rules are the
`linear-ticket` skill. Neither changed with this rewrite — only where the work comes from.

The work now comes from workstream events. A ticket belongs to a workstream, so "which
ticket does this affect" is a choice among that workstream's one or two tickets rather
than among every open one; and the workstream's `open_questions` and `facts` are a
statement of what the work now is, so the pass diffs the ticket against them instead of
patching it message by message. `marauder ticket-plan` computes that diff, and it is a
pure function of the record and the body — the worker holds the Linear key and applies it,
because argus holds no key.

Until the rewire ticket retires the digest, the digest's own unlinked ✋ items are still an
input; dedupe on the ticket key, and a ticket the event path already filed needs no second
one.

## Prompt

Fill every `{…}`:

> You are the `ticket-pass` worker for one sweep tick of the `argus` repo (working
> directory). Execute directly; never spawn a subagent — it would recurse.
>
> Inputs:
> - The workstreams that gained an event this tick, and the events they gained:
>   `{bun run marauder changed --since {prev tick ISO}}`.
> - Unmarked, unlinked ✋ items from `digests/{date}.md`, one per line:
>   `{headline} — {detail} — {permalink}`. Still an input until the rewire.
> - Features refreshed this tick: `{ids}`.
> - Team `Liamai`; assignee = me. Linear tools are `mcp__linear__*` — ToolSearch them if
>   deferred.
>
> Read this file and the Autonomy section of `skills/sweep/SKILL.md` before starting.
> For each workstream with new events, for each ticket in its `keys.tickets`: read the
> ticket body with `get_issue`, write it to a temp file, and run
> `bun run marauder ticket-plan <slug> <LIA-nn> --body <file> --state "<its Linear state>"`.
> Apply the plan per the action table below. Then Part B — file a ticket for every
> `fileAsks` entry and for every unlinked ✋ item, per "Filing" — and Part C — review the
> tickets naming a refreshed feature, per "Reviewing".
>
> Report back two lists, verbatim lines the sweep can paste: **Needs you** (every flag the
> plan returned, every ticket held because Foundry is running it, and anything you could
> not verify) and **Done** (tickets filed with keys; bodies edited — which ticket, which
> section, what changed).

## The action table

`ticket-plan` reads each event's kind and returns the edits. The kinds are the record's
closed set, and each one does one thing:

| kind | what it does to the ticket | who decides |
| --- | --- | --- |
| `answers-question` | deletes the Pending bullet the question was paired with, and adds one sentence to Technical Notes | nobody — apply it |
| `contract-change`, `claimed-landing` | with a landing behind it, writes the fact into Technical Notes and clears its own unverified bullet; without one, adds a Pending bullet reading "announced on Slack, unverified against the base branch" | nobody — apply it |
| `verified-landing` | clears the unverified bullet its claim left | nobody — apply it |
| `new-ask` | files a ticket when the workstream has none | nobody — apply it |
| `deadline` | sets `dueDate` from the workstream's milestone, and nothing else | nobody — apply it |
| `directed-at-person` | nothing; it is already on the board under Needs you | the reader |
| `chat` | nothing; it is not recorded as an event at all | — |

Everything else the plan returns is a **flag**: a Scope sentence a fact may have unsaid, a
question nobody has paired with a bullet, a ticket Foundry is running. Flags go to Needs
you. They are never applied.

**Deleting a Pending bullet needs no approval.** The user settled that on 2026-09-09: once
the question is answered, the bullet is wrong, and a bullet annotated "Answered:" reads as
still open. Delete it and fold anything worth keeping into Technical Notes.

## Pairing a question to its bullet

`open_questions[].q` and a Pending bullet are both prose, so the first time a ticket's
question meets its bullet, you make the pairing and record it:

```sh
bun run marauder pending <slug> --question "<the first words of the question>" --bullet "<the bullet, exactly>"
```

Stored on the question as `pending_ref`, the deletion afterwards is an exact string, and no
later tick reads the same two texts again. A bullet you cannot pair stays, and the question
comes back as a flag next tick.

Once the edits are applied, take the question off the record:

```sh
bun run marauder resolved <slug> <LIA-nn> --question "<the first words>"
```

That drops the question and stamps the event that answered it with
`action: "pending deleted on LIA-nn"`, so the board and the changelog say what happened.

## Applying

One `save_issue` `patch` per ticket, with every edit in one array: a failed anchor aborts
the whole save, so a half-applied body never exists. `delete-pending` and the Technical
Notes edits are `replace` with an exact `old_string`; `due-date` is the `dueDate` field.

## Filing

A `fileAsks` entry, or an unlinked ✋ digest item carrying a real deliverable, gets a ticket:

- **Where:** the **Alden Portal** project — the project is the tag. Assignee me, the title
  prefixed `[FE]` or `[BE]` for the repo it lands in, the Slack permalink as the body's
  anchor. Draft it with the `linear-ticket` skill.
- **One ticket per ask.** Never an omnibus: one ask still waiting on a name would hold its
  siblings off the cockpit's Send button.
- **No labels at filing.** A filed ticket is a queue entry, never a dispatch.
- **Pure reply or acknowledgement pings get no ticket** — they stay in the report.
- **Write the key back**, so no later tick files it twice:

  ```sh
  bun run marauder ticket <slug> <event-id> <LIA-nn>
  ```

  For a digest item, also append ` → LIA-xx` to the end of its source line in the digest
  file, which is what the old path dedupes on.
- **Backstop before filing:** search the Alden Portal project for the item's permalink
  first. A hit means a prior tick crashed between filing and recording — write the missing
  key instead of filing twice.

## Reviewing

Skip on a tick that refreshed nothing. Otherwise re-read the open tickets naming each
refreshed feature against the fresh docs: Pending items now landed, Scope lines pointing at
files that no longer exist, line anchors that drifted. A drift re-verified against the
pinned sha is a fact and is written in. Your own reading that an acceptance criterion now
holds is *appears-satisfied* — Needs you, never a ticked box.

## A ticket Foundry is running

When the ticket's Linear state is In Progress and a `decisions/` file with
`action: "sent"` names it, `ticket-plan` marks the plan held and you **apply nothing**.
Put the diff in front of the reader instead:

```sh
bun run marauder held <slug> <LIA-nn>
```

That writes a `directed-at-person` event carrying the edits, so the board shows it under
Needs you and the reader decides whether to interrupt the run.

## Never

Unchanged from Autonomy, and worth restating because this worker is the only writer:

- never close or cancel a ticket — a landing may implement half of one;
- never tick or untick an acceptance criterion — the boxes are the implementer's record;
- never rewrite the ask itself; that is a flag;
- never a comment where a body edit belongs, never a dated "Landed …" paragraph, never a
  Slack quote. The journal owns history; the ticket is the current task.
