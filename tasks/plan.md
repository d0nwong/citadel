# Plan: forge-ui, the design-language lens (CTD-171, slice 5 of CTD-65)

Ticket: CTD-171. Stacked on CTD-175 (PR #13).

## Overview

The second lens, in `forge-api`'s shape: read by `forge-plan` when a criterion touches UI
(before slicing, so the plan builds with the inventory) and by `forge-verify` when the diff
touches UI (as an axis, findings labelled like the rest). Its sources are the repo's own:
the component inventory the `ui:list` script prints, the design doc (`DESIGN.md`), and the
repo notes. It checks design-system adherence (shared component over hand-rolled, tokens
over literals, the doc's rules), the accessibility floor, empty/loading/error states, and
the render anti-patterns that need no browser (unbounded lists, missing keys, work in
render, layout thrash). Not a blueprint step: the ticket's Background supersedes its Scope
line on that, as the lens pattern did for `forge-api`.

## Architecture decisions

- **Chosen from the diff.** "Touches UI" is defined once in the lens: a component, a
  route's rendered output, a stylesheet or token file, a story.
- **The inventory is the repo's, read at run time.** `ui:list` when `package.json` has it;
  otherwise the shared components directory. A repo with neither gets the doc-only checks
  and a line saying the inventory was not found.
- **Fixes stay in UI files.** The lens's fixes in verify are the small kind (a shared
  component swapped in for a hand-rolled one, a token for a literal), only in the files the
  diff already touched, never a non-UI file (AC3).

## Task list

- T1: `forge-ui` skill (lens anatomy, ~1,100 words).
- T2: `forge-plan` Step 1 reads it for a UI criterion (replacing the bare `ui:list` line);
  `forge-verify` Step 3 gains the UI axis alongside API.
- T3: the ticket's gathered rules into alden-portal-fe's repo notes (where DESIGN.md
  does not already carry them); README paragraph.
- T4: `foundry build`; prove on one Spec → QA job on an alden UI ticket with criteria.
