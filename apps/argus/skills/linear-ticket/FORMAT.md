# Ticket format

Linear renders markdown. Use `##` for the section headings, `-` for bullets. Nothing
else: no bold section labels, no tables, no checkboxes.

Four sections are always present. A fifth, **Pending**, appears only when the ticket is
waiting on work that has not landed yet.

## Skeleton

```markdown
## Summary

<2–4 sentences, present tense. What changes, on which surfaces. Lead with the shape of the
change ("switches from a single name + avatar to an avatar stack"), not the motivation.>

## Background

<Why this is needed. What the current UI/code does and why that's now wrong or
insufficient. What the new design/API introduces, described enough that the scope bullets
make sense. No implementation detail — that's Technical Notes. Current state only: not the
decision trail, not what landed when — the journal owns history. When a fact changes,
rewrite the sentence; never stack dated "Decided…" / "Landed…" paragraphs.>

## Scope / Out of Scope

In scope:

- <Surface — element: the change>
- <Surface — element: the change>

Out of scope:

- <Thing a reader would assume is included — who owns it / why not now>
- <…>

## Pending

<Omit this whole section when nothing is outstanding. One bullet per unlanded thing this
ticket needs, newest understanding first:>

- **FE|BE — <the change that hasn't landed>** (<who owns it>) — <what it stops here, and
  what can proceed meanwhile>
- <…>

## Technical Notes

- <File path — the function/component that owns it, what it does today, what has to change.>
- <Current type → needed type, and the schema/validation that moves with it.>
- <Open question stated as one: "confirm with backend whether X covers this or a new Y is needed".>
```

## Backend contract changes and the generated client

A ticket whose FE work depends on a backend contract change has two phases, and the same
fact lives in a different section in each:

- **BE not yet on `origin/dev`** → a `Pending` bullet, as above:
  `**BE — <route/schema change>** (<owner>) — <what it stops here, what can proceed>`.
- **BE on `origin/dev` and deployed to `dev-alden-portal`** (the server `orval.config.ts`
  exports the swagger from) → the regen is the **first Scope bullet**, not a Pending one:

  ```markdown
  - Generated client — regenerate against `dev@<sha>`: confirm the change is live on
    `https://dev-alden-portal.uc.r.appspot.com/api-docs/swagger-ui-init.js`, export the
    `swaggerDoc` object to `./openapi.json`, run Orval, commit `src/http/generated/`
  - <the FE work, written against the regenerated types>
  ```

  Nobody else owns the regen, so it is not "waiting" — it is step one of the ticket.
  Landed-but-not-deployed stays Pending: an export from a stale server looks done and
  isn't. Delete the Pending bullet when you move it; the journal owns the history.

## Worked example (the reference — match this register)

Title: `Support multiple assignees in task and subtask assignee displays`

```markdown
## Summary

Update the assignee display across task and subtask views to support multiple assignees.
The dashboard switches from a single name + avatar to an avatar stack with tooltip-on-hover
name reveal. The draft task modal and subtask modal get a multi-select assignee field.

## Background

Tasks and subtasks can now be assigned to multiple users. The current UI only renders a
single assignee, so extra assignees are invisible. The new design introduces an avatar
stack (overlapping circles with initials + colour coding) for the dashboard table, and a
multi-select combobox/tag input in the modals.

## Scope / Out of Scope

In scope:

- Dashboard Tasks tab — Main Assignee and Subtask Assignee columns: replace single name +
  avatar cell with an avatar stack; show full name on avatar hover (tooltip)
- Draft Task modal — Assignee field: turn the existing single-select into a multi-select;
  display selected users as avatar + name tags
- Subtask modal — Assignee field: same multi-select treatment as the draft modal

Out of scope:

- Backend changes to support multiple assignees — handled separately
- Reassign flow (unassigned tasks tab)
- Peer Review tab assignee column

## Pending

- **BE — `GET /api/v1/tasks/{taskId}` returns an assignee array** (backend team) — the
  dashboard cell has a single name to render until it lands; build against the array shape
  behind a fixture and the switch is a one-line mapper change
- **FE — `assigneeIds` on the subtask `schema.ts`** — waits on the backend answer in the
  last Technical Note; the subtask modal's field can't be wired before it

## Technical Notes

- Dashboard avatar cell is in `task-table-columns.tsx` — `createMainAssigneeColumn()`,
  `createSubtaskAssigneeColumn()`, and the inline assignee column cell. Currently each
  reads a single string (`assignedUser` / `teamlead`). Will need to read an array once the
  API returns one.
- The local `getAvatar()` helper in `task-table-columns.tsx` renders one avatar — extend or
  replace with an avatar stack component that maps over the array and overlaps them with
  `-ml-2` / z-index stacking and a `Tooltip` wrapper.
- Draft modal assignee field is in `draft-modal-left-column.tsx` around line 537–695.
  Currently a single `<Select>` bound to `assignedUserId` (string). Needs to become a
  multi-select bound to an array (e.g. `assignedUserIds: number[]`); update Zod schema
  accordingly.
- Subtask modal has no assignee field today — confirm with backend whether
  `designatedStudio` / team selection covers this or a new `assigneeIds` field is needed in
  `schema.ts`.
```

## What the example is doing (copy these moves)

- Summary names **every** surface the ticket touches, in the order the scope bullets follow.
- Background explains the invisible-extra-assignees problem before naming the new controls;
  the reader can now judge the scope list.
- Out of scope is doing real work — it kills three assumptions (backend, reassign flow,
  peer review) that would otherwise land in review comments.
- Pending and Out of scope look similar and are not. Out of scope means "not this ticket,
  ever" — the multi-assignee backend is someone else's work. Pending means "this ticket,
  but not yet" — that same backend is also what this ticket waits on, so it appears in
  both, once as a boundary and once as a dependency. Every Pending bullet says what can
  proceed meanwhile, so the ticket never reads as simply stuck.
- Every technical bullet is openable: a file, the exact function, the current type, the
  target type. The one thing nobody knew is written as a question, not a guess.
