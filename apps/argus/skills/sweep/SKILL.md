---
name: sweep
description: One pass over the workspace loop — pull Slack and both repos' base branches into a batch, place what code can place, have the model attribute the rest and rewrite each affected feature's ledger, reconcile blockers, refresh stale arch docs, validate and commit. Run via /loop 15m /sweep or on demand; every step is state-driven and safe to repeat, so the first run after days away catches up. Use when the user says "sweep", "run the sweep", "catch me up", or asks to run the loop.
---

# sweep — one pass over the loop

## Overview

Each feature's `ledger.json` is the record. This skill keeps it current: code fetches and
joins, the model reads and judges, the validator refuses anything without evidence, and
the commit is the run's only lasting side effect. Nothing here guesses: a message nobody
can place stays unplaced for Pensieve, a claim without a pointer is refused.

## When to Use

On a schedule (`bun run sweep` is `/loop 15m /sweep`) or when asked. Never two at once.

## Process

1. **Pull.** `argus pull`. Nothing new prints "nothing new"; stop there.
2. **Place.** `argus place <batch>`. Code joins landings by files, replies by thread,
   messages by ticket key or PR. The rest goes to `state/unplaced.json`.
3. **Attribute.** Read `state/unplaced.json` with `skills/sweep/attribute.md` and the
   feature list (`argus show` for each feature's summary and open asks). For each message
   you would bet on, `argus place <id> <feature>`. Leave the rest.
4. **Read.** For each feature with a slice in `<batch>.placed.json`, one general-purpose
   subagent with `model: "opus"`, prompt = `skills/sweep/reader.md` + `skills/sweep/shapes.md`
   + `argus show <feature>` (code pointers dropped) + the slice rendered as messages and
   landings + the arch doc's gap and mismatch sections. It returns a patch; apply it with
   `argus write <feature> -` after `applyPatch`, or hand it back once with the refusal.
5. **Reconcile.** `argus reconcile`. Landing blockers clear when Bitbucket says the
   merge deployed; ticket blockers when their asks closed.
6. **Docs.** `accio stale`; for each listed feature, the `feature-docs` skill.
7. **Validate and commit.** `argus validate`, then `argus commit`. A failing feature is
   printed and left uncommitted; the rest commits. The cursor is promoted after the
   commit, so a crashed run replays rather than skips.

## Rules

### Files decide what runs
No step remembers anything. A batch is named by its pull time and is processed against
ledgers whose `as_of` is older; a second run over the same batch changes nothing.

### The model reads, code stores
Attribution and the reader are the only model calls, and only for what is new. Every
write goes through `argus`, and the validator is the policy.

### Place only what you would bet on
A wrong placement misleads every later reader of that thread. Unplaced is a state, and
Pensieve is where a person settles it.

### One feature per reader
A subagent sees one ledger and one slice. Two features in one context is how asks land
on the wrong ledger.

### Never a Linear write, never a Slack post
Tickets are proposals on the ledger; a person files them. The sweep reads Slack and
writes nothing there.

### The commit message is the first Needs-me line
Or "quiet run" when nothing changed.

## Red Flags

- A placement made to empty the unplaced list
- A reader prompt carrying two features, or the whole arch doc
- A retry of a refused patch that changes something the refusal did not name
- A hand edit to a ledger, a state file, or anything under `state/`
- A step that "remembers" the previous run in a scratch file

## Verification

- [ ] `argus validate` is clean for every feature the run touched
- [ ] `git log -1` is this run's commit and `state/cursor.json` moved after it
- [ ] Every reader call was one feature; every placement was a bet, not a tidy-up
