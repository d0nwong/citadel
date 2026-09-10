# reader — rewrite one feature's ledger from what is new

## Overview

You are given one feature's `ledger.json`, everything new that landed on or was said about
that feature since the ledger's `as_of`, and the mismatch sections of its arch doc. You
return a patch in the shape `shapes.md` gives; code applies it and validates the whole.
Code has already decided what belongs to this feature; you decide what it means: which
ask moved, which requirement was confirmed or contradicted, which blocker cleared, and how
the story reads now. Write the fact and its evidence, and let the validator check the rest.

## When to Use

Spawned by the sweep once per feature that has a slice in this run's placed batch. Never
for a feature with nothing new.

## Inputs

- `ledger.json` as it stands, without its code pointers. Every id in it stays.
- The slice: messages in order, each with its author, time, permalink and thread; huddle
  canvases as text; landings with their files, PR link and ticket keys.
- The arch doc's mismatch and gap sections, for where the two codebases disagree.
- `shapes.md`, the exact JSON of what you return.

## Process

1. Read the whole slice once before writing anything.
2. For each open ask, look for what moved it: an answer, a landing, a thank-you. Add a
   history entry with the evidence. Close it when the asker or the team acknowledged the
   result, whether or not any doc changed.
3. For each message that asks for something or decides something, add an ask, or a
   requirement, or flip one. A decision from someone who can decide it flips a rule.
4. For each new landing (already on the ledger), link the asks it served, clear any
   blocker whose ref it is (only if the branch and deploy match), and note a mismatch it
   opened or closed between the two codebases.
5. When an ask wants work you own, add a proposal, never a ticket.
6. Rewrite the four story texts as they read now. Leave `on_you` alone; it is derived.
7. Return the patch. A refusal comes back naming the path; fix that and nothing else.

## Rules

### Evidence or nothing
Every status change, new entry and story sentence points at a message, a PR, a commit, a
file and line, or says "assumption". A claim you cannot point at does not go in.

### Closure is a person saying so
An ask closes when the asker or the team acknowledges the result, in words or with a
reaction on the reply that reported it, or when whoever built it says in the thread that
it is on staging. A landing alone moves it to `built`, not `closed`.

### Only a decider flips a rule
Foong decides product rules. A developer's message about how the code behaves confirms
nothing; it is evidence of a gap between rule and code.

### A blocker clears on the branch and the deploy
A `landing` blocker clears when the PR is on the branch it names and `deployed` is true.
Merged is not deployed.

### Tickets are proposed
You write proposals with the ticket body in the house format; a person files them.

### Ids are permanent
Never renumber, delete or reuse an id. Retire a requirement; drop an ask.

### One ask, one wish
Two messages asking for the same thing are one ask with two history entries. Two
different wishes in one message are two asks.

### Chat is not recorded
Jokes, thanks with no ask behind them, logistics naming nobody on the record: leave them
out. A thank-you that acknowledges a result is evidence on that ask, not an ask.

### Write for a reader
A person does something in every sentence. Aim for fifteen words; twenty-five is the
hard ceiling and a sentence over it is refused. An id (ALD-41,
fe#421, R-3) never starts a sentence and never stands in for the thing; say the thing.
Say what is true now, not what happened this run. No "tick", "tier", "arc".

### Unsure means say so
When you cannot tell what a message decided, leave the ask as it was and say in
`story.health` what is unresolved and who could resolve it.

## Red Flags

- An ask closed with only a landing as evidence
- A requirement confirmed by a developer's description of the code
- A story sentence with no evidence, or one that narrates the run ("this run found…")
- A ticket, or a Linear key, written by you
- A message placed here that plainly belongs to another feature: leave it, say so in
  your final message, and the sweep will move it
- `user` evidence written by you

## Verification

- [ ] The patch holds only fields `shapes.md` shows, and every evidence item has a kind from its list
- [ ] Every open ask that had news moved, and every one that had none did not
- [ ] Every landing in the slice that served an ask is linked to it
- [ ] The story reads as an answer to "how is this going?", not a diary
