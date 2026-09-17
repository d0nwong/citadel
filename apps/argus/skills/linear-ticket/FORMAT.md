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

## Length budget

- **Technical Notes are what the code won't tell you.** At most eight bullets, each a
  fact the implementer could not learn by opening the files Scope names: a payload that
  arrives wrapped, a mapper that returns null, a field that exists twice under two
  meanings, a status code that lies. What the files themselves show — a function's current
  body, a type's current shape — is not a note.
- **Cite, don't restate.** Anything the feature's `arch.md` or `product.md` already says
  is a reference by its MM / BR number, never a paragraph. The docs are where the long
  version lives; the ticket carries the pointer and the AC it matters to.
- **Recurring mechanics live here, once.** The regen steps in the section below are the
  copy; a Technical Note says "regen per FORMAT.md against `dev@<sha>`" and names the hook.
- **Target under 800 words** for the whole body. The worked example below is about
  910 including its sub-issue position line and twelve ACs; most tickets land lower.

## Parent tickets with sub-issues

A parent gets sub-issues only when the work is several deliverables that land separately.
The parent keeps the five normal sections, describes the whole change, and adds one more
section at the very bottom. Its Acceptance Criteria are one line per sub-issue — the
outcome that sub-issue delivers, in Execution-order order — so parent and child never carry
the same AC twice.

```markdown
## Execution order

1. ALD-xx — <sub-issue title> — blocked by: none
2. ALD-yy — <sub-issue title> — blocked by ALD-xx (<what it needs from it>)
3. ALD-zz — <sub-issue title> — blocked by: none — can run alongside step 2
4. ALD-aa — <sub-issue title> — blocked by ALD-yy, ALD-zz
```

Each sub-issue is a full ticket in its own right (same five sections, same AC and grounding
bar) and opens with a single position line above `## Summary`:

```markdown
Step 2 of 4 of ALD-pp — blocked by ALD-xx (needs the regenerated client); blocks ALD-aa.

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
  mechanics live here and nowhere else: confirm the change is live on
  `https://dev-alden-portal.uc.r.appspot.com/api-docs/swagger-ui-init.js`, export the
  `swaggerDoc` object to `./openapi.json`, run Orval, commit `src/http/generated/`. A
  Technical Note says "regen per FORMAT.md against `dev@<sha>`" and names the generated
  hook or type the FE consumes beside the AC it serves.
  Landed-but-not-deployed stays Pending: an export from a stale server looks done and
  isn't. Before you write a backend Pending bullet, run `argus deployed <be#N>` (or the
  merge sha). If it prints "deployed", the regen is the first Scope bullet. If it prints
  "running", it stays Pending, and the bullet says the pipeline is running. Never write
  that you cannot tell whether the change is live. Delete the Pending bullet when you move it; the journal owns the history.

## Worked example (the reference — match this register)

Title: `Swap the Usage page's dummy transport for the usage endpoint` (ALD-10)

```markdown
Step 8 of 8 of ALD-6 — blocked by ALD-13 (the `getUsage` seam it replaces) and ALD-7
(the `entityIds` and month-paging parameters `getUsage` has to honour). The BE endpoint it
reads is live and deployed, so nothing gates it; worked last, after steps 3–7; blocks
nothing.

## Summary

Points the Usage page at the per-entity current-cycle endpoint and the entity roster. The
mock already enters at the transport layer, so the change is the two transports, the DTO
reconciliation, the mapper's credit maths and the deletion of the mock; the table, drawer
and grouping components stay.

## Background

The Usage page renders a hand-written fixture (`get-usage-mock.ts`) and builds its client
roster from the same fixture so the two sides agree on ids. The backend now serves one
entity's open-cycle tasks, subtasks and credit rollup on
`GET /api/v1/invoices/entity/{entityId}/current-cycle` and the roster on
`GET /api/v1/entity`; credits are the page's only unit, so the fixture's capacity
allowances, modelling hours and `Σ quantity × multiplier` fallback go.

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
- [ ] AC7 — The Credit column header carries a one-line note saying the figure is usage
      counted here, not what the cycle bills (the generator skips a project whose parent
      tasks are all still open — invoicing BR-26h)
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

- **BE — `billableQuantity` on the wire** — the server prices off
  `billableQuantity ?? quantity` but publishes `quantity` alone, so AC6 and AC10 can
  disagree with `tasks[].credits` on an edited task. Owner: BE. Meanwhile: build on
  `quantity`; AC7's note covers the gap.
- **Product — which task statuses the Active tab lists** — AC4 states the endpoint's set;
  the page today shows every status. Owner: product. Meanwhile: implement AC4; widening it
  is one mapper filter.

## Technical Notes

- Regen per FORMAT.md against `dev@5ca2ed71`; the roster hook `useGetEntities` already
  exists, the current-cycle hook is new — AC1, AC3.
- Orval hook payloads arrive double-wrapped; `use-usage.ts` unwraps once
  (`usageQuery.data?.data`, no `unwrapOrvalHookPayload`). One request per entity means
  `useQueries` replaces the single `useQuery` — AC1, AC2.
- `mapUsageActiveRow` returns `null` on an empty `clientName`: join the roster's name and
  code onto each response before mapping — AC3.
- The payload carries both `invoiceField.rolloverCredits` (banked) and
  `credits.availableRollover` (zero once the four-month window closes);
  `buildStackedMeter` reads the banked one today (arch MM-11) — AC8.
- `assetEntities[].id` is the asset type's id, and the join is not unique per entity and
  type, so two configured rows can collapse into one column; `collectAssetTypeColumns`
  keys on `assetTypeId` already (arch MM-3, MM-5) — AC6, AC10.
- `tasks[].name` is JSON (`object` in the swagger): reduce it as the dashboard task table
  does. `multiplierTask` is nullable; `assignedUsers[]` carries `isPrimary`;
  `SubTaskStatus.submitted` has no `STATUS_CONFIG` entry (arch MM-8) — AC4, AC5, AC9.
- A missing entity is a bare `Error` in `getEntityCurrentBillingCycle`, so the FE sees 500
  where the swagger says 404 (admin-invoicing arch MM-29); a null `billingCycleDay` is a
  real 400 — AC11.
- Open question: `contactName` has no counterpart on the wire and nothing renders it; it
  stays null.

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
- Technical Notes are eight bullets, none of which the agent could learn from the files
  Scope names; everything the arch doc already says is an MM citation. Each is openable —
  a file, the exact function — and ends by naming the AC it serves. The one thing nobody
  knew is written as a question, not a guess.
