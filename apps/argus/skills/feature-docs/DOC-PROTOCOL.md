# The arch doc

One `docs/arch.md` per feature is the technical spec: how the feature is built, the
endpoints it owns, where a two-repo area's other codebase disagrees, and what is known to
be missing. It is read by a person filing a ticket, by the reader that keeps the ledger
(its gap and mismatch sections), and by `accio find`. The product side of a feature is
not a document any more: it is the requirement rows in the feature's `ledger.json`.

## Two kinds of content

`accio sync` writes the regions between `<!-- accio:begin … -->` and `<!-- accio:end … -->`
markers, from the area's own route tree and its API spec where the project declares one:
the component map and the interfaces. Never edit inside a region. Everything else is
curated by the feature-docs run, and the cap applies to it: **250 curated lines**,
counted by `argus validate` with the front matter, blank lines and generated regions left
out.

## Front matter

```yaml
---
id: admin-usage                      # the manifest id
tier: architecture
feature_name: "Admin Usage"
aliases: [usage, "usage page", /admin/usage]
entry_routes: [/admin/usage]
# core_files: from the manifest, relative to the area's own repo
# be_files: only for a two-repo area — the handler chain the run read, relative to the
#   project's other repo
# last_verified[_date]: the area's own repo — its base branch@shortsha, and the date
# last_verified_be[_date]: only for a two-repo area — the project's other repo's own
#   base branch@shortsha, and the date
core_files: [...]
be_files: [...]
last_verified: main@a1e4d8839
last_verified_date: 2026-09-10
last_verified_be: main@06d27c81
last_verified_be_date: 2026-09-10
---
```

## Sections, in this order

```markdown
# <Feature> — Architecture

> **TL;DR:** one sentence: the shape of the implementation, route → hook → handler → store.

## Component Map
<!-- accio:begin component-map --> … <!-- accio:end component-map -->
At most ten curated rows below the region for parts the generator cannot see.

## Interfaces & Contracts
<!-- accio:begin interfaces --> … <!-- accio:end interfaces -->
Below the region: one short paragraph per endpoint whose contract is not obvious from
its shape (an idempotency key, a status the server derives, a guard broader than the UI's).
No walkthroughs of the page, no history of what landed when.

## State & Data
| Store / State | Shape (key fields) | Written by | Read by |

## Failure Modes
| Failure | Detection | Current handling |     at most ten rows

## Gaps / Tech Debt
- one bullet per gap, present tense, what is missing and where; at most fifteen

## FE/BE Mismatches — only for an area whose project has a second repo
| # | Surface | FE behavior (file) | BE behavior (file) | Impact | Status |
Surface is the exact endpoint key from Interfaces & Contracts. Status is
`needs-clarification`, `intended` (who said so), or `resolved` (delete the row). An area
whose project has one repo carries no endpoints to disagree over, so this section, and
the checks that fill it, do not apply.
```

## Rules

### Read by sha, never from a working tree
Every checkout is shared and goes stale. Resolve the area's own repo to its base
branch's current sha, and, for a two-repo area, the project's other repo to its own,
then read every file with `git show <sha>:<path>` and list with
`git ls-tree -r --name-only`. Fetch, do not pull, the area's own repo; the project's
other repo may be pulled.

### Verify the backend, bounded
For every endpoint the feature owns: router → controller → the one service or use-case
it calls, and stop. A guard, a derived status or a validation the server applies is a
mismatch row when the frontend assumes otherwise, never a silent pick of one side.

### Say what is, not what happened
No dates, ticket keys, PR numbers or "since fe#421" in prose. A landing changes the
sentence; the ledger holds the history.

### The cap is the design
Two hundred and fifty curated lines forces the doc to carry contracts and disagreements,
not a tour of the code. When something does not fit, it was a walkthrough.

## Refresh

`accio stale` names a feature when its core files differ between `last_verified` and the
area's own repo's base branch, or — for a two-repo area — its `be_files` between
`last_verified_be` and the project's other repo's base branch. A listed feature gets a
full re-verification and every stamp it carries moves to the sha read. An unlisted
feature is left alone: no rewrite, no stamp bump, without re-reading code.
