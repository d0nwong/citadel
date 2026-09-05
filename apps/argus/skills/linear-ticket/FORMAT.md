# Ticket format

Linear renders markdown. Use `##` for the section headings, `-` for bullets. Nothing
else: no bold section labels, no tables. Checkboxes (`- [ ]`) appear in exactly one
section, Acceptance Criteria, and nowhere else.

Five sections are always present. A sixth, **Pending**, appears only when the ticket is
waiting on work that has not landed yet.

## Skeleton

```markdown
## Summary

<2–4 sentences, present tense. What changes, on which surfaces. Lead with the shape of the
change ("switches from a single name + avatar to an avatar stack"), not the motivation.>

## Background

<Why this is needed. What the current UI/code does and why that's now wrong or
insufficient. What the new design/API introduces, enough that the acceptance criteria make
sense. No implementation detail — that's Technical Notes. Current state only: not the
decision trail, not what landed when — the journal owns history. When a fact changes,
rewrite the sentence; never stack dated "Decided…" / "Landed…" paragraphs.>

## Scope / Out of Scope

In scope:

- <Surface or file — what changes there, one line>
- <… 3–6 lines in all. Names the places that change and nothing more: no formulas, field
  names or fallbacks — those are Acceptance Criteria or Technical Notes>

Out of scope:

- <Thing a reader would assume is included — who owns it / why not now>
- <…>

## Acceptance Criteria

- [ ] AC1 — <one observable outcome: what a user, a test or a reviewer can see is true once
      this lands, worded so it is also the check — the input or state to set up and what
      must then be observed. No mechanism, no file names. Cite the product rule it
      implements where one exists: "(product BR-93)">
- [ ] AC2 — <…>

## Pending

<Omit this whole section when nothing is outstanding. One bullet per unlanded thing this
ticket needs, newest understanding first:>

- **FE|BE — <the change that hasn't landed>** (<who owns it>) — <which ACs it stops, and
  what can proceed meanwhile>
- <…>

## Technical Notes

- <File path — the function/component that owns it, what it does today, what has to
  change — and the AC(s) it serves.>
- <Current type → needed type, and the schema/validation that moves with it.>
- <Open question stated as one: "confirm with backend whether X covers this or a new Y is needed".>

Verified at FE <branch>@<sha>, BE dev@<sha>.
```

## Acceptance Criteria

- **An AC is an outcome, never a mechanism.** "The headline shows Σ `credits.totalCredits`
  over the selected entities" is an AC; "`map-usage-response.ts` sums the entities" is a
  Technical Note. If an AC names a file, move it. Where the AC implements a rule the
  feature's `product.md` already states, cite the rule number — the check then proves the
  documented behaviour, not a restatement of it.
- **An AC is its own test case.** It is worded as the check that would fail if it were
  false — the state to set up and what must be observed — so there is no separate Test
  Cases list to keep in step with it. Whether the check runs as a manual step or an
  automated test is decided at implementation time; the line never names a framework or a
  test file. An AC that needs two checks is two ACs.
- **Every AC is grounded.** At least one Technical Note names the file or function where it
  is satisfied. An AC nobody can ground is an open question in Technical Notes, not a
  criterion.
- **Division of labour.** Scope says *where* the change lands (3–6 lines). Acceptance
  Criteria say *when it is done*. Technical Notes say *where to start*. A formula, a field
  name or a fallback lives in exactly one of the last two.
- **Ticks are the implementer's record.** Whoever does the work ticks the ACs — in the
  ticket when they have Linear access, otherwise in the PR body, which copies the list. The
  sweep never ticks a box from its own reading of the code; "appears satisfied" is a report
  line, not a tick.

## Parent tickets with sub-issues

A parent gets sub-issues only when the work is several deliverables that land separately.
The parent keeps the five normal sections, describes the whole change, and adds one more
section at the very bottom. Its Acceptance Criteria are one line per sub-issue — the
outcome that sub-issue delivers, in Execution-order order — so parent and child never carry
the same AC twice.

```markdown
## Execution order

1. LIA-xx — <sub-issue title> — blocked by: none
2. LIA-yy — <sub-issue title> — blocked by LIA-xx (<what it needs from it>)
3. LIA-zz — <sub-issue title> — blocked by: none — can run alongside step 2
4. LIA-aa — <sub-issue title> — blocked by LIA-yy, LIA-zz
```

Each sub-issue is a full ticket in its own right (same five sections, same AC and grounding
bar) and opens with a single position line above `## Summary`:

```markdown
Step 2 of 4 of LIA-pp — blocked by LIA-xx (needs the regenerated client); blocks LIA-aa.

## Summary
…
```

The relations in those lines are also set in Linear (`blockedBy` / `blocks`), so the
dependency shows on the issue itself and not only in prose. Numbering that isn't a
dependency — two steps that can run at once — says so on the line; leaving it implied
reads as sequential and stalls work that could have started.

## Backend contract changes and the generated client

A ticket whose FE work depends on a backend contract change has two phases, and the same
fact lives in a different section in each:

- **BE not yet on `origin/dev`** → a `Pending` bullet, as above:
  `**BE — <route/schema change>** (<owner>) — <which ACs it stops, what can proceed>`.
- **BE on `origin/dev` and deployed to `dev-alden-portal`** (the server `orval.config.ts`
  exports the swagger from) → the regen is the **first Scope bullet**, not a Pending one:

  ```markdown
  - Generated client — regenerate against `dev@<sha>`
  - <the FE surface or file the ticket changes, written against the regenerated types>
  ```

  Nobody else owns the regen, so it is not "waiting" — it is step one of the ticket. The
  mechanics are the first Technical Note, not a Scope line: confirm the change is live on
  `https://dev-alden-portal.uc.r.appspot.com/api-docs/swagger-ui-init.js`, export the
  `swaggerDoc` object to `./openapi.json`, run Orval, commit `src/http/generated/`; the
  generated hook or type the FE consumes is named there beside the AC it serves.
  Landed-but-not-deployed stays Pending: an export from a stale server looks done and
  isn't. Delete the Pending bullet when you move it; the journal owns the history.

## Worked example (the reference — match this register)

Title: `Swap the Usage page's dummy transport for the usage endpoint` (LIA-78)

```markdown
Step 8 of 8 of LIA-71 — blocked by LIA-73 (the `getUsage` seam it replaces) and LIA-81
(the `entityIds` and month-paging parameters `getUsage` has to honour). The BE endpoint it
reads is live and deployed, so nothing gates it; worked last, after steps 3–7, so the DTO
reconciliation covers every consumer; blocks nothing.

## Summary

Points the Usage page at the per-entity current-cycle endpoint and the entity roster. The
mock was already entering at the transport layer, so the change is the body of `getUsage`
and `getUsageClients`, the reconciliation of the hand-written DTOs against the generated
types, the credit maths in the mapper, and the deletion of the mock — the table, drawer and
grouping components stay where they are.

## Background

The Usage page renders a hand-written fixture (`get-usage-mock.ts`) shaped around capacity
and modelling hours, and its client roster is built from the same fixture so the two sides
agree on ids. The backend now serves one entity's open-cycle tasks, subtasks and credit
rollup on `GET /api/v1/invoices/entity/{entityId}/current-cycle` (invoicing router) and
the entity roster on `GET /api/v1/entity`. Credits are the page's only unit: the fixture's
capacity allowances, modelling hours and the `Σ quantity × multiplier` fallback have no
server counterpart and go.

The Active tab is the cycle in progress, not a rendered invoice, so it includes tasks still
open — the figures here legitimately differ from what the cycle bills (invoicing BR-26h),
and the column has to say which figure it shows.

## Scope / Out of Scope

In scope:

- Generated client — regenerate against `dev@5ca2ed71`
- `src/http/usage/` — `getUsage` and `getUsageClients` transports, `types.ts` DTOs; delete
  `src/http/mocks/get-usage-mock.ts` and its test
- `src/hooks/usage/map-usage-response.ts` — credit maths for tasks, segments, donut,
  rollover and the subtask label
- `src/pages/admin/usage/` — Credit header provenance line, donut heading and trigger text,
  removal of the modelling-hours meter
- Loading, error and empty states re-checked against the real endpoint

Out of scope:

- Any write path — the page is read-only
- Layout, columns and grouping — unchanged
- A modelling-hours quantity on the server — none exists (admin-usage arch MM-9); the bar
  stays hidden until one does

## Acceptance Criteria

- [ ] AC1 — Opening a client issues one current-cycle request per entity of that client
      and none to a mock; `get-usage-mock.ts` no longer exists
- [ ] AC2 — The drawer's Credit headline is Σ `credits.totalCredits` / Σ
      `credits.totalAvailableCredits` over those responses (product BR-93)
- [ ] AC3 — Group headers show the entity's name and code, and the breadcrumb the client's
      name, from the entity roster — never from the usage payload
- [ ] AC4 — An entity with one in-progress task, one task completed this cycle and one
      completed last cycle shows exactly two rows: active tasks plus tasks completed inside
      the open cycle, nothing else
- [ ] AC5 — A task's Credit is its own `credits` plus the sum of its subtasks' `credits`; a
      subtask's is its own; no quantity × multiplier fallback anywhere
- [ ] AC6 — Each bar segment is one configured asset type sized `quantity × creditWeight ×
      multiplier`, with multiplier 1 when the task has no active size multiplier
- [ ] AC7 — The Credit column header carries a one-line note naming the figure it shows and
      that it is usage counted here, not what the cycle bills
- [ ] AC8 — The rollover band and its legend draw `credits.availableRollover`, so an expired
      rollover shows no band (product BR-103, BR-107)
- [ ] AC9 — Subtask rows read `{assetType.name} Subtask`, or `Subtask` when the type is null
- [ ] AC10 — The donut shows credits per asset type as a share of their sum, with no
      denominator; its heading and the drawer trigger's accessible name read Credit
- [ ] AC11 — With the endpoint stubbed to a 404, a 5 s delay and an entity with no tasks,
      the page shows error-with-retry, skeleton and empty state respectively; no rows from a
      previous client remain on screen
- [ ] AC12 — No modelling-hours JSX, DTO field, mapper branch or meter remains

## Pending

- **BE — `billableQuantity`, or per-asset-type credits, on the wire** — the server prices a
  task as `creditWeight × (billableQuantity ?? quantity) × sizeMultiplier` but publishes
  `assetTypes[].quantity` alone, so AC6's segments and AC10's slices can disagree with
  `tasks[].credits` on a task with an edited billable quantity. Owner: BE. Meanwhile: build
  on `quantity`; AC2 and AC5 stay on the server's `credits`, and AC7's note covers the
  difference.
- **Product — which task statuses the Active tab lists** — AC4 states the endpoint's set
  (non-archived, status neither `not_started` nor `completed`, plus completed-in-cycle); the
  page today shows every status. Owner: product. Meanwhile: implement AC4 as written;
  widening it is one filter in the mapper.

## Technical Notes

- Regen: confirm `EntityCurrentBillingCycleResponse` is on
  `https://dev-alden-portal.uc.r.appspot.com/api-docs/swagger-ui-init.js`, export
  `swaggerDoc` to `./openapi.json`, run Orval, commit `src/http/generated/`.
  `orval.config.ts` exports from `dev-alden-portal`, so a landed-but-undeployed change
  produces a stale client that looks correct. The roster hook `useGetEntities`
  (`src/hooks/entity/use-get-entities.ts`) already exists; the current-cycle hook will be
  new — AC1, AC3.
- `src/http/usage/get-usage.ts` returns `getUsageMock(params)` unconditionally;
  `get-usage-clients.ts` folds `MOCK_USAGE_ENTITIES` into `UsageClientDto[]` and says in its
  own comment that it avoids `GET /api/v1/entity` only because the usage side was still the
  fixture. Both move together — AC1, AC3.
- `use-usage.ts` unwraps `{success, data}` with a plain `usageQuery.data?.data`; nothing
  under the usage tree imports `unwrapOrvalHookPayload`. Right for the mock, wrong for a
  generated Orval hook whose payload arrives double-wrapped — the unwrap is work here if the
  transport goes over the hook. With N requests per client, `useQueries` (or one `queryFn`
  that fans out) replaces the single `useQuery` — AC1, AC2.
- `map-usage-response.ts`: `mapUsageActiveRow` returns `null` on an empty `clientName`, so
  identity is joined from the roster before mapping — AC3. `mapUsageTaskRow` derives
  `capacityCount` as `Σ quantity × multiplier` when null; replace with
  `credits + Σ subTasks[].credits` — AC5. `collectAssetTypeColumns` de-dupes on
  `assetTypeId`, which is the key `entity.assetEntities[].id` carries (the asset type's id,
  not the join row's; `asset_entity` is not unique on `(assetTypeId, entityId)`, so two
  configured rows can collapse into one column) — AC6.
- `usage-capacity-bar.tsx` `buildCapacitySegments` values a segment as
  `count × task.multiplier`; the server's rule is
  `creditWeight × (billableQuantity ?? quantity) × sizeMultiplier`
  (`be:src/controllers/v1/taskController.ts`). `entity.assetEntities[].creditWeight` and
  `tasks[].multiplierTask.multiplier` are on the wire, `billableQuantity` is not
  (Pending) — AC6.
- `use-usage-active-tasks.ts` `buildStackedMeter` reads `row.rolloverCredits` (banked) for
  the band; the payload publishes both `entity.invoiceField.rolloverCredits` and
  `credits.availableRollover`, the latter zeroed by `isRolloverCreditsWindowOpen` once four
  calendar months (UTC, inclusive) pass after `rolloverCreditsStartDate`
  (`be:src/services/invoiceService.ts` `computeRolloverAndOverage`) — AC8.
- The same hook's `assetTypeCapacities` reduce sums `count × multiplier` into `capacityUsed`
  over `capacityTotal` from `assetTypeCapacities[]`; the donut becomes the per-type segment
  sums with no total. `usage-asset-type-radial.tsx` reads
  `UsageAssetTypeCapacityRow.percentUsed` / `isOverCapacity`; both go.
  `usage-capacity-drawer.tsx`'s heading and `UsageCapacityDrawerTrigger`'s `sr-only` text
  still say Capacity — AC10.
- `usage-capacity-drawer.tsx` carries the Modelling hours `UsageProjectStackedMeter` as
  commented JSX; `UsageModellingHoursDto`, `modellingHoursUsed` / `modellingHoursAvailable`,
  `mapModellingHours` and the hook's `modellingHours` meter exist only for it — AC12.
- Nested subtasks: `currentBillingCycleTaskSelect`'s `subTasks.studio` select in
  `getEntityCurrentBillingCycle` reaches only `studio.department.assetType.{id, name}`,
  surfaced as `subTasks[].assetType`; no `Studios.name` on the wire — AC9.
- `tasks[].name` is a JSON column (`Tasks.name Json`) typed `object` in the swagger; reduce
  it to a string the way the dashboard task table does. `multiplierTask` is nullable.
  `assignedUsers[]` is a list with `isPrimary`; `userName` is the primary assignee's
  `firstName lastName`. `SubTaskStatus.submitted` has no entry in `STATUS_CONFIG`, so
  `normalizeUsageTaskStatus` renders it Not Started (admin-usage arch MM-8) — add a
  mapping — AC4, AC9.
- Open question: the FE's `contactName` (client-side contact on a task) has no counterpart
  on the wire; nothing renders it since the contact line left the Task cell, so it stays
  null until backend says otherwise.
- Error shape: a missing entity throws a bare `Error("Entity N not found")` in
  `getEntityCurrentBillingCycle`, so the FE sees a 500 where the swagger block documents
  404 (admin-invoicing arch MM-29); a null client `billingCycleDay` is a real 400. The route
  guard is `checkJwtInternalStudioLead`, wider than the page's owner gate — no auth work —
  AC11.
- Task set and credits: the endpoint returns non-archived tasks with status not in
  {`not_started`, `completed`} plus tasks with `completedDate` inside
  `currentOpenBillingCycleRange`; `tasks[].credits` is the parent's asset half and
  `projectsBar[].totalCredit` the only server-side sum, at the `projects` grain (one level
  below the entity) — the group header does not come from it. The invoice adds subtask
  credits the same way (invoicing BR-26f/BR-26g); what cannot reconcile row for row is the
  task set, since a project whose parent tasks are all open is skipped by the generator
  (BR-26h) — that is what AC7's note states — AC4, AC5, AC7.
- Generated types will be the awkward part: the spec is derived from Joi schemas and
  neighbouring DTOs mark most fields optional, so the mapper may need `undefined` handling
  the hand-written DTO did not.

Verified at FE `staging@3c520fc4c`, BE `dev@5ca2ed71`.
```

## What the example is doing (copy these moves)

- Summary names **every** surface the ticket touches, in the order Scope follows.
- Scope is five lines and contains no formula: a reader knows which files move and
  nothing else.
- Every AC is checkable by someone who has never opened the repo, and is worded as the
  check itself (AC4 and AC11 name the state to set up); every formula and fallback that
  used to sit in Scope is now an AC with a product rule cited where one exists.
- Pending names which ACs each unlanded item blocks and what to build meanwhile, so the
  ticket says exactly how much can proceed. Out of scope is doing real work too — it kills
  three assumptions (writes, layout, an hours quantity) that would otherwise land in review.
- Every Technical Note is openable — a file, the exact function, the current behaviour,
  the target — and ends by naming the AC it serves. The one thing nobody knew is written
  as a question, not a guess.
