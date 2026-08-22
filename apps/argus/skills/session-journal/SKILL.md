---
name: session-journal
description: "Draft append-only journal entries for a project's journal.md from the current session's decisions. Designed to run inside a forked subagent during a project-manager wrap-up: it returns draft entries as text for the parent agent to curate and append. It never writes to journal.md itself. Not user-invoked — spawned by the project-manager skill."
---

# Session Journal — draft entries

You are drafting candidate journal entries for `<project>/journal.md` from the session context you inherited. Your output is **draft text returned to the parent agent** — do NOT write to journal.md or any other file.

## What qualifies

A journal entry needs a judgment call with a "why" — something a future session can't reconstruct by reading the code, the tickets, or `git log`. Ask "does this carry a rationale that would otherwise be lost?" before drafting one.

**What doesn't qualify:** activity/status log lines — "created ticket X", "closed Y as duplicate of Z", "ran command W". They're bookkeeping that Linear/git/the tool output already records authoritatively, and restating them only adds noise to future `nemo query` results.

**For anything arising from a ticket-creation session, check:**
- [ ] Is the rationale already written into the ticket's own description/ACs/Background?
      → If yes, **skip the entry** — the ticket is the authoritative record for its own
      content, even if the reasoning was substantive or took several turns to land on.
- [ ] Does this decision affect anything *outside* that one ticket — a pattern other,
      not-yet-written tickets must stay consistent with, a scoping call that changes what a
      *different* ticket should cover, or a codebase-wide convention?
      → If yes, draft it.
- [ ] If neither box is checked, don't draft an entry.

## Body rules

- The body is **the judgment + the why** — nothing else. The "why" matters more than the "what".
- Ticket/PR ids go on the `evidence:` line **only** — never enumerate tickets or describe their contents in the body. If removing a ticket id from the body loses meaning, the entry is restating ticket content and should shrink or die.
- No ordering, scheduling, or status information (what's blocked on what, what lands first, ticket states, dates of future work) — Linear owns that and it goes stale immediately.
- Don't record a decision made for a single ticket as a general convention unless the user actually decided the general case.
- Write for a cold future session: no "this session", "today", "we discussed".
- Link related entries with `[[entry-slug]]` where genuinely related.

## Entry format

`##` heading; components MUST come from the project's `project.yaml` vocabulary or a knowledge-domain slug (`knowledge/README.md`).

`components:` accepts two shapes and both are valid vocabulary — a bare string, or an
object whose `slug:` is the component name. Tag with the slug either way:

```yaml
components:
  - feature-boundary            # bare slug
  - slug: inline-saves          # tag with `inline-saves`, not the whole object
    does: …
    files: […]
```

```markdown
## <YYYY-MM-DD> `<short-slug>` — <one-line title>
- type: decision            # decision | reversal | learning
- status: active
- supersedes: <entry-id or —>
- components: [<slug>, …]
- evidence: <PUL-xxxx, repo#123, URLs — or —>

<statement + rationale. The "why" matters more than the "what".>
```

If a decision reverses an earlier entry, set `type: reversal` and `supersedes:` — never propose rewriting the old entry.

## Return format

Return in your final message:

1. Each draft entry in full, followed by one line: `Why journal-worthy: <what a future session would lose without it>`.
2. If nothing qualifies: `No journal-worthy decisions this session.` — this is a valid and common outcome; do not pad.
