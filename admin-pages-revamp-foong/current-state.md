# Admin revamp: FE tickets and their BE blockers (29 Sep)

Verified against BE `dev` @ `f42da1de` (deployed 29 Sep 06:51 UTC, build 2194) and FE `staging` @
`5a7421448`. `U` = [`Updated.md`](Updated.md), `S` = [`25-sep.md`](25-sep.md), `S2` =
[`29-sep.md`](29-sep.md), with line numbers.

**`29-sep.md` says its FIXED work is on `feat/missing-admin-routes`, "NOT merged or deployed yet".
That is out of date: the branch is merged to `dev` and deployed.** Every claim in it was checked in
the code, not from commit messages, and all of them hold.

## Verified live on dev

- **Permissions are studio lead+, not admin+** ([S2 17–34](29-sep.md#L17-L34)). `usersRouter`,
  `authRouter`, `teamsRouter` and `sizeMultiplierRouter` all use `checkJwtInternalStudioLead`. The
  "nobody hands out a level above their own" rule is in `usersController`; wrong level → 403.
- **Clients: optional fields clear with null** ([S2 44–47](29-sep.md#L44-L47)). `logoUrl`,
  `emailDomain`, `companyWebsite`, `industry`, `cityId` each `allow(null)` ("Null clears it.");
  `name` and `code` stay required.
- **Entities: `legalName` clears with null** ([S2 58–59](29-sep.md#L58-L59)).
- **Entity notes un-flag** ([S2 61–63](29-sep.md#L61-L63)). `entityController.ts:1430-1431` now uses
  `!== undefined`, so `isClientNote: false` and `isStarred: false` save.
- **Projects: `miroBoardUrlInternal` and `heavyDate` clear with null**
  ([S2 139–140](29-sep.md#L139-L140)).
- **Remove a studio leader**: `DELETE /studios/:studioId/remove/studioHead/:userId`, studio lead+
  ([S2 78–84](29-sep.md#L78-L84)). The user's `userType` drops to the highest leader level they still
  hold; 404 when they are not an active leader.
- **Remove a team leader**: `DELETE /teams/:teamId/remove/teamLead/:userId`, studio lead+
  ([S2 98–103](29-sep.md#L98-L103)). They stay a regular member.
- **Bulk question reorder**: `PUT /questionAnswers/question/reorder`, team lead+
  ([S2 151–157](29-sep.md#L151-L157)). Body `{ questions: [{ id, position }] }`, saved in one
  transaction; a missing or deleted id saves nothing, duplicate ids are rejected by the schema
  (`.unique("id")`), and `position: 0` is accepted.

## Deferred — the workaround is the design

- **Project health reset when `projectHealthId` is omitted**, on clients, entities and projects
  ([S2 52–53](29-sep.md#L52-L53), [68–69](29-sep.md#L68-L69), [142–143](29-sep.md#L142-L143)). Still
  in the code in all three controllers. Every save sends the loaded health id.
- **Client member `isPrimary`** ([S2 49–50](29-sep.md#L49-L50)) — remove the member and add them
  again.
- **`monthlyRetainer`** ([S2 65–66](29-sep.md#L65-L66)) — keeps its name, writes
  `invoice_fields.amount`; label it as the retainer / invoice amount.
- **`assetTypes[]` full replace** ([S2 71–73](29-sep.md#L71-L73), NO BE WORK) — use the per-row
  `asset_entity` endpoints and never send `assetTypes[]`.

## Not doing, ever (write the cards without them)

- Studio `colorId` on create ([S2 86–87](29-sep.md#L86-L87)) and user `colorId`
  ([S2 127–128](29-sep.md#L127-L128)).
- **Project notes are gone from the app** ([S2 145–146](29-sep.md#L145-L146)) — a change from
  "no create endpoint": the section comes off the page entirely.
- Groups ([S2 105–106](29-sep.md#L105-L106)), `studio_restrictions`
  ([S2 89–90](29-sep.md#L89-L90)), Auth0 deactivation ([S2 130–131](29-sep.md#L130-L131)),
  asset type usage endpoint ([S2 178–179](29-sep.md#L178-L179)), `department_leaders`, and
  `review_details` writes ([S2 169–170](29-sep.md#L169-L170)).
- `workCapacityBase` stays as the multiplier factor; `capacityWeight` prices answered quantity
  questions only ([S2 159–161](29-sep.md#L159-L161), [181–183](29-sep.md#L181-L183)).

## What still blocks each card

### [AP-283](https://trello.com/c/rMNnBmyL) Users

- **Editing a user with no city fails** ([S2 124–125](29-sep.md#L124-L125), ON HOLD): the route
  writes `cityId` 0. Workaround: always send a `cityId`.
- **Role edit and remove by assignment id** (no status from BE): both match `userId` + `roleId` and
  act on the first row found.
- **No deleted-users listing** (no status from BE): delete can't be undone from the portal.

### [AP-280](https://trello.com/c/ulZEMFGQ) Teams

- **`editTeam` turns a null `studioId` / `teamLeadId` into 0 and 500s** (no status from BE):
  `teamsController` still has both `Number(...)` calls. This blocks the team edit itself.
- **`GET /teams/:teamId/admin` is missing edit-form fields and drops inactive members** (no status).
- **`toggleActive` writes `leftAt` backwards; re-adding a former member makes a second row** (no
  status).

### [AP-278](https://trello.com/c/Ep2oYTY2) Clients

- **Member remove only flips `isActive`, and inactive members are still returned** (no status).
- **No deleted-clients list; no assignees on the deactivation summary; duplicate name or code
  returns a bare 500** (no status).

### [AP-285](https://trello.com/c/zFXt4R6D) Entities

- **No list of archived or deleted entities** (no status).
- **Deleted temp credits still count in totals and the monthly snapshot; no temp credit list**
  (no status).
- **`isValid` is not recomputed on `PUT /invoiceFields/:id`** (no status).

### [AP-284](https://trello.com/c/TnanKrp6) Asset types

- **`GET /assetTypes` hides archived, deleted and department-bound types with no admin variant;
  `GET /sizeMultiplier` hides deleted ones; a weight of `0` is dropped on edit** (no status). The
  size multiplier guard is now live, so that half is done.

### [AP-279](https://trello.com/c/YOhKyqkF) Studios

- **The chart's leader list has no `isPrimary`; a department change does not reprice** (no status).
  The remove-leader endpoint it was waiting for is live.

### [AP-281](https://trello.com/c/OzzMwvrJ) Projects

- **The status, heavy and archive routes also reset `projectHealthId` to 1** (no status).
- Nothing else: clearing both fields is live, and project notes are cut.

### [AP-282](https://trello.com/c/06OKTYjD) Departments — merged (PR #470)

- Nothing blocking. The reorder endpoint is live, so drag-to-reorder is a follow-up card rather than
  a Pending item.

## Decisions

All six from `25-sep.md` are answered ([S2 186–193](29-sep.md#L186-L193)): leader removal drops
`userType`, teams / size multipliers / user creation / `workCapacity` are studio lead+, project notes
are dropped. Nothing is waiting on product.

## Where that leaves the work

1. **[AP-281](https://trello.com/c/OzzMwvrJ) Projects** — no Needed blocker left; only the extra
   health-reset routes, which the card handles by always sending health.
2. **[AP-279](https://trello.com/c/YOhKyqkF) Studios** — remove-leader is live; two unstatused
   cosmetic gaps remain.
3. **[AP-283](https://trello.com/c/rMNnBmyL) Users** — one bug with a workaround, two unstatused
   role/delete gaps.
4. **[AP-284](https://trello.com/c/TnanKrp6) Asset types** — the admin list is the real blocker.
5. **[AP-278](https://trello.com/c/Ep2oYTY2) Clients** and
   **[AP-285](https://trello.com/c/zFXt4R6D) Entities** — several unstatused gaps each.
6. **[AP-280](https://trello.com/c/ulZEMFGQ) Teams** — the `editTeam` 500 still blocks the main save.

## Card work outstanding

The cards were folded to the 28 Sep decisions; this update supersedes several of those lines. Each
card now needs: the new studio lead+ permission rule, the fixes moved out of Pending into normal
ACs, a regen against `be@f42da1de`, plus per card —

- **AP-281**: project notes section removed entirely (was "read-only list").
- **AP-279**: Remove leader in the leader row menu, with the `userType` drop surfaced.
- **AP-280**: Remove lead in the row menu; controls gated at studio lead+, not team lead+.
- **AP-278** / **AP-285**: clearable fields as real ACs; AP-285 also gets note un-flagging.
- **AP-282**: a follow-up card for drag-to-reorder against the new endpoint.
- **AP-283** and **AP-285** never received the 28 Sep fold — their rewritten bodies were drafted but
  the runs stalled before pushing, so both cards still carry their pre-28 Sep text.
