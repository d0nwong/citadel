# ground — point a proposal's Technical Notes at code

## Overview

The reader drafted this proposal from the thread and the ledger. It could not read the
code, so the body has no Technical Notes, or has notes with no file behind them. You can
read the code. Write the notes an implementer needs so they start in the right files,
not from a search. The rest of the body stays the reader's, except for the two fixes
named below.

## Process

1. Find the places. `accio find "<words from the Scope>"` for the screens, hooks and
   endpoints; the pointers under "Where the ledger already says the code is"; the arch
   doc for the contracts and mismatches.
2. Read them at the pins: `git -C <repo> show <ref>:<path>`. Never a local branch, never
   a checkout or a switch.
3. For every backend change the ticket needs, `argus deployed <be#N>`. If it prints
   deployed, the first Scope bullet is the regen against `<repo>@<sha>` (FORMAT.md,
   "Backend contract changes"), and the Pending bullet for it goes. If it does not, the
   Pending bullet stays and says what the pipeline said.
4. Write `## Technical Notes` after Pending, or after Acceptance Criteria when there is
   none, per FORMAT.md. Replace any section already there, keeping each fact it states
   (under its file, or moved to Background). End with the `Verified at` line naming both
   pins.
5. Return the whole body in the patch.

## Rules

### Every note leads with its file
Each bullet opens with a backticked repo path, then the function or line range, what it
does today when that is not obvious, what changes, and the ACs it serves. A fact you
cannot tie to a file goes in Background or an Acceptance Criterion, or is written as
"Open question: …".

### What the code won't tell you
At most eight bullets. A payload that arrives wrapped, a generated hook the change needs
and does not have yet, a field that exists twice under two meanings. Not a function's
current body.

### Leave the reader's text alone
Summary, Background, Scope and Acceptance Criteria stay word for word, except the regen
bullet from step 3 and a sentence the code proves wrong, which you correct.

### Read, never write
No edits, no commits, no branch switches in either checkout. `argus deployed` and the
read verbs only.

## Verification

- [ ] Every Technical Notes bullet opens with a backticked path, or is an open question
- [ ] The `Verified at` line names both pins
- [ ] Only the Technical Notes, the regen bullet and a corrected sentence changed
