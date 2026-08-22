---
name: project-manager
description: Only for use in the nemo workspace. Load, create, and save project context for structured working sessions. Use when starting a project session, wrapping up, saving in-flight state, or creating a new project. Triggered by phrases like "load context for X", "save context", "wrap up", "end of session", "new project", or via `nemo start`.
---

# Project Manager

## Overview

Manages per-project context files to maintain continuity across sessions. Each project lives in a folder at the workspace root and contains:

- `base.md` — permanent technical context and design decisions (rarely changes)
- `context.md` — in-flight session state (updated each session)
- `todos.md` or `todos/` — open tasks (single file or multiple named files)
- `tickets.md` — Linear ticket index (if applicable)
- `api.md` — the backend endpoints this feature consumes (generated; see API Context below)

---

## Workflow

### Creating a New Project ("new project", "create project", "start a new project")

1. **Ask for a project name** — if not already provided. Use lowercase-with-hyphens format (e.g. `my-new-feature`).

2. **Ask for a brief description** — one or two sentences summarising what this project is about.

3. **Create the project folder** at `<workspace-root>/<project-name>/`.

4. **Write `base.md`** with this structure:
   ```markdown
   # <Project Name> — Technical Context

   ## Overview
   <description provided by the user. Ask questions here until a clear picture develops>
   

   ---

   ## Problem

   <leave blank — to be filled in as context develops>

   ## References
   ```

5. **Confirm** — tell the user the project was created and offer to load its context immediately (as per the Loading Context workflow below).

---

### Loading Context (`nemo start` or "load context for <project>")

Load the *diet*, not the whole folder — full docs are read on demand when the task touches them.

1. **Identify the project** — use the name provided in the prompt. If ambiguous or not provided, list available projects (folders in the workspace root that contain a `base.md`) and ask the user to pick one.

2. **Read the compact set:**
   - `context.md` (current state — small)
   - `.state/last-sync-<project>.md` (changes since last session, if it exists)
   - Active decisions: `pnpm nemo query --scope <project> --status active --type decision --json`
   - `knowledge/README.md` (one line per domain — so you know what domains exist)
   - `todos.md` / `todos/` (if exists)
   - `api.md` — **the `## Index` table only** (`sed -n '/## Index/,/^---/p' <project>/api.md`).
     The per-endpoint detail below it is read on demand, not up front.
   - `.state/last-api-sync.md` (what the backend team changed since the last sync)

   Do **NOT** read `base.md`, the `api.md` endpoint detail, or other large docs up front.
   Read specific sections when the session's task actually touches them.

3. **Present a summary:**
   ```
   Project: <name>
   Focus: <focus from context.md, or "No context saved yet">
   In Flight: <list from context.md, or none>
   Since last session: <PRs/contradictions from the sync report, or "nothing new">
   API changes: <added/removed/changed endpoints for this project, or "none">
   Open Todos: <count and brief list>
   ```
   If the sync report lists pending base.md contradictions, surface them now and offer to
   walk through the proposed diffs (`pnpm nemo query --pending-contradictions`). Apply only
   with explicit approval, then `pnpm nemo ignore <repo>#<n>` (dismiss; `unignore` restores).

4. **Ask what to work on** — "What would you like to work on today?"

---

### In-Session Recall

When the user asks "which ticket covers X", "why did we choose X", "did we already decide
this", or "is this related to <domain>" — query the index before re-reading files or guessing:

```
pnpm nemo query "<terms>" [--scope <project>] [--component <slug>] [--status active]
```

Superseded entries say so and point at their replacement — never present a superseded
decision as current. If a component matches a knowledge domain, its doc surfaces first;
read it for the curated picture.

---

### API Context (features whose backend another team owns)

Several alden-portal features are frontend-only: the backend is built and owned by another
team, and its OpenAPI spec at
<https://dev-alden-portal.uc.r.appspot.com/api-docs/> is the only contract.

`<project>/api.md` is **generated** from that spec by `accio sync`, driven by
the `api:` block in the project's `project.yaml` (tag and/or path-glob selectors). Never
hand-edit `api.md` — fix the selectors and regenerate.

```
accio sync               # fetch, diff, regenerate every api.md
accio sync --offline     # use the cached spec (no network)
accio sync --check       # report only; exits 1 if the spec moved
accio sync --project tasks
```

**Use it to answer "is this a frontend task or a backend ask?"** — the question behind
every vague "backend changes" todo. Reading `api.md` in full is expensive (up to ~9k tokens
for `tasks`) and verifying a verdict means opening calling files, so that investigation is
delegated to the **`api-surface`** skill in a subagent; see wrap-up step 6. It owns the
Exists / Partial / Missing rubric and the traps that go with it.

**Two skills, two jobs — don't swap them:**

| Question | Skill | Where it runs |
| --- | --- | --- |
| "where does the status select get its data?" | **`api-lookup`** | main thread, one command |
| "is this backend todo still open?" | **`api-surface`** | subagent, wrap-up step 6 |

In-session lookups go through `api-lookup` (`accio "<subject>"`). Never
spawn a subagent for a lookup — it is slower than answering inline.

---

### Wrapping Up ("wrap up", "save context", "end of session", "I'll pick this up tomorrow")

1. **Identify the project** — infer from the current conversation context (what project have we been discussing?). Confirm with the user if unsure.

2. **Derive state from the conversation** — do not ask the user to summarise. Pull it yourself:
   - **Focus** — what was the primary thing worked on this session?
   - **In Flight** — what was started but not finished?
   - **Blocked** — anything waiting on someone or something?
   - **Next Session** — what should be picked up first?
   - **Key Decisions** — anything non-obvious that was decided, reversed, or learned

3. **Append journal entries** — drafting is delegated; the main agent's job is editing.

   1. **Spawn a fork to draft:** use the `Agent` tool with `subagent_type: "fork"` and a
      prompt like: *"Invoke the `session-journal` skill and follow it: return draft journal
      entries for `<project>` from this session."* The fork inherits the full conversation —
      do not summarise the session into the prompt. The `session-journal` skill owns the
      entry format and the qualifies/doesn't-qualify rules; the fork returns drafts as text
      and never writes files.

   2. **Curate the returned drafts as an editor.** The parent's job is to cut, not to add:
      - Reject any entry whose rationale is already recorded in a ticket, PR, or the code —
        the ticket is the authoritative record for its own content.
      - Strip ticket numbers and ticket inventories from entry **bodies** — ids belong on the
        `evidence:` line only. If the body stops making sense without the ids, the entry is
        restating ticket content: shrink it or drop it.
      - Strip ordering, scheduling, and status detail (what's blocked on what, what lands
        first, ticket states) — Linear owns that and it goes stale.
      - Reject generalisations the user didn't actually make (a one-ticket decision written
        up as a codebase convention).
      - Zero surviving entries is a fine outcome — never journal for the sake of it.

   3. **Append the survivors** to `<project>/journal.md` (create it if missing). Never edit
      or delete existing entries. Verify components come from `project.yaml`'s vocabulary or
      a knowledge-domain slug. If a decision reverses an earlier entry, it must use
      `type: reversal` and `supersedes:` — do not rewrite the old entry; indexing derives its
      superseded status.

   **Promotion step:** if an entry is tagged with a knowledge-domain slug (see
   `knowledge/README.md`) or has clear long-tail impact beyond this project (auth, data
   model, infra patterns), offer to also update that domain doc's "Current setup" narrative
   — with the user's approval. Offer to create a new domain doc when a recurring theme has
   no home.

4. **Write `context.md`** using this structure:
   ```markdown
   ## Focus
   <one-line summary of what was worked on>

   ## In Flight
   - <item>

   ## Blocked
   - <item> (or "Nothing blocked")

   ## Next Session
   - <item>

   ## Last Updated
   <YYYY-MM-DD>
   ```

5. **Update todos** — if tasks were completed or added during the session, sync `todos.md` (or the relevant file in `todos/`).

6. **Reconcile todos against the API spec** — only for projects with an `api:` block, and
   only when the session touched backend-shaped todos or `.state/last-api-sync.md` shows
   the spec moved. Investigation is delegated; the main agent's job is curating and asking.

   1. **Spawn a subagent to investigate:** use the `Agent` tool with a prompt like:
      *"Invoke the `api-surface` skill and follow it: return verdicts for `<project>`."*
      Spawn it **fresh — not a fork.** Unlike `session-journal`, this work needs the
      project's files, not the conversation; a fork would drag the session in for nothing.
      The skill owns the rubric, the traps, and the return format, and never writes files.

   2. **Curate the verdicts as an editor.** Reject any that restate what `api.md` already
      says, or that generalise one todo's answer into a convention the user never made.
      Check that no "Missing" verdict rests on a path-name search alone.

   3. **Propose the surviving rewrites to the user and apply them with their agreement.**
      Never silently retitle a todo the user hasn't seen. Fold selector problems the
      subagent reports into the same proposal — those are `project.yaml` edits.

7. **Re-index and surface contradictions** — run `pnpm nemo index <project>`, then
   `pnpm nemo query --pending-contradictions`. If any are pending, present the proposed
   base.md diffs for approval; after applying or dismissing one, run
   `pnpm nemo ignore <repo>#<n>` (dismiss; `unignore` restores).

8. **Review skill behaviour** — reflect on any skills that were used during the session. For each one, ask: did it behave as intended, or did the user have to correct or re-prompt it to get the right outcome? Look for signals like:
   - The user rephrasing or repeating a request
   - Explicit corrections ("no, not that", "I meant X")
   - The skill missing context it should have had
   - Steps the user had to remind the skill to follow

   If friction was detected, read the relevant `SKILL.md` and propose a specific improvement — a clearer instruction, a missing step, or a better trigger description. Present it to the user and offer to apply it.

   Do **not** suggest changes for skills that worked smoothly. Only flag genuine friction points.

9. **Confirm** — tell the user what was saved and where.

---

### Auto-Prompting

Watch for natural wrap signals in the conversation:
- "that's it for today", "I'll pick this up tomorrow", "we're done", "end of session"
- A long session where significant decisions were made but no wrap-up has been triggered

When detected, proactively offer: *"Want me to save the session context before you go?"*

Do **not** prompt after every response — only when a genuine session end is implied.

---

## File Conventions

- **`journal.md`** is append-only — the durable decision log. Supersede with a new entry; never rewrite history
- **`context.md`** is always overwritten (not appended) — it reflects current state only; its Key Decisions live on in the journal
- **`base.md`** is the curated design narrative — update only deliberately, never automatically; sync flags contradictions as proposed diffs for approval
- **`api.md`** — GENERATED from the backend team's OpenAPI spec; never hand-edited. Wrong
  contents mean wrong selectors — fix `project.yaml`'s `api:` block and regenerate
- **`project.yaml`** — sync config, the component vocabulary journal entries must tag from,
  and the `api:` selectors (`tags:` / `paths:` / `exclude:`) that decide what lands in `api.md`
- **`knowledge/<slug>.md`** — cross-project domain docs; "Related changes" section is machine-appended by sync, the rest is curated
- **`todos.md`** uses `- [ ]` for open items and `- [x]` for completed ones
- If a project has a `todos/` directory, prefer updating the most relevant file within it rather than creating a new one unless the topic is clearly distinct