---
name: feature-docs
description: Generate or refresh the arch doc (docs/arch.md) for one or more features, in any configured doc area, per DOC-PROTOCOL.md, verified against that area's own repo(s) at pinned shas and kept under 250 curated lines. Use when asked to document a feature's architecture, bring its arch doc up to date after code changed, or run "stale" to refresh whatever drifted. Args = feature ids from the manifest, or "stale".
---

# feature-docs — one feature's arch doc, verified at pinned shas

## Overview

The arch doc is the technical spec behind a feature's ledger: contracts, state, failure
modes, gaps, and — for an area whose project has two repos — where they disagree.
`DOC-PROTOCOL.md` beside this file is its contract; a doc's shape follows from its area,
never named here. This skill is the run: pin the shas, spawn one subagent per feature,
check the result, stamp and commit.

## When to Use

- A feature's core files, or a second repo's handlers, changed and `accio stale` lists it.
- A feature has no arch doc, or its doc is over the cap.
- The reader or a ticket needs a contract the doc does not state.

Not for the product side: requirements live in `ledger.json`, written by the sweep and
confirmed by a person.

## Process

1. `accio sync --offline` so the generated regions and the index are current.
2. `accio stale --json --all`, and take every entry when the arg is `stale`, else just
   the named features' own entries. Each entry names its area, checkout and base branch —
   everything one feature's run needs, with no other lookup.
3. Pin every selected entry's checkout, never trusting a working tree:
   `git -C <checkout> fetch -q origin && git -C <checkout> rev-parse --short origin/<base branch>`.
   An area whose project declares a second repo pins that one too, the same way, from its
   own entry in `projects.json`.
4. One general-purpose subagent per feature, `model: "opus"`, never two features in one
   context. Its prompt: the protocol file in full, the manifest entry, every pinned sha,
   the current doc, and the rules below.
5. When it returns: `argus validate <feature>` for the cap, `accio audit` for prose that
   names an endpoint the code does not back, and — for a two-repo area — a read of the
   mismatch table.
6. `accio sync --offline` again to fold the aliases and second-repo files it wrote into
   the index, then commit the doc on its own.

## Rules

### Read by sha
`git show <sha>:<path>` and `git ls-tree -r --name-only <sha> <dir>`, from the repo
directory, with the whole `sha:path` quoted. A subagent that cannot resolve a sha stops.

### Regions are the generator's
Nothing inside `<!-- accio:begin … -->` … `<!-- accio:end … -->` is edited by hand.

### Under the cap or not written
Two hundred and fifty curated lines. A doc over it is returned to the subagent with the
count, once; the second refusal is reported, not worked around.

### Mismatches are rows, never a side taken
A guard, derived status or validation the two sides disagree on is a row with both files
named and a status. Prose never resolves it.

### Present tense, no provenance
No dates, keys or PR numbers in the body. The ledger keeps history.

### The manifest learns from the run
The subagent writes the aliases it chose and the backend files it read to the feature's
manifest entry, and nothing else there.

## Red Flags

- A doc that walks through the page section by section
- A "since …" or a ticket key in a sentence
- An endpoint in prose that is not in the interfaces region
- A stamp moved on a feature nobody re-read
- Two features documented in one subagent

## Verification

- [ ] `argus validate <feature>` reports no cap problem
- [ ] `accio audit` is clean for the feature
- [ ] Every stamp the doc carries names the sha that was read
- [ ] The doc is committed on its own
