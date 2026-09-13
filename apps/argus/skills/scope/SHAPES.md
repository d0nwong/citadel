# Shapes

The four files of a revision, under `$D/revisions/<slug>/` while a draft and `$D/revisions/<KEY>/` once filed. `revisions/CTD-192/` in citadel-data is a complete one to read.

## `revision.json` — the verbs write it

Shown so you can read it; never edit it by hand. `argus revision new` creates it, `file` fills the key and tickets, `drop` and reconcile archive it.

```jsonc
{
  "slug": "reignite",
  "key": "CTD-201",                          // absent while a draft
  "title": "Re-ignite a settled job on its base",
  "status": "filed",                         // draft | filed | done | dropped
  "features": ["foundry/jobs"],              // <app>/<dir>
  "tickets": ["CTD-202", "CTD-203"],         // plan order
  "at": { "drafted": "…", "filed": "…", "settled": null },
  "evidence": [{ "kind": "ticket", "key": "CTD-201", "url": "…" }]
}
```

## `intent.md`

```markdown
# Intent: <what this revision does, one line>

Confirmed <date> in a /scope interview over <the argument: a ramble, KEY, or a path>.

## Outcome
<what exists afterwards; numbered when it has parts>

## User
<who benefits>

## Why now
<what changed, and what it costs to wait>

## Success
- <how we know it worked, checkable>

## Constraints
- <the binding limits, each with why>

## Out of scope
- <what is explicitly not being built, and where it goes instead>

## Sources
- <what the interview cited: a talk, a doc, a ticket, a file>
```

## `specs/<app>/<dir>.md` — one per feature

```markdown
---
feature: foundry/jobs
revised_by: reignite            # the slug until filed; then the key
next_id: 41
---
# Spec: Jobs

## Objective
<the feature in one paragraph: who it is for and what is true when it works>

## Criteria
- S-1 — <the state to set up; what must be observed> (R-3)
- S-39 — <new in this revision, from next_id>

## Out of scope
- <what this feature is not, and who owns that>

## Assumptions
- <each decision made in place of evidence, and what decided it>

## Retired
- S-20 — <its text> — retired by reignite
```

## `plan.md`

```markdown
# Plan: <KEY or slug> — <title>

Specs: `specs/foundry/jobs.md`. Verified at <repo> <branch>@<sha>.

## Tickets

1. [BE] <title> — S-39 — blocked by: none
2. [FE] <title> — S-40 — blocked by: 1

2 needs 1's endpoint; nothing here runs in parallel.

## Risks

| Risk | What catches it |
|---|---|
| <a risk you can name> | <the test, the run, or the check> |

## 1. [BE] <title>

## Summary
…
## Acceptance Criteria
- [ ] AC1 — <the spec's wording> (spec S-39)
## Technical Notes
- `<file>:<lines>` — <what it does today and what changes>. AC1.

Verified at <repo> <branch>@<sha>.

## 2. [FE] <title>
…
```

Each `## <n>. <title>` section is filed verbatim as that ticket's body, from its `## Summary` down.
