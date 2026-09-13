# The plan

Adapted from `planning-and-task-breakdown` in addy-agent-skills (MIT, © 2025 Addy Osmani): the tasks are Linear tickets, and the plan is written once and filed, never ticked.

The plan cuts the difference between each baseline and its revision into tickets a Foundry job can finish in one run. Linear holds their state; the plan holds what was filed. Its shape is in `SHAPES.md`.

## 1. List the difference

For each feature: the new criteria, the reworded ones, the retired ones. Every one of them lands in exactly one ticket, and no ticket exists without one. A retirement is work too — the code stops doing the thing.

## 2. Order by what depends on what

Map it before writing a ticket: a record before the verbs that write it, an endpoint before the page that calls it, a contract before the two sides that share it. Build bottom-up; put the riskiest ticket early so it fails fast.

## 3. Slice vertically, and size

A ticket delivers one working path end to end, not a layer: "a settled job can be re-ignited from its page" rather than "the re-ignite column". Aim for S or M:

| Size | Files | Example |
|---|---|---|
| S | 1–2 | one endpoint, one component |
| M | 3–5 | one feature slice |
| L | 5–8 | split it |

Split when it touches two independent subsystems, needs more than three acceptance criteria to say, or its title wants an "and". Two tickets that touch the same files and share no order can still run in parallel; say so.

## 4. Write each ticket in the house format

Six sections per `linear-ticket`'s `FORMAT.md`, title under 80 characters with `[FE]` or `[BE]`:

- **Acceptance Criteria** carry the spec's wording for the criteria the ticket implements, each ending `(spec S-n)` after any `(R-n)`. A criterion that belongs to another feature's spec says which: `(spec reconcile S-9)`.
- **Technical Notes** point at code — a file and a function or line range at the base branch's sha — never a paraphrase. Read the file before citing it. End with `Verified at <repo> <branch>@<sha>`.
- **Pending** names only what is outside this plan: another team's landing, an answer someone owes. A ticket's blockers inside the plan are its `blocked by` line, and Linear holds them as relations.

## 5. The list, the risks, then the doubt pass

Above the bodies: the numbered list — title, the criteria it implements, what blocks it — then which tickets can run in parallel, then a risks table only for risks you can name with what would catch them.

Run the doubt pass in `spec.md` with the plan as the artifact and the specs as the contract: a criterion no ticket covers, a ticket covering none, an order that builds on nothing, a Technical Note with no file behind it, a ticket too big for one run. Then show the whole plan and wait for the yes.
