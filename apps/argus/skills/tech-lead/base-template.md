# base.md — the architecture template

> Reference file for the `tech-lead` skill. `base.md` answers **how the business logic is
> implemented** — via what component, what module, what API. The rules doc says what
> *should* happen; this says how it is built.

Derived from the two that work (`tasks`, `subtasks`). Sections are optional but **ordered** —
a reader scanning headings should reach the shape before the gaps, and the gaps before the
reading order.

```markdown
# <Feature> — Technical Context

## Overview
Two or three sentences: what this feature is, and the one structural fact that explains
most of it. Not a feature list — the load-bearing idea.

## The shape, in one pass
The architecture as a reader would walk it: entry point → composition → data → writes.
Name real modules. This section is why the file exists; write it before anything else.

## Verification against current code (<YYYY-MM-DD>)
What was checked against the repo, and what held. **Date it and stamp the branch** —
this is a claim about a moment, and the next reader must know how stale it is.

## The gap: <the one thing nobody documented>
Singular and named in the heading. A gap a heading names gets closed; a gap buried in
prose does not. Omit the section if there genuinely is none.

## Dead code / prototype-only ground
Only with evidence — "zero importers repo-wide", not "looks unused".

## Test coverage
Where the tests are, where they are not, and which untested module owns the behaviour
users actually report as broken.

## Orientation: where to start reading
Three to five files in the order a newcomer should open them, each with one line on why.
The single most reused section in practice.

## References
In-repo docs (rules docs, ADRs), specs, tickets. Say which are known stale.
```

## Rules

**Name modules, not concepts.** "The form hydrates in one pass" is unactionable;
"`use-task-detail-form.ts` hydrates in one `form.reset()`" can be opened.

**Date every verification claim.** An undated "confirmed accurate" is worse than no claim —
it reads as current forever.

**Do not restate the rules doc.** If a paragraph could be confirmed by a product person
without opening a file, it is business logic and belongs in the rules doc. Cite it
(`FIELD-RULES §6`) instead of copying it.

**Do not restate `api.md` or `data-flow.md`.** Endpoints are generated; field flows are
curated next door. `base.md` is the shape that holds them together.

**Update deliberately, never automatically.** Sync flags contradictions as proposed diffs
for approval — auto-editing the curated narrative erodes trust in it permanently.
