---
name: sweep
description: One pass over the workspace loop — pull Slack and both repos' base branches into a batch, place what code can place, have the model attribute the rest and rewrite each affected feature's ledger, reconcile blockers, refresh stale arch docs, validate and commit. Run by the stack's sweep service, one tick per SWEEP_INTERVAL, or on demand; every step is state-driven and safe to repeat, so the first run after days away catches up. Use when the user says "sweep", "run the sweep", "catch me up", or asks to run the loop.
---

# sweep — one pass over the loop

## Overview

Each feature's `ledger.json` is the record. This skill keeps it current: code fetches and
joins, the model reads and judges, the validator refuses anything without evidence, and
the commit is the run's only lasting side effect. Nothing here guesses: a message nobody
can place stays unplaced for Pensieve, a claim without a pointer is refused.

## When to Use

On a schedule (the `sweep` service runs one tick per `SWEEP_INTERVAL`; `just sweep-once` runs
one by hand) or when asked. Never two at once: the run holds a lock in the data repo's `.git`.

## Process

1. **Start.** `argus tick start`. Records which committable files are already dirty, so
   the tick's own commit later leaves someone else's uncommitted edit alone. Run by hand
   in a terminal, with no `loop.sh` around it to export the tick marker, it writes that
   marker itself — every later step in this run is still a tick.
2. **Pull.** `argus pull`. Nothing new prints "nothing new"; skip straight to step 7 —
   the tick still needs `argus commit` to close it out and clear its own records, even
   with nothing to commit. A backend deploy that finished since the last run counts as new.
3. **Place.** `argus place <batch>`. Code joins landings by files, replies by thread,
   messages by ticket key or PR. The rest goes to `state/unplaced.json`. Each backend
   landing on a ledger gets its finished `dev` pipeline. A feature whose landing finished
   deploying gets a slice for it, even with nothing else new.
4. **Attribute.** `argus prompt attribute <batch>` prints the unplaced messages with the
   feature list; answer it yourself, then `argus place <id> <feature>` for each message
   you would bet on. Leave the rest. Then `argus place <batch>` once more, so the slices
   carry what the threads just learned.
5. **Read.** For each feature with a slice in `<batch>.placed.json`, one general-purpose
   subagent with `model: "opus"` whose whole prompt is `argus prompt reader <feature>
   <batch>`. Save its reply to a file and `argus patch <feature> <file>`. A refusal names
   the path; hand it back to the subagent once with that text, then give up on it.
   **Ground.** `argus prompt ground` lists each proposal whose Technical Notes name no
   file. For each one, one general-purpose subagent with `model: "opus"` gets
   `argus prompt ground <feature> <P-n>` as its whole prompt. It reads the code and
   returns the body. Save the reply and `argus patch` it. A refusal is handed back once,
   then the proposal stays ungrounded for the next run.
6. **Reconcile.** `argus reconcile`. Backend landings still waiting are checked again.
   Landing blockers clear once their landing is live — merged on the frontend, deployed
   per Bitbucket on the backend; ticket blockers when their asks closed. An open ticket settles when
   Linear says Done (closes its asks) or Canceled (drops them), or, with no asks, when a
   landing carrying its key is live. A filed revision whose parent is Done folds into its
   features' `docs/spec.md`; Canceled archives it.
7. **Docs.** First check `$ARGUS_ROOT/.git/sweep-tick-unreachable.json`, if it exists: the
   repo ids `loop.sh`'s clone/fetch and step 2's `argus pull` could not reach this tick. Then
   `accio stale`, across every project with the `docs` job — every configured doc area,
   citadel's included, not only alden-portal's — skipping an area whose own repo id is in that
   list; for each feature the rest of the areas list, the `feature-docs` skill. A skipped
   area's docs wait for the next tick, once its repo is reachable again.
8. **Validate and commit.** `argus validate`, then `argus commit -m "<the first On-you
   line, else the first revision reconcile moved, else: quiet run>"`. A failing feature is printed and left alone; the rest commits.
   In a tick, `argus commit` prefixes that message `sweep: ` and authors it "argus sweep" itself;
   the cursor is promoted only after that commit, so a crashed run replays rather than skips.
   This is also what closes the tick: it clears step 1's start record and, when this run
   wrote it, the terminal marker — so a verb run right after commits as whoever runs it,
   not as the sweep.

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
Or "quiet run" when nothing changed. `argus commit` prefixes it `sweep: ` itself, from the tick
marker `loop.sh` sets (or, run by hand in a terminal, the marker step 1 wrote in its place);
this skill's `-m` never spells that prefix out.

### The sweep leaves someone else's uncommitted file alone
A file already dirty when step 1 ran is not this tick's to commit, even when a later step
edits it too. It stays on disk, uncommitted, for whoever left it there.

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
- [ ] `argus prompt ground` lists only proposals whose grounding was refused twice
- [ ] Step 1 ran before anything else, and step 8 (`argus commit`) ran even when step 2
      found nothing new
