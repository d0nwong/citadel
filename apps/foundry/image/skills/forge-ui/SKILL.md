---
name: forge-ui
description: The design-language lens, the checks a planning or review step applies when a change touches UI (a component, a route's rendered output, a stylesheet or token file, a story): the repo's shared component over a hand-rolled one, its tokens over literals, the rules its design doc states, the accessibility floor, empty, loading and error states, and the render anti-patterns a browser is not needed to see. Use when a criterion or a diff touches UI; not a step of its own.
---

# forge-ui — on-system, not only tested

## Overview

A UI change can pass every test and still arrive off-brand: a label row hand-rolled beside the component that exists for it, a grey typed as a hex, a list with no empty state. The repo already says what on-system means — its shared components, its tokens, its design doc — and this lens is the list of questions that check a change against them. Adapted from `frontend-ui-engineering` and the anti-patterns half of `performance-optimization` in addy-agent-skills (MIT, © 2025 Addy Osmani): the design-system, accessibility and states guidance as checks against a diff, with the measure-first half left out because the forge has no browser.

## When to Use

- From a planning step, when a criterion touches UI: before slicing, so the plan builds with the inventory
- From a review step, when the diff touches UI: as one more axis

**What touches UI**: a component file; a route's rendered output; a stylesheet, theme or token file; a story; a class list.

**When NOT to use:** a diff that changes only data, hooks, queries, server code or tests behind unchanged markup. Then no line in the plan and no row in the report.

## Handoff

Reads and writes nothing of its own. The step that opened it holds the spec, the diff and the repo notes, and carries one line back into its own file in the shape under Finish. Its fixes, when a review step makes them, are the small kind and only in UI files the diff already changed; a non-UI file is never edited on this lens's account. Never a blueprint step.

## The inventory and the doc

The sources are the repo's, read at run time and in this order:

1. **The component inventory**: the `ui:list` script when `package.json` has one, run with the repo's package manager (it prints each shared component, its import path, one line on what it is for, and its stories); otherwise the shared components directory (`components/ui`, `components/fields`, `shared/ui`), read by name and by the one-line comment at the top of each
2. **The design doc**: `DESIGN.md` or the file the repo notes name — its principles, tokens, typography scale, recipes and anti-patterns table; `CLAUDE.md` where it carries UI rules
3. **The repo notes** in the system prompt: rules the owner has written down that the doc does not yet carry

A repo with no inventory script and no doc gets the checks below against its own neighbouring components, and the line carried back says `inventory: none found`.

## Shared over hand-rolled

For every element the change renders, the question is whether the inventory has a component for it. A labelled field, a dropdown, a chip, a breadcrumb, a page shell, a search box, an empty state — when the inventory or the doc's recipes cover it, the change uses that component with its props, not a `div` with the same classes. The doc's anti-patterns table, where it has one, is the list of hand-rolled shapes the repo has already rejected: a match there is a required finding that names the component to use. A component the change adds is a finding when the inventory has one for the same concept; a new shared component is a decision for the ticket, named under Assumptions, not made in passing.

## Tokens over literals

Colour, spacing, radius and type come from the repo's tokens and scale: semantic classes (`text-muted`, `bg-card`, `border-border/60`) over palette names (`text-gray-400`, `bg-white`) or hex; a spacing value on the scale, never an invented one (`p-[13px]`); a type size from the doc's table, never one between its steps; the doc's radius and shadow rules (a shadow where the doc reserves them for floating layers is a finding). Colour is never the only carrier of meaning — a status has a label or a glyph beside its colour. No purple gradients, oversized cards or stock layouts a design system did not ask for.

## The doc's own rules

Every principle and every row of the anti-patterns table is a check, applied as written: which reds are allowed, where uppercase is banned, what a page is wrapped in, which icon source features import from, what a label's colour is. A change that follows the doc where the doc is silent follows the nearest existing surface of the same kind, and the line carried back says which.

## The accessibility floor

What can be read from the markup without a browser: every interactive element is a real `button`, `a` or form control, or carries the role and keyboard handling of one; every input has a label (visible, or `aria-label`); icon-only buttons name their action; a dialog, popover or menu is the repo's primitive, which owns focus and escape; headings do not skip levels; state is not conveyed by colour alone; nothing is reachable by pointer only.

## States and rendering

- **Empty, loading, error**: a list or a fetched view renders something on purpose for none, for pending and for failure — the repo's empty-state component, its skeleton, its error toast — never a blank region or a spinner where a skeleton is the convention
- **Lists**: a list of unbounded length is paginated, virtualised or bounded, the way the repo's other lists are; every mapped element has a stable key, never the index when items reorder
- **Work in render**: an expensive derivation runs once per input (`useMemo` or a derived value outside render), not on every render; a handler is not recreated in a way that re-renders a memoised child on every parent render; a component is not memoised on suspicion
- **Layout**: an image or media element carries dimensions; a measured layout (`scrollHeight`, `getBoundingClientRect`) is not read and written in the same pass; the repo's transition and `field-sizing` conventions replace hand-rolled effects that resize elements

## Finish

One line, carried back by the step that opened the lens:

- In a plan, under Assumptions: `UI: builds with <components from the inventory>; doc rules applied: <the ones that bind here>`, or `UI: inventory: none found; follows <nearest surface>`
- In a review, under the findings: `UI: on-system — <components used>, tokens only, states covered` when every check held; otherwise the findings with labels: a hand-rolled shape the inventory covers, a literal where a token exists, a missing empty or error state, or a doc anti-pattern is required before merge and names the component or token to use; an interactive element with no keyboard path or no label is **Critical:**; a memoisation or key concern is **Nit:** unless the list is unbounded

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The shared component doesn't quite fit, a div is quicker" | The inventory lists its props and stories for this. Use it; where it truly cannot fit, that is a finding for the ticket, not a hand-rolled copy. |
| "It's just a grey, the hex is fine" | It is the token that keeps dark mode viable. The doc names the semantic class. |
| "The empty state can come later" | The first user sees a blank region. The repo's empty-state component takes one line. |
| "Accessibility can't be checked without a browser" | The markup can: roles, labels, primitives, heading levels are all in the diff. |

## Red Flags

- A `div` with the same classes as a component the inventory lists
- A hex, a palette class or a spacing value off the scale where the doc has a token
- A row of the doc's anti-patterns table matched in the diff
- A fetched list with no empty, loading or error rendering
- A UI row for a diff that touched no UI, or a fix on this lens's account in a non-UI file

## Verification

- [ ] The inventory and the doc were read before any finding, and the line names what the change builds with
- [ ] Every rendered element uses the inventory's component where one covers it, and tokens where the doc has them
- [ ] The accessibility floor, the three states and the render anti-patterns were checked from the markup
- [ ] Exactly one line carried back, none for a diff touching no UI, and no non-UI file edited
