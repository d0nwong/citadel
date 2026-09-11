---
name: linear-ticket
description: Draft and file a Linear issue in the house format (FORMAT.md) — Summary / Background / Scope / Acceptance Criteria / Pending / Technical Notes — for the Alden team, in the project named after the feature, assigned to the user, with the [FE] or [BE] tag in the title. Use when the user says "create a linear ticket", "file this as a ticket", "write this up for Linear", "make a ticket for <thing>", or when a ledger proposal needs a body a person can file. The reader writes proposals in this format; Pensieve's File button and `argus file` carry them to Linear.
---

# linear-ticket — a ticket in the house format

## Overview

A ticket is the current task, not its history: what changes, why the current state is
wrong, where it changes, how we know it is done, what it waits on, and the technical notes
an implementer needs. `FORMAT.md` beside this file is the exact shape. A ticket's origin is
an ask on a feature's ledger; the ledger keeps the trail, the ticket keeps the ask.

## When to Use

- The user asks for a ticket, in a terminal or from Pensieve's Ask.
- The reader writes a proposal on a ledger (it uses this format for the body).
- A proposal needs its body improved before filing.

Not for updating a ticket's status, closing one, or commenting: the body is edited in
place when a fact changes, and closing is the user's alone.

## Process

1. Name the feature and the ask. `argus show <feature>` for the ledger; the ask's text,
   history and origin thread are the Background.
2. Ground every technical note in code: `accio find "<words>"` for the files and
   endpoints, `docs/arch.md` for the contracts and mismatches, `git -C <repo> show
   origin/<branch>:<path>` at the sha the ledger names for a line range.
3. Write the six sections per `FORMAT.md`. Title under 80 characters, prefixed `[FE]` or
   `[BE]`. Pending lists what the ticket waits on, one bullet per blocker, matching the
   ask's blockers on the ledger.
4. File it, by the path you are on:
   - From Pensieve: the File button on the proposal, or `propose_ticket` from Ask.
   - From a terminal: `mcp__linear__save_issue` on team Alden, project named after the
     feature (`Admin - Usage` for `admin/usage`) when one exists, assignee the user; then
     `argus ticket <feature> <P-n> <key>` when a proposal exists, so the ledger has the key.

## Rules

### The body is the current task
Rewrite a sentence when a fact changes; never add "Decided" or "Landed" paragraphs.

### Scope names places, not formulas
Three to six lines saying what changes where. Field names, fallbacks and formulas belong
in Acceptance Criteria or Technical Notes.

### Pending is the blockers
One bullet per thing the ticket waits on, in the words of the ledger's blocker. It is
deleted, not annotated, when the wait ends.

### Every technical note points at code
A file and a function or line range at a sha, never a paraphrase of what the code does.

### Never close, never tick
Closing a ticket and ticking an acceptance box are the user's and the implementer's.

## Red Flags

- A title with no `[FE]` or `[BE]`
- A Background that narrates the thread instead of stating what is wrong now
- A technical note with no file behind it
- A ticket filed without the ledger learning its key

## Verification

- [ ] Six sections in `FORMAT.md`'s order, headings verbatim
- [ ] Every Pending bullet matches a blocker on the ask
- [ ] The ledger's ask carries the key after filing
