---
name: project-manager
description: Only for use in the nemo workspace. Owns the product record — context, todos, the decision journal, and the business-logic rules doc — plus the session lifecycle. Load, create, and save project context for structured working sessions. Use when starting a project session, wrapping up, saving in-flight state, or creating a new project. Triggered by phrases like "load context for X", "save context", "wrap up", "end of session", "new project", or via `nemo start`.
---

# Project Manager

## Overview

Manages per-project context files to maintain continuity across sessions. Each project lives in a folder at the workspace root and contains:

**This skill owns the product record and the session lifecycle:**

- `context.md` — in-flight session state (updated each session)
- `todos.md` or `todos/` — open tasks (single file or multiple named files)
- `journal.md` — the append-only decision log
- `tickets.md` — Linear ticket index (if applicable)
- the product spec, where one exists
- the **rules doc** — the business-logic record: what *should* happen, independent of how
  it is built. It lives next to the code and is registered in `project.yaml`'s `rules:`
  key; see [rules-template.md](./rules-template.md)

**The `tech-lead` skill owns the technical record** — `base.md` (architecture), `api.md`
(generated endpoint surface), `data-flow.md` (curated field flows), and `project.yaml`'s
`api:` block. This skill calls into it at project creation and at wrap-up; it does not edit
those files itself.

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

5. **Point at the business logic** — ask whether a rules doc already exists in the repo
   (features often have one: `FIELD-RULES.md`, `ARCHITECTURE.md`, a fields `README.md`).
   - **It exists** → register its path in `project.yaml`'s `rules:` key. Do not copy it in.
   - **It does not** → say so plainly and offer to start one from
     [rules-template.md](./rules-template.md). Declining is fine; an unwritten rulebook is
     better than a wrong one, and the gap is now recorded.

6. **Wire up the API surface** — invoke the **`tech-lead`** skill and follow its
   "Wiring up a new project's API surface" section. It decides between a code-backed
   `sources:` block and a spec-only `tags:` block, and regenerates.

7. **Confirm** — tell the user the project was created and offer to load its context immediately (as per the Loading Context workflow below).

---

### Loading Context (`nemo start` or "load context for <project>")

Load the *diet*, not the whole folder — full docs are read on demand when the task touches them.

1. **Identify the project** — use the name provided in the prompt. If ambiguous or not provided, list available projects (folders in the workspace root that contain a `base.md`) and ask the user to pick one.

2. **Read the compact set:**
   - `context.md` (current state — small)
   - `.state/last-sync-<project>.md` (changes since last session, if it exists)
   - Active decisions — **only if the `nemo` CLI is installed** (`which nemo`):
     `pnpm nemo query --scope <project> --status active --type decision --json`.
     It is not installed in this workspace today; skip this step rather than failing, and
     read `journal.md` directly when you need past decisions.
   - `knowledge/README.md` (one line per domain — so you know what domains exist)
   - `todos.md` / `todos/` (if exists)
   - `api.md` — **headings only**: `grep -E '^## |^\*\*Mode' <project>/api.md`.
     Tags-mode files are endpoint tables; calls-mode files are component sections. Read
     the detail under a heading only when the session's task touches it.
   - `data-flow.md` — **`## ` headings only**, if the file exists. It is the curated
     record of how each field is populated; read a section when a task touches that field.
   - the **rules doc(s)** named in `project.yaml`'s `rules:` — **headings only**
     (`grep -E '^#{1,3} ' <repo>/<path>`, ~90t). Paths are relative to `repos[0].path`.
     This is the business logic; read a numbered section when the task touches that rule.
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

**API questions go to `api-lookup` / `accio`, not here.** This section is for decisions and
tickets. For "where does X get its data", see the API Context section below.

The `nemo` query below requires a CLI that is **not installed in this workspace** — check
`which nemo` first, and fall back to reading `journal.md` when it is absent.

When the user asks "which ticket covers X", "why did we choose X", "did we already decide
this", or "is this related to <domain>" — query the index before re-reading files or guessing:

```
pnpm nemo query "<terms>" [--scope <project>] [--component <slug>] [--status active]
```

Superseded entries say so and point at their replacement — never present a superseded
decision as current. If a component matches a knowledge domain, its doc surfaces first;
read it for the curated picture.

---

### API and Architecture Questions

Route these out of this skill:

| Question | Skill | Where it runs |
| --- | --- | --- |
| "where does the status select get its data?" | **`api-lookup`** | main thread, one command |
| "how should this be structured?" / spec work | **`tech-lead`** | main thread |
| "is this backend todo still open?" | **`tech-lead`** → verdicts | fresh subagent |

Never spawn a subagent for a lookup — `accio "<subject>"` answers in about a second, and a
subagent's cold context makes it slower.

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

   **If a business rule changed this session, that is a product decision** — update the
   rules doc named in `rules:`, and journal the *why* (step 3 covers the entry). A rule
   changed silently is the drift the audit exists to catch; changing it here is cheaper
   than finding it later. If the project has no rules doc, offer to start one.

6. **Maintain the technical record** — for projects with an `api:` block. Invoke the
   **`tech-lead`** skill and follow its "Maintaining the docs at wrap-up" section: it
   regenerates (`accio sync`), reads the drift report, captures anything the session
   learned into `data-flow.md`, and spawns the verdicts subagent when backend-shaped todos
   were touched.

   **Two things this skill must supply**, because tech-lead cannot derive them:
   - Which API questions this session had to answer *by reading code* — those are the
     candidates for a new `data-flow.md` entry.
   - Any decision made this session that changes whether a todo is still live. The verdicts
     subagent starts cold; without this it will classify a flow you just decided to delete
     as "Exists — close it".

7. **Re-index and surface contradictions** — **skip entirely unless `which nemo` succeeds**;
   the CLI is not installed in this workspace. When it is: run `pnpm nemo index <project>`, then
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
- **`base.md`**, **`api.md`**, **`data-flow.md`**, and `project.yaml`'s `api:` block are
  the **`tech-lead`** skill's — see its File Conventions section. Do not edit them here
- **the rules doc** (`project.yaml` `rules:`) — the business-logic record, kept next to
  the code, never copied into the workspace. This skill owns its *content*; tech-lead
  audits it against the code. Rules are cited by number, so number the sections
- **`project.yaml`** — also the component vocabulary journal entries must tag from, and
  the `rules:` paths
- **`knowledge/<slug>.md`** — cross-project domain docs; "Related changes" section is machine-appended by sync, the rest is curated
- **`todos.md`** uses `- [ ]` for open items and `- [x]` for completed ones
- If a project has a `todos/` directory, prefer updating the most relevant file within it rather than creating a new one unless the topic is clearly distinct