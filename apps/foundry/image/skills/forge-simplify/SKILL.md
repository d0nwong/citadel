---
name: forge-simplify
description: Removes the complexity a refactor ticket names, one simplification at a time, with the existing suite as the oracle and behaviour preserved exactly; writes ~/plan.md first and leaves unmade any change that would need a test to change. Use when ~/spec.md has refactor criteria (the suite unchanged, one observable per named simplification) and ~/plan.md does not exist.
---

# forge-simplify — less to hold, nothing changed

## Overview

Simplify so a reader holds fewer concepts, not so the file has fewer lines, and change nothing the code does: same output for every input, same errors, same side effects in the same order. The existing suite decides; a test that would have to change is a behaviour change, and that simplification is left unmade. Adapted from `code-simplification` in addy-agent-skills (MIT, © 2025 Addy Osmani): its five principles as a step with the ticket naming what to remove.

## When to Use

- `~/spec.md` has refactor criteria — `C1` the unchanged suite, one criterion per named simplification — and `~/plan.md` does not exist

**When NOT to use:** a feature or bug ticket (the change is the point there); code not yet understood; a performance-critical path where the simpler version is measurably slower.

## Handoff

Reads `~/spec.md` (Criteria, Commands, the base state under Assumptions) and the repo. Stops with no edits on a `## Blocked` section. Writes `~/plan.md` first, then production code in the files the spec names. Never a test file, fixture or snapshot: a test that must change to pass means behaviour changed, and the change is reverted and recorded, never the test.

## Step 1: Understand before touching

When the task carries a Context section, a `` ### `path` `` block there is that file at the base commit — read before the checkout and trusted over any line number the task itself cites — and a path the section does not carry is read from the checkout as before.

For each named simplification, before any edit: what is this code's responsibility, what calls it and what does it call, which edge and error paths exist, which tests define it, and why was it written this way (`git -C /work log --oneline -- <file>`, the comments that say why). A fence whose reason is unknown stays up: that simplification goes under `Not doing` with what was not understood. So does any named change that alters what the code returns, throws or does for some input, however the ticket words it: an acceptance criterion cannot make a behaviour change a simplification. Under `Not doing` with the input that would differ, and the Finish says so.

## Step 2: Write ~/plan.md

```markdown
# Plan: <ticket id> — <title>

## Change
<one paragraph: what is removed from which files, and why the reader holds less afterwards>

## Criteria → code
- C2 — <file, symbol: the concrete move — guard clauses for the nesting, one helper for the duplicate, the wrapper inlined>

## Order
1. <one simplification; the test files that pin the code it touches>

## Commands
<the Commands line from ~/spec.md, unchanged>

## Assumptions
- <a fence checked, and the reason found; a choice between two equally simple forms, made the neighbours' way>

## Not doing
- <a simplification noticed and left, with why — a fence not understood, a helper that names a concept, code outside the named files>
```

The moves are the usual ones, chosen to match the neighbouring code, never an outside preference: nesting past three levels becomes guard clauses; a nested ternary becomes an if chain or a lookup; boolean flag parameters become an options object; a repeated condition becomes a named predicate; five or more duplicated lines become one function; dead code, a wrapper that adds nothing, a cast on an already-inferred type go; `data`, `result`, `cfg` get names that say what they hold; a comment saying what goes, a comment saying why stays. Balance: a helper that names a concept is not inlined, two unrelated functions are not merged, and an abstraction that exists for testability is not "unnecessary".

## Step 3: One simplification at a time

Make it; run the test files the plan named for it; green means the next one. Red means that change is reverted, not the test, and the criterion goes under `Not doing` with the failing test's name and what it pins. Never batch two simplifications into one untested change.

## Step 4: The suite, then read the diff

Run test, typecheck and lint from `~/spec.md` once each. The pass count equals the base state the spec recorded, and no test file is in `git -C /work status --porcelain`. Then read the whole diff as a stranger: does the reader hold fewer concepts than before? Is anything in it inconsistent with the file's neighbours? A simplification that reads harder than the original is reverted and recorded.

## Finish

End with each simplification made, keyed to its criterion; each left unmade and why; the suite count against the base; the three commands and results; and, when the task's Context lists one, a path under `### Missing at the base commit` or `### Not included`, named with its reason rather than searched for. Every sentence is a statement; nobody answers a question.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Fewer lines is simpler" | A one-line nested ternary is not simpler than a five-line if chain. Comprehension speed, not line count. |
| "That test pins an accident, I'll fix the test" | Then the simplification changes behaviour. Leave it unmade and say which test and what it pins. |
| "The ticket asks for it, so it's in scope" | The ticket names what to remove; it cannot make a change of output a refactor. Unmade, with the input that would differ. |
| "The original author must have had a reason" | Check: git log and the comments. A reason found is a fence that stays; none found is a fence that goes. Assumed either way is a guess. |
| "While I'm here, this unrelated code too" | Outside the named files is outside the ticket. `Not doing`. |

## Red Flags

- A test file, fixture or snapshot in the diff, or a change of output for any input made because a criterion named it
- A simplification longer or harder to follow than the original, or a rename to a preference rather than a convention
- Error handling removed because it "cleans up" the code
- An empty `Not doing`

## Verification

- [ ] `~/plan.md` was written before the first edit and every named simplification is under `Criteria → code` or `Not doing`
- [ ] Suite, typecheck and lint ran once after the last edit; the pass count equals the base and no test file changed
- [ ] Every changed file is one the spec named
