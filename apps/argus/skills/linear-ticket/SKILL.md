---
name: linear-ticket
description: Draft and file a Linear issue in the house format — Summary / Background / Scope / Technical Notes — with the Technical Notes grounded in real files, functions and line ranges. Use when the user says "create a linear ticket", "file this as a ticket", "write this up for Linear", "make a ticket for <thing>", or hands over a design/Slack thread that should become an issue.
---

# linear-ticket — turn an ask into a filed Linear issue

The value of a ticket from this skill is the **Technical Notes**: whoever picks it up
should be able to open the named files and start. Everything else is scaffolding.

Format spec + worked example: `FORMAT.md` (read it before drafting).
Tools: the Linear MCP (`.mcp.json`, project scope). Tool names are `mcp__linear__*` —
`create_issue`, `list_teams`, `list_projects`, `list_issue_labels`, `list_issue_statuses`,
`list_users`, `update_issue`, `create_comment`. If they aren't loaded, fetch schemas with
`ToolSearch("+linear")`. If the server is unauthenticated, tell the user to run `/mcp`
and pick `linear` → Authenticate; don't try to work around it.

## Procedure

**1. Take the ask.** Whatever the user gives you — a sentence, a design note, a Slack
paste — is the raw material. Ask at most one round of questions, and only for things you
cannot find out yourself (which team, what's deliberately out of scope, who owns the
backend half). Never interrogate for detail you could read out of the code.

**2. Ground it in code.** This is the step that earns the ticket.
- `bun run accio "<the UI thing>"` (see `skills/api-lookup/SKILL.md`) finds the feature and
  the files behind a named UI element; `bun run accio list` names the features.
- Read the actual files. Every file path, function name, line range, prop, type and schema
  field in Technical Notes must come from a read, not from memory.
- FE code lives in `~/git/alden/alden-portal-fe`, a **shared working tree whose branch
  switches without warning** — pin to a sha and read via `git show <sha>:<path>`. Record
  nothing you read from an unpinned working tree.
- Anything you could not verify becomes an explicit open question in Technical Notes
  ("confirm with backend whether …"), never a confident claim.

**3. Resolve the destination.** `list_teams` → team; `list_projects`, `list_issue_labels`
for the rest. Reuse `defaults.json` beside this skill if present (`{"teamId":…,
"teamKey":…, "projectId":…, "labelIds":[…]}`); if it's absent or the team is ambiguous,
ask once and write the answer there so the next run is silent. Leave status, assignee,
estimate and cycle alone unless the user names them.

**4. Draft, then show it.** Write the full issue per `FORMAT.md` to
`<scratchpad>/linear-<slug>.md` and print the title + body in the reply. Filing is
outward-facing: get an explicit go-ahead before creating, unless the user already said
"file it" / "just create it".

**5. Create.** `create_issue` with `title`, `teamId`, `description` (the markdown body),
plus project/labels if resolved. Report back the issue key and URL, nothing else.

**6. Close the loop.** If the change is an alden-portal product/behavior decision, offer
`/log-change` with the new key as `ticket` — the journal entry and the ticket are separate
records and the journal wants the key.

## Rules

- **Four sections, in order, always: Summary, Background, Scope / Out of Scope, Technical
  Notes.** No acceptance criteria, no estimates, no "Testing" section unless asked — the
  format's silence is deliberate.
- **Title**: imperative, ≤ 80 chars, names the surface and the change
  ("Support multiple assignees in task and subtask assignee displays"). No ticket-speak
  prefixes, no `[FE]` tags.
- **Summary** is what changes, per surface, in 2–4 present-tense sentences. **Background**
  is why it's needed and what's broken today. If a sentence could sit in either, it's
  Background.
- **In scope** bullets read `Surface — element: change`. **Out of scope** bullets name the
  things a reader would otherwise assume are included, with the owner where known
  ("handled separately", "tracked in ABC-123").
- **One ticket, one change.** A thing that spans three surfaces is still one ticket with
  three in-scope bullets — not three tickets.
- Line numbers age fast: cite them only for a range you actually read, and prefer
  `function()` / component names as the durable anchor next to them.
- Don't invent design decisions. If the design doesn't cover a case, the ticket says so.
