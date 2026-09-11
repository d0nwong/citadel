# The arch doc

One `docs/arch.md` per feature is the technical spec: how the feature is built, which
endpoints it owns, where the two codebases disagree, and what is known to be missing. It
is read by a person filing a ticket, by the reader that keeps the ledger (its gap and
mismatch sections), and by `accio find`. The product side of a feature is not a document
any more: it is the requirement rows in the feature's `ledger.json`.

## Two kinds of content

`accio sync` writes the regions between `<!-- accio:begin … -->` and `<!-- accio:end … -->`
markers, from the frontend's own code and the backend's OpenAPI spec: the component map
and the interfaces. Never edit inside a region. Everything else is curated by the
feature-docs run, and the cap applies to it: **250 curated lines**, counted by
`argus validate` with the front matter, blank lines and generated regions left out.

## Front matter

```yaml
---
id: admin-usage                      # the manifest id
tier: architecture
feature_name: "Admin Usage"
aliases: [usage, "usage page", /admin/usage]
entry_routes: [/admin/usage]
core_files: [...]                    # from the manifest, relative to the FE repo
be_files: [...]                      # the handler chain the run read, relative to the BE repo
last_verified: staging@a1e4d8839     # FE: branch@shortsha of origin/staging at the run
last_verified_date: 2026-09-10
last_verified_be: dev@06d27c81       # BE: branch@shortsha of origin/dev at the run
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

## FE/BE Mismatches
| # | Surface | FE behavior (file) | BE behavior (file) | Impact | Status |
Surface is the exact endpoint key from Interfaces & Contracts. Status is
`needs-clarification`, `intended` (who said so), or `resolved` (delete the row).
```

## Rules

### Read by sha, never from a working tree
Both checkouts are shared and go stale. Resolve `origin/staging` and `origin/dev`, then
read every file with `git show <sha>:<path>` and list with `git ls-tree -r --name-only`.
Fetch, do not pull, the FE repo; the BE repo may be pulled.

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

`accio stale` names a feature when its core files differ between `last_verified` and
`origin/staging`, or its `be_files` between `last_verified_be` and `origin/dev`. A listed
feature gets a full re-verification and both stamps move to the shas read. An unlisted
feature is left alone: no rewrite, no stamp bump, without re-reading code.
