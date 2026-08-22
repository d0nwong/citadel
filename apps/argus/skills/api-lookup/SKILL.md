---
name: api-lookup
description: "Answer fast, in-session: which backend API provides the data or functionality for a given UI element, component, or feature of the alden-portal — and conversely, which component owns a given endpoint. Use whenever a question sounds like 'where does X get its data', 'what API does X call', 'what does X hit on save', 'who calls GET /api/v1/...', or 'which endpoint backs this dropdown/field/badge/page'. Answers from generated docs in one command; do NOT spawn a subagent for this."
---

# API Lookup — which API backs which component

Answer in the main thread. **Never delegate this to a subagent** — the whole job is one
command, and a subagent's spawn cost and cold context make it slower than doing it here.
(`tech-lead` is the heavier skill: architecture, specs, doc maintenance, and — in a fresh
subagent — wrap-up todo reconciliation. Do not confuse them.)

## The command

```bash
accio "<subject>"              # what backs this thing?
accio <subject> --in <feature> # scope to one feature
accio <path-or-word> --endpoints  # reverse: who calls this endpoint?
accio list                     # every mapped component
```

It reads the generated `<feature>/api.md` files and prints matching components with their
`does:` line, their files, and their endpoints — direct calls first, then indirect.

## How to query

**Name the subject, not the location.** `"task detail project"` scores the location words
("task", "detail") above the thing actually asked about, and buries the answer. Put the
location in `--in` and leave only the subject in the query:

```bash
accio project --in tasks     # ✓ answer first
accio "task detail project"  # ✗ answer ninth
```

**Widget words are free.** "select", "field", "dropdown", "badge", "button" and friends
never veto a match — the code calls it `taskPriority` whether the user says "priority
field" or "priority select". Say what the user said.

**Use the user's words.** `does:` lines are written to name user-visible things — "status
select", "capacity rail", "saved views". Query what the user said before trying slugs.

**Call sites are searchable, and a trailing `s` is optional.** `accio "projects select"`
works because `project-select.tsx` is a call site, even though no `does:` line contains the
word "select". Filenames carry the user's vocabulary — query them freely.

**But a hit that only landed via a call site is a doc bug.** It means the owning
component's `does:` line is missing a word the user actually says. Report it: the fix is
one line in `project.yaml`, and the next person asking the same question should not need
the fallback.

**One retry, then stop guessing.** If the first query misses, try the single most likely
synonym, then fall back to the escalation below. Do not fan out into many greps.

## Three layers, three kinds of answer

`accio` answers at three grains, and they mean different things. They are printed in this
order, and the first that matches wins:

**Documented** (`(documented)`) — a curated `data-flow.md` entry. This is the only layer
that can tell you how a value is passed down, what it was normalised to, and why. It names
`reads:` and `writes:` separately, so "how is it populated" and "how is it updated" are
both answered outright. When you see it, quote it — do not go re-derive it from the code.

**Components** — a curated grouping. When a component matches, its endpoints ARE the
answer: `status select` → `PUT /api/v1/tasks/{taskId}/status/{status}`.

**Symbols** (`(field · tasks)`, `(file · …)`, `(export · …)`) — derived from the code, no
curation, and they **route rather than answer**. A UI field is populated by data its parent
fetched and passed down as props, so no index can honestly name one endpoint for it. What
you get is the exact files to read and the guards found near them.

A symbol hit means **nobody has documented this yet**. Read the files it names — usually two or three — and answer
from the code. That is the intended flow, not a fallback: it turns a ten-command hunt into
one command plus two file reads.

**`reachable endpoints: N — candidates only`** on a symbol is the surrounding screen's
traffic, not proof the field uses any of them. Never present those as the answer.

## When you had to read code, write it down

If you answered from the repo because `accio` only routed you there, that answer is worth
keeping: add a section to `<feature>/data-flow.md` keyed by the symbol, with `aka:` for the
words the user actually used. Offer it — the next person asking should get the answer, not
the files. Never restate the endpoint list `api.md` already generates; `reads:`/`writes:`
exist so `accio sync` can audit the prose, and it reports drift on every run.

## Reading the output

- **direct** — the component's own contract. This is almost always the answer.
- **indirect (N hops)** — reached through the import graph, usually cache-invalidation
  fan-out from a shared module. Do not present these as "what this component calls"
  without saying so.
- **"Calls nothing"** — a real finding, not a gap. For a pure `lib/` module it confirms
  the module has no network access. If the component obviously *should* call something,
  its `files:` globs are wrong — say so rather than inventing an answer.
- **`←` call sites** — the files to open if the user wants proof. Cite one; it is usually
  the most convincing part of the answer.

## Escalation when nothing matches

The corpus is **partially mapped** — the tool prints a `⚠ not yet mapped` line naming the
features still in tags mode, which have no component attribution at all. Respect it:

1. **Target feature is in the ⚠ list** → say so plainly: the doc cannot answer yet. Then
   grep the repo (`~/git/alden/alden-portal-fe`) for the answer, and tell the user the
   feature needs mapping (see `API-DOCS-PLAN.md`).
2. **Feature is mapped but the query missed** → run `accio list` to see the real component
   names, and retry once against those.
3. **Still nothing** → grep the repo directly. If you find the endpoint, the `does:` line
   for that component is missing the user's word — that is a fixable doc bug worth
   reporting, not just a failed lookup.

**Never present a repo-grep answer as if it came from the docs**, and never let a
confident answer hide that the feature was unmapped.

## Verifying before you answer

The docs are derived and can be stale or wrong. When the answer will drive code changes,
open one call site and confirm the URL. Two known ways the docs mislead:

- A **type-only import** (`import type { GetProjectsResponse } from …`) does not cause a
  call. A component can legitimately reference a response type and call nothing.
- The spec is the **dev** deployment and can lead or lag prod.

If `accio` finds nothing and the generated docs look stale, regenerate:
`accio sync --offline`.

## Answer shape

Lead with the endpoints, split by what the user asked:

```
Reads:  GET /api/v1/projects/entity/{entityId} — Get all projects by entity
Writes: PUT /api/v1/tasks/{taskId}/status/{status} — Update task status
Owner:  task-detail-overlay (tasks) · use-task-detail-view.ts, project-select.tsx
```

If a read or write half is genuinely empty, say so — "the select fetches nothing of its
own; its options are a client-side union" is a complete answer, not a missing one.
