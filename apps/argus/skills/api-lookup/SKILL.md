---
name: api-lookup
description: Answer "which backend API backs this UI element / feature?" for alden-portal. Use whenever a question names a UI thing (a select, field, badge, screen, workflow) and needs the endpoint(s) behind it, or names an endpoint and needs its owner. Also covers keeping the API docs honest (sync, audit) and growing coverage by writing answers back.
---

# api-lookup — which API backs which component

One command, from this workspace root:

```bash
bun run accio "<what you are looking for>"     # what backs this thing?
bun run accio <subject> --in <feature>         # scope: the PLACE goes in --in, not the query
bun run accio <endpoint-fragment> --endpoints  # reverse: which feature calls this?
bun run accio list                             # features; add --in <id> for its components
```

Name the SUBJECT, not the location: `accio project --in tasks` beats
`accio "task detail project"` — location words outrank the thing asked about.

## Reading the answer

Layers, most-curated first; the first confident layer is the answer:

- **curated** — a manifest component grouping; its endpoints ARE the answer.
- **screen text** — the query matched words visible on screen (labels, headings). If the
  file has its own calls, those are the answer. Otherwise it says CANDIDATES.
- **symbols** — the code's own vocabulary. This layer ROUTES: it names files to read and
  labels reachable endpoints as candidates. Candidates are the surrounding screen's
  traffic, NOT proof — open the files before claiming an endpoint.
- **endpoints** — reverse/fallthrough match against the spec.

Trust rules: `(method inferred)` means only the path literal was found — verify the verb
before writing it anywhere. A "Fan-out beyond this feature's contract" line is shared-client
traffic, not the feature's own API.

## The write-back loop (how coverage grows)

If the derived layers made you OPEN CODE to answer confidently, write what you learned
back — that is how the next question gets answered in one call:

1. Edit `alden/alden-portal/.doc-workspace/feature-manifest.json` on that feature:
   - add the words the question used to `aliases`
   - for a nameable UI thing, add to `components`:
     `{ "slug": "status-controls", "does": "the status badge/select on task rows — the dropdown you change status from", "files": ["src/…"], "aliases": ["status select"] }`
     `does:` must name the USER-VISIBLE thing in the asker's words, not internals.
   - a feature dir the routes never import goes in `core_files_extra` (never edit
     `core_files` — machine-owned, `accio map` rewrites it)
2. `bun run accio sync --offline` — regenerates docs + index from the edit.
3. If the question was asked in words that missed, add the case to
   `scripts/accio.test.ts` — recall degrades silently.

Prose about HOW a value flows (normalisation, prop-drilling, the why) belongs in the arch
doc `alden/alden-portal/features/<feature>/docs/arch.md` — OUTSIDE the
`<!-- accio:begin/end -->` regions (machine-owned, regenerated). `accio audit` checks every
endpoint your prose names against spec + code, so name endpoints exactly.

## Maintenance

```bash
bun run accio sync             # refetch spec, reanalyze frontend, regen docs; reports spec diff
bun run accio sync --offline   # same, cached spec (no network)
bun run accio sync --check     # exit 1 if the backend spec drifted — report only
bun run accio map              # refresh feature manifest after route changes (curation survives)
bun run accio audit            # exit 1 if any doc claims what code/spec no longer back
```

The analysis is branch-dependent — `last_verified` in each doc names the frontend
revision it was derived from. Regenerate after switching branches in the FE repo.
