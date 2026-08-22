---
name: feature-docs
description: Generate or refresh the dual-tier docs (product.md + arch.md) for one or more alden-portal features, per DOC-PROTOCOL.md. Use when asked to document a feature, redo/refresh its docs, add the product tier for a feature that only has an arch doc, or bring docs up to date after FE code changed. Args = feature id(s) from the manifest, or "stale" to refresh whatever drifted.
---

# feature-docs — run the doc protocol for one feature

The protocol is `DOC-PROTOCOL.md` at the workspace root — read it first; this skill is only
the operational glue for THIS repo. Machinery: `bun run accio` (see `skills/api-lookup`).

Paths:
- manifest: `alden/alden-portal/.doc-workspace/feature-manifest.json` (feature ids, `dir`, `core_files`)
- docs: `alden/alden-portal/features/<dir>/docs/{product.md, arch.md}`
- frontend repo: `~/git/alden/alden-portal-fe` (`core_files` paths are relative to it)

## Procedure

**0. Resolve the target.** Look the feature id up in the manifest. No entry? Run
`bun run accio map` (route-derived features appear automatically; a feature with no FE
route/code — like `academy` — cannot get a facts-from-code doc yet; say so and stop).

**1. Preflight.** `bun run accio sync --offline` so the arch doc + index are current.
Add `--check` first if the backend spec may have moved (then run online).

**2. Detect staleness** (skip for first-time generation). A product doc is stale when the
FE code it was verified against moved:

```bash
cd ~/git/alden/alden-portal-fe && git diff --name-only <sha-from-last_verified>..HEAD -- <core_files...>
```

Non-empty diff → regenerate. Empty → do NOT rewrite or bump `last_verified` (protocol
Phase 4 rule). `"stale"` as the arg means: run this check across every feature whose
`status` is `done` and regenerate the drifted ones.

**3. One subagent per feature** (protocol isolation rule — never batch features into one
context). Prompt template — fill every `{…}`:

> You are executing Phase 2 of the doc protocol for ONE feature of the alden-portal app:
> **{name}** (manifest id: `{id}`).
> First read `{workspace}/DOC-PROTOCOL.md` in full — you are producing the Phase 3A
> product doc (and small curated additions to the arch doc) for this single feature.
>
> Inputs:
> - Manifest entry: id `{id}`, dir `{dir}`, entry_routes {routes}, core_files {core_files}
>   — paths relative to the FRONTEND REPO at `~/git/alden/alden-portal-fe`.
> - Generated arch doc: `{workspace}/alden/alden-portal/features/{dir}/docs/arch.md`. Its
>   `## Interfaces & Contracts` region is endpoint ground truth — any endpoint named in
>   prose MUST appear there (`accio audit` fails otherwise).
> - {If an old spec/product.md exists:} REFERENCE ONLY, drift suspected: `{spec_path}`.
>   Mine it for vocabulary/aliases/intent; every behavioral claim must be re-verified in
>   code or prefixed `UNVERIFIED:` / omitted. Capabilities it describes that the code
>   lacks go under "Out of Scope / Known Gaps" as explicit gaps.
>
> Task:
> 1. Read the feature's code under its core_files, following imports one level deep where
>    a business rule lives in a helper (role gates often in `src/lib/roles.ts`).
> 2. Write `features/{dir}/docs/product.md` using the 3A template EXACTLY (headings
>    verbatim). Frontmatter: `id: {id}`, `tier: product`, `status: active` (or `beta` if
>    the code shows a partial surface), `arch_doc: ./arch.md`, generous `aliases`,
>    `last_verified: {fe_rev}`, `last_verified_date: {today}`. Business Rules rows come
>    from code (role gates, validation, state transitions); Source = the actual file;
>    escape `|` as `\|`.
> 3. In arch.md replace ONLY the TL;DR placeholder; optionally append curated sections
>    after the regions. NEVER edit inside `<!-- accio:begin/end -->` markers.
> 4. Write your chosen aliases back to this feature's `aliases` array in the manifest
>    (touch nothing else).
>
> Report back: rule count, workflow count, UNVERIFIED items, spec-vs-code drift found.

`{fe_rev}` = the `last_verified` value in the current arch.md (branch@sha format).

**4. Verify.** After the subagent(s) return:
- `bun run accio audit` — must be clean (catches prose endpoints code doesn't back)
- `bun test scripts/accio.test.ts` — recall guard still green
- spot-read the Business Rules table: every row quotable standalone, every Source real

**5. Close out.** In the manifest set the feature's `status: "done"` and
`docs_sha: "<fe short sha>"`. Re-run `bun run accio sync --offline` (folds new aliases
into the index). Commit docs separately from code changes.

## Judgment calls that recur

- Multi-feature ownership is honest: the task-detail overlay belongs to `app-shell`
  (mounted by the authenticated layout), not `tasks`. Don't "fix" attribution in prose;
  add `core_files_extra` in the manifest if a feature should genuinely own more code.
- Thin features (few ops) get thin docs — document what IS, gaps go in Known Gaps.
  Never pad from the old spec's ambitions.
- If a real question missed during the work, add it to `scripts/accio.test.ts`.
