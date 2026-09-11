---
name: ask
description: Answer a question about the argus ledgers, read-only — "where are we on invoicing", "what is on me", "what did Foong ask for this week", "is R-12 confirmed", "what shipped on 2026-09-04", "what does the arch doc say about the usage page". Use for any question-shaped prompt about a feature, an ask, a requirement, a ticket, a day, a landing or a rule, from a terminal, from Pensieve's Ask, or mid-sweep. Reads with `argus show`, `accio find`, the Linear read tools and the product checkouts at pinned shas, writes nothing, and answers in a fixed shape citing every path. Also covers proposing a change to the record — close an ask, confirm or contradict a requirement, place an unplaced message — and drafting a ticket, each proposed for the user's confirmation, never performed.
---

# ask — answer a question about the ledgers, read-only

Question: $ARGUMENTS

## Overview

You are in the argus checkout. Each `<app>/features/<dir>/ledger.json` is one feature's
record: the story (four answers with evidence), the requirements with their status and who
settled them, the asks with their history, the tickets with their blockers, the landings,
the proposals. `docs/arch.md` beside it is how the feature is built. `state/unplaced.json`
is what nobody could place. Nothing else is current: `reports/`, `digests/`, `arcs/` and
any `journal/` or `work.json` still on disk are history.

## When to Use

Any question about a feature, an ask, a requirement, a ticket, a day, a landing or a rule.
Not for running the sweep, filing, or editing anything: those are the sweep's and the
user's, and this skill only proposes.

## Process

1. Name the feature the question is about; `accio find "<words>"` when it names a screen
   or a field. With no feature, `argus validate --json` lists every ledger's problems and
   the home lists are the asks with `to: "you"` across all of them.
2. `argus show <feature>` and read the whole ledger before answering. For a rule, the
   requirement and its evidence; for an ask, its history; for a day, the landings and the
   history entries dated that day.
3. Only when the ledger cannot answer: the arch doc, `mcp__linear__get_issue` for a
   ticket, `git -C <repo> show origin/<branch>:<path>` at the sha a code pointer names,
   `mcp__slack__slack_read_thread` for a Slack permalink (the channel id and the ts from
   the link: `p1789096091998619` is `1789096091.998619`).
4. Answer in the shape below. Then stop.

## Rules

### Never ask for permission
There is no one to answer. Run the tool; a denied tool is reported once under Not
checked and worked around, never retried in another spelling.

### Write nothing
Not the checkout, not the product checkouts, not Linear. No git fetch, pull, checkout or
stash. A proposal is not a write: the user's click is.

### Bash is by prefix
`argus show`, `argus validate`, `accio …`, `git log`, `git show` and `git -C <repo> log|show`.
Read, Grep and Glob for everything else; never `cat`, `ls` or a shell grep.

### The ledger is the answer
A requirement's status is what the ledger says, with who and when; an ask is where its
history left it. Do not re-derive either from Slack or code when the ledger states it.

### Cite everything
Every path, command and permalink you used, on the Sources line.

### Propose, never perform
"Close that", "that rule is wrong", "that belongs to usage": call `propose_decision` once
with `{ verb, feature, id, reason }` (`close` an ask, `confirm` or `contradict` a
requirement, `place` an unplaced message). "File this": draft per the linear-ticket skill
and call `propose_ticket` once. Say the card is ready, never that it is done or filed. In a
terminal, where no tool exists, print the `argus` command the user would run.

## Answer

**The question** — one short paragraph: what was asked or expected, and what the ledger
says now.

**What I found** — three or four bullets, one plain fact each, at most twenty words, no
paths. A person does something in every sentence.

**My call** — two sentences: what to do, and the next concrete action, naming who.

**Not checked** — one line, only when something was not read.

**Sources:** — one footer line: `admin/invoicing ledger · R-12 · A-7 · arch.md · the ticket`.

## Red Flags

- An answer that narrates what you ran instead of what is true
- A status stated from Slack when the ledger has one
- "Done", "closed" or "filed" about something you only proposed
- A retry of a denied command in another spelling

## Verification

- [ ] Every fact points at a ledger entry, a doc, a ticket or a permalink on the Sources line
- [ ] Nothing was written, and nothing is described as written
