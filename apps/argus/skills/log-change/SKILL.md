---
name: log-change
description: Record a product/technical change for alden-portal in the change journal — who asked, which Trello/Linear ticket, which features, what changes — and drive the doc update when the code has landed. Use when a decision is made, a ticket is implemented, business logic changes, or the user says "log this change / journal this / this was decided".
---

# log-change — journal a change, close the loop to the docs

The journal is the "why" layer (protocol Phase 5 — `skills/feature-docs/DOC-PROTOCOL.md`):
docs stay present-tense facts-from-code; entries own history, rationale, source, ticket.
**Never write a change's history into the docs, and never restate current behavior in an
entry** — they link, they don't merge.

Entries: `alden/alden-portal/journal/YYYY-MM-DD-<slug>.md`, format per Phase 5.

## Procedure

**1. Collect** (ask only for what's missing; don't interrogate):
- what changed / will change — before → after, in the requester's words where possible
- `source` — Slack thread, meeting, customer, or null
- `ticket` — Trello link or Linear key (`ABC-123`); null is allowed but audit nags later
- `features` — manifest ids (`alden/alden-portal/.doc-workspace/feature-manifest.json`);
  verify each id exists. `bun run accio "<words>"` finds the feature when unsure.
- `scope` — product | architecture | both

**2. Determine status** (this decides everything downstream):
- change NOT in FE code yet → `status: decided`. Write the entry. STOP — docs are not
  touched (facts-only rule). The entry is the record of intent until code lands.
- change already in FE code → `status: implemented`, write the entry, continue to step 3.

**3. Update docs when code has landed:** run the `/feature-docs` procedure for each
affected feature, passing this entry (and any other open entries for the feature) to the
doc subagent as diff context. When the agent confirms the change in code and the docs are
regenerated, flip the entry to `status: documented`.

**4. Verify:** `bun run accio audit` must be clean (it validates entry frontmatter,
feature ids, ticket format, and flags implemented entries the refresh loop missed).

## Rules that keep the journal useful

- **One change per entry.** A ticket that touches three features is still ONE entry with
  three ids in `features:` — never three copies.
- `features:` uses FLOW style (`[a, b]`) — block style breaks grep routing.
- After creation, only `status` may change. Corrections get a new entry that references
  the old one.
- Filename slug = the summary, kebab-cased, short (`2026-08-23-invoice-approve-flow.md`).
