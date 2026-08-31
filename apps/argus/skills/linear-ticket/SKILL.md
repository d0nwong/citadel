---
name: linear-ticket
description: Draft and file a Linear issue in the house format — Summary / Background / Scope / Pending / Technical Notes — cross-checked against the feature's dual-tier docs and grounded in real files, functions and line ranges. Use when the user says "create a linear ticket", "file this as a ticket", "write this up for Linear", "make a ticket for <thing>", or hands over a design/Slack thread that should become an issue. Also use to record what a ticket is waiting on (a backend endpoint, an unpublished field name) in its Pending section.
---

# linear-ticket — turn an ask into a filed Linear issue

The value of a ticket from this skill is the **Technical Notes**: whoever picks it up
should be able to open the named files and start. Everything else is scaffolding.

Format spec + worked example: `FORMAT.md` (read it before drafting).
Tools: the Linear MCP (`.mcp.json`, project scope). Tool names are `mcp__linear__*` —
`save_issue` (creates when you omit `id`, updates when you pass one), `list_teams`,
`list_projects`, `list_issue_labels`, `list_issue_statuses`, `list_users`, `save_comment`.
If they aren't loaded, fetch schemas with `ToolSearch("+linear")`. If the server is
unauthenticated, tell the user to run `/mcp` and pick `linear` → Authenticate; don't try to
work around it.

## Procedure

**1. Take the ask.** Whatever the user gives you — a sentence, a design note, a Slack
paste — is the raw material. Ask at most one round of questions, and only for things you
cannot find out yourself (which team, what's deliberately out of scope, who owns the
backend half). Never interrogate for detail you could read out of the code or the docs.

**2. Cross-check the dual-tier docs.** Always, before drafting, for every feature the ask
touches. These are the docs `skills/feature-docs` produces per `DOC-PROTOCOL.md`:
`alden/alden-portal/features/<dir>/docs/product.md` and `.../arch.md`.

- Find the feature and its `dir` with `bun run accio list`, or from the manifest at
  `alden/alden-portal/.doc-workspace/feature-manifest.json`. A change that spans surfaces
  spans features — read all of them. A modal can be owned by `shared-components`, hosted by
  `app-shell`, and opened from `admin-projects`; miss one and the ticket misses a caller.
- Harvest in this order:
  - **product.md → Out of Scope / Known Gaps.** Half the ticket's Out-of-scope bullets are
    already written here, with owners ("handled by X", "lives in Y"). Reuse them verbatim
    where they hold. This section is the single highest-value read in the whole step.
  - **product.md → Business Rules.** A ticket that changes a documented rule must SAY so,
    by rule number, in Background. A ticket that silently breaks one is a bug being filed
    as a feature.
  - **product.md → Edge Cases & Error States.** The states the new UI still has to handle;
    they belong in scope bullets, not in a QA ticket later.
  - **arch.md → Interfaces & Contracts.** The endpoints and DTOs that already exist, so
    "we need a new endpoint" becomes a claim you can defend — name the closest existing one
    and what its DTO is missing.
  - **arch.md → Gaps / Tech Debt** and **Failure Modes.** These name the constraint the
    ticket will trip over (no pagination, FE-only gating, dev-mode mock fallbacks).
- **Docs are a lead, not proof.** Each doc's `last_verified: <branch>@<sha>` names the FE
  revision it was derived from. Anything you carry from a doc into Technical Notes gets
  re-read in code at your pinned sha in step 3. Where doc and code disagree, the code wins
  and the drift is worth a line in the ticket.
- No docs for that feature, or its manifest `status` isn't `done`? Say so in your reply,
  ground in code only, and offer `/feature-docs <id>` afterwards.

**3. Ground it in code.** This is the step that earns the ticket.
- `bun run accio "<the UI thing>"` (see `skills/api-lookup/SKILL.md`) finds the feature and
  the files behind a named UI element; `bun run accio list` names the features.
- Read the actual files. Every file path, function name, line range, prop, type and schema
  field in Technical Notes must come from a read, not from memory and not from a doc.
- FE code lives in `~/git/alden-portal-fe`, a **shared working tree whose branch switches
  without warning** — pin to a sha and read via `git show <sha>:<path>` (quote the whole
  `"<sha>:<path>"` argument — zsh reads a bare `$SHA:src/…` as a parameter modifier and
  mangles it). Record nothing you read from an unpinned working tree, and name the sha you
  pinned at the bottom of the ticket.
- BE code lives in `~/git/alden-connect-portal-be` — same discipline: `git fetch origin dev`,
  pin `origin/dev` (`dev@<shortsha>`), read via quoted `git show "<sha>:<path>"` (routers in
  `src/routers/v1/`, controllers in `src/controllers/v1/`, logic in `src/use-cases/` +
  `src/services/`). If BE code informed the ticket, name the BE sha at the bottom too.
- Anything you could not verify becomes an explicit open question in Technical Notes
  ("confirm with backend whether …"), never a confident claim.
- Grounding is also how you fill **Pending**: a field the schema doesn't accept yet, a
  table that doesn't exist, a generated hook that isn't generated — each is a pending item
  with the sha you proved it against, not a vague "waiting on backend".

**4. Resolve the destination.** `list_teams` → team; `list_projects`, `list_issue_labels`
for the rest. Reuse `defaults.json` beside this skill if present (`{"teamId":…,
"teamKey":…, "projectId":…, "labelIds":[…]}`); if it's absent or the team is ambiguous,
ask once and write the answer there so the next run is silent. Leave status, assignee,
estimate and cycle alone unless the user names them.

**5. Draft, then show it.** Write the full issue per `FORMAT.md` to
`<scratchpad>/linear-<slug>.md` and print the title + body in the reply. Filing is
outward-facing: get an explicit go-ahead before creating, unless the user already said
"file it" / "just create it".

**6. Create.** `save_issue` with `title`, `team`, `description` (the markdown body), plus
`project`/`labels` if resolved — and no `id`, which is what makes it a create. Report back
the issue key and URL, nothing else.

**7. Close the loop.** If the change is an alden-portal product/behavior decision, offer
`/log-change` with the new key as `ticket` — the journal entry and the ticket are separate
records and the journal wants the key. The journal's `features:` list is what later drives
`/feature-docs` to refresh the very docs you read in step 2, so name every feature the
ticket touches.

## Rules

- **Four sections, in order, always: Summary, Background, Scope / Out of Scope, Technical
  Notes** — plus **Pending** between Scope and Technical Notes when, and only when, the
  ticket waits on something unlanded. No acceptance criteria, no estimates, no "Testing"
  section unless asked — the format's silence is deliberate.
- **Pending is not the same as a Linear blocker.** A blocker (`blockedBy`) is another
  ticket. Pending is unlanded work that usually has no ticket in this team at all: a
  backend endpoint someone else is writing, a field name not yet published, an OpenAPI
  regeneration, a design answer the ticket's shape depends on. Name the side (FE / BE),
  the owner, and what can proceed meanwhile — a Pending bullet that doesn't say what to do
  in the meantime is a complaint, not a plan. Nothing pending means no section; an empty
  "Pending: none" is noise. When a pending item lands, delete its bullet rather than
  striking it through — the journal owns history, not the ticket.
- **Pending vs. an implementer's call.** Not every open question is Pending. Pending is
  for what the ticket's author can't resolve alone — waiting on another person, another
  team, or work unlanded elsewhere. A question the implementer can settle with ordinary
  engineering judgment doesn't belong there, even if it's technically "open": decide it
  and write the decision into Scope (state the chosen behavior, not the question), or
  note it in Technical Notes if it's worth flagging — don't leave a bullet sitting in
  Pending waiting for an answer nobody needs to give. The test: does resolving it need
  someone else's input (a design call with real behavioral consequences, an unshipped
  endpoint, a fact only another team can confirm)? If yes, Pending. If the ticket already
  states the required outcome and only the *mechanism* is undecided (hide vs. disable a
  field when the ticket already says the field must not be interactable; which of two
  independent validations runs first), that's implementer's judgment — pick the option
  that matches existing patterns in the codebase or ticket, state it, done. Getting this
  wrong in the cautious direction is not free: a mechanism-level question left in Pending
  is exactly what disqualifies a ticket from `agent-ready` (see below) even though nothing
  external was actually being waited on.
- **Never draft before reading the feature's product.md + arch.md.** Those Out-of-Scope and
  Known-Gaps sections exist so tickets stop relitigating settled boundaries; skipping them
  buys exactly the review comments the docs were written to prevent.
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
- **Scope is executable, not aspirational.** Once a ticket carries the `agent-ready`
  label, Foundry runs an agent with the body exactly as written (workspace README,
  "Downstream" section) — so Scope bullets must be concrete enough to execute without a
  round of questions. Anything vaguer belongs in Pending or as an open question in
  Technical Notes. A vague Scope doesn't just annoy the next reader; it disqualifies the
  ticket from pickup (the sweep only nominates tickets that clear this bar).
- Line numbers age fast: cite them only for a range you actually read, and prefer
  `function()` / component names as the durable anchor next to them.
- Don't invent design decisions. If the design doesn't cover a case, the ticket says so.
