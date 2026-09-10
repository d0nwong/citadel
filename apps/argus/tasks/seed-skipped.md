# Seed rows skipped

Rules from the old product docs that were not copied into a ledger, because they name code, explain a mechanism, or run past the sentence ceiling. Rewrite each in the team's words and add it with a click or `argus` once Pensieve has the form.


## admin
- **BR-11** (names code): The server's equivalent of "admin access" is checkJwtInternalStudioLead
- **BR-15** (names code): GET /api/v1/users/userInformation is open to every internal user, not just admins

## admin/blocker-tracker
- **BR-14** (names code): toDate must not be earlier than fromDate

## admin/projects
- **BR-4** (names code): A project's monetary value is valueOfProjectInLastMonth parsed as dollars
- **BR-50** (names code): all and isArchived widen the result set — they never narrow it to inactive/archived only
- **BR-53** (names code): isActive is a server-side toggle that ignores any body

## admin/signals
- **BR-17** (names code): The server sends averageCSAT: 0 — never null — when no analysed meeting exists

## admin/subtasks
- **BR-7** ("BR-" is a rule id, and belongs on the evidence line): The leader scope behind BR-5/BR-6 comes from the API, not from local storage
- **BR-11** (names code): The server ignores teamId on the unassigned-projects query
- **BR-15** (names code): The server only lists members who are active, undeleted, internal, and have a non-null firstVisitAt
- **BR-18** (names code): teamId is required in the assign request body

## admin/team-management
- **BR-11** (names code): A group is a team with isGroup: true
- **BR-20** ("tiers" is the system's own dialect): Work capacity is optional; the two tiers disagree on its default

## app-shell
- **BR-14** (names code): The primary studio/team is the one flagged isPrimary, else the first listed
- **BR-54** (names code): Omitting billableQuantity on the task-asset PUT leaves the stored one alone
- **BR-57** (names code): A task update that carries assetTypes rewrites every task-asset row
- **BR-59** (explains the mechanism): Re-log is never enforced server-side, because it calls nothing
- **BR-64** (names code): Each asset line is priced creditWeight × (billableQuantity ?? quantity) × multiplier
- **BR-72** (29 words, over the 25-word ceiling): A task write from this overlay can email the client that its credits are running out — after the save, silently, and with nothing on screen to say so

## application-catalogue
- **BR-1** (names code): Apps-admin level is derived from identity userType: studio-leader, internal-admin, or internal-owner
- **BR-2** (names code): App-management level (create/delete/restore, owner tabs) requires userType leader or any admin type
- **BR-7** (names code): The granted credentials view shows when the server says canViewCredentials OR the caller's request state is granted (owner/admin implicit access is decided server-side)
- **BR-16** (28 words, over the 25-word ceiling): Create-app submit requires: non-empty name, non-empty login URL, a department OR Company-wide, and — for Password apps — at least one credential set with username and password each

## auth
- **BR-11** (names code): Empty firstVisitAt is stored as null

## calendar
- **BR-12** (names code): projectName is a composed server label
- **BR-16** (names code): "My tasks" matches the single assignedUserId the row carries
- **BR-17** (names code): assignedUserId is the primary — or first — active assignee only

## dashboard
- **BR-5** (explains the mechanism): Tab counts are always the filtered list lengths — exactly the rows the tab renders; the Peer Review tab always reports 0 to the widget because it counts itself inside the tab
- **BR-7** (names code): Member/leader filters reset automatically on every tab or nav switch; Alden/studio filters instead persist to the URL (status, sort, teams, studios, users, taskType, priority, q, aq), writing only non-default values
- **BR-9** (26 words, over the 25-word ceiling): Starter views can be renamed, hidden, restored and re-shaped (list/board) but never deleted; the Hide view action is disabled when only one view chip would remain
- **BR-12** (43 words, over the 25-word ceiling): Without the bypass a task can be moved Not Started ↔ In Progress → For Review (For Review goes through a confirmation dialog); Reviewing and Completed are permanently disabled options, and once the task is for-review/reviewing/completed the badge becomes a static read-only pill
- **BR-13** (explains the mechanism): Dashboard tables pass editorScope="full" for subtask badges — any member or lead edits a subtask's status as if they were an assignee, because dashboard rows carry no assignee ids; Completed stays elevated-only via the subtask option rules
- **BR-14** (names code): A task with status draft never gets a status select: the dot / tint / field variants render a static "Draft" chip with a pencil icon, and the icon variant renders the bare pencil glyph alone (tooltip "Draft", accessible name "Status: Draft"). Both draft branches are inert — the button carries no click handler and ignores readOnly
- **BR-15** (30 words, over the 25-word ceiling): The Triage dashboard renders only when the persisted variant is "triage" AND the user is a studio leader, internal admin or internal owner; everyone else always gets the classic dashboard
- **BR-16** (34 words, over the 25-word ceiling): Status widget per role: owner → Global Studio Status (owner-only carousel across to Studio Status), studio-leader/admin → Studio Status (team cards; on the Team nav the member capacity cards instead), leader → Team Capacity. Owner and studio widgets are hidden while the Peer Review tab is active; members get none
- **BR-17** (41 words, over the 25-word ceiling): Dashboard lists tolerate 60s of staleness: a tab click refetches only when that tab's data is stale or older than 60s; status mutations invalidate lazily (badge updates locally, the list refetches on the next tab activation); structural mutations (create/delete/reassign) invalidate eagerly
- **BR-19** (names code): Row click opens the task-detail overlay via ?task= (+?subtask= for subtask rows); Incoming Drafts rows also pass the draft-id list and enable the reject button; Needs Reassignment rows (or rows flagged needsReassignment) pass a reassignment hint; Peer Review rows navigate to /peer-review/$taskId instead
- **BR-20** (names code): The Reassign column exists only on the Unassigned Tasks tab. On a subtask row it calls POST /api/v1/subtasks/subTask/{subTaskId}/reassign; on a task row it posts a task reassignment request. The button shows a spinner and is disabled per-row while pending, and is styled solid/primary when the row is due today
- **BR-21** (names code): Capacity displays turn red when in-use exceeds total capacity (inUse > capacity); the progress bar caps at 100%
- **BR-22** (29 words, over the 25-word ceiling): The task search matches a case-insensitive substring of the project name or entity name only; the Assigned Tasks tab keeps its own separate search box (aq in the URL)
- **BR-24** (names code): Saved views, renames, hidden starters and layouts are stored per scope — role widget + nav (owner-alden, studio-leader-<nav>, leader-<nav>, member-<nav>) — in browser localStorage (dashboard-views-storage, schema v4); a view created on one nav never appears on another and nothing syncs across devices
- **BR-25** (names code): On the Alden/Studio nav the team and studio scope filters are mutually exclusive (setting one clears the other) and are sent to the server as query params, debounced 400ms: the owner sends studiosIds when set, otherwise teamsIds; the studio-leader variant only ever sends teamsIds. Client-side team/studio filtering runs only when no server scope is active
- **BR-26** (names code): A row with no subtaskStatus shows no updates chip. Otherwise a task row renders the server's value — "Update Available" (alert tone) or "Subtask In Progress" — with "Update Available" suppressed when every subtask of the task is completed; a subtask row renders "Subtask Received" regardless of the value
- **BR-28** (names code): Members see the same team dataset as leaders on the Team nav and can edit statuses there — the earlier read-only team view is gone (the readOnlyTeamView config flag survives but no caller sets it); only the badge stage locks (BR-11..BR-14) gate them
- **BR-29** (names code): The owner's dashboard sources are owner-only on the server: GET /api/v1/dashboard/aldenIncomingDrafts, GET /api/v1/dashboard/aldenUnassignedTasks, GET /api/v1/dashboard/aldenTasksToBeReassigned and GET /api/v1/dashboard/aldenTasksSubtasks accept only internal_owner and internal_systems_admin
- **BR-30** (names code): The studio sources are studio-lead-and-above on the server: GET /api/v1/dashboard/studioIncomingDraftTasks, GET /api/v1/dashboard/studioUnassignedTasks, GET /api/v1/dashboard/studioTasksToBeReassigned, GET /api/v1/dashboard/myStudioTasksAndSubtasks, GET /api/v1/dashboard/globalStudioStatus, GET /api/v1/dashboard/studioTeamStatus and GET /api/v1/tasks/reassignment/allDraftTasksThatNeedToBeReassigned accept internal_studio_lead, internal_admin, internal_systems_admin and internal_owner
- **BR-31** (names code): GET /api/v1/dashboard/myTeamLeadDashboard is open to every internal role (checkJwtInternal), not just team leads
- **BR-32** (names code): The server derives a task's subtaskStatus badge as: any subtask reviewing → update-available; else any subtask in_progress or not_started → subtask-in-progress; else empty. not_started does not produce its own value — subtask-received survives only in the function's return type
- **BR-33** (names code): Only the personal/team formatters hard-code subtaskStatus: "subtask-received" on subtask rows — never the task badge derivation
- **BR-34** (names code): The owner and studio services emit subtask rows with no subtaskStatus field at all
- **BR-35** (names code): The team's assigned tasks/subtasks query counts only active assignments: userTask and userSubTasks rows must have isActive: true, and it excludes deleted, archived and draft tasks plus already-completed subtasks (that query's subtask half opts out of the 12h window — the call is commented out in favour of subTaskStatus: { not: "completed" })
- **BR-36** (names code): Reassigning a subtask deactivates every active user-subtask assignment, clears teamId, resets the status to not_started, clears isCompleted / isRead / autoAssigned, applies the not-started scheduling update, releases the assignee's booked capacity when the subtask was capacity-bearing, and recomputes project/client/entity health
- **BR-37** (29 words, over the 25-word ceiling): The same endpoint refuses to reassign a subtask whose status is for_review, reviewing, submitted or completed — HTTP 400 "Cannot reassign a subtask that is in review or completed"
- **BR-38** (names code): PUT /api/v1/tasks/{taskId}/status/{status} sets isInCredit true for in_progress/for_review/reviewing/completed and false otherwise, stamps completedDate + completedBy when the status is completed and resets both to null on every other status, and books or releases the assignee's capacity on the transition. It performs no transition or role check beyond checkJwtInternal
- **BR-39** (names code): Dashboard task lists include completed work for only 12 hours: a task must be non-completed or have completedDate within the last 12h; a subtask must be non-completed or have updatedAt within the last 12h
- **BR-40** (names code): The Reassign button's task branch posts a task reassignment request, which the server gates to team-lead-and-above (checkJwtInternalTeamLead), 404s on a deleted, archived or draft task, then sets needsReassignment: true, isInCredit: false, status → not_started, isRead: false, deactivates every active task reassignment and every active user-task assignment, and releases the booked capacity
- **BR-41** (30 words, over the 25-word ceiling): The real peer-review surface renders only on the owner's Alden widget and on the studio-leader widget while the Studio nav is selected. On the member and team-lead widgets — and on the studio-leader widget's Team/Tasks navs — the Peer Review chip renders the ordinary task table, which has no source feeding it
- **BR-42** (names code): POST /api/v1/subtasks/subTask/{subTaskId}/reassign is open to every internal role (checkJwtInternal) — status is the only precondition (BR-37), role is not
- **BR-43** (names code): The shared status badge has four presentation variants: dot (default — dot + label), tint (adds a wash of the status hue), field (DataDisplayField trigger, used off-dashboard in the subtask modal and task-detail pages) and icon (glyph alone: no label, no chevron, no container; the status name becomes the tooltip and accessible name, and the whole badge drops the fixed table-column width). Every dashboard surface uses dot; icon is passed only by admin-usage's Active and History tables (src/features/usage/components/active-tab/*, .../history-tab/*) and the Storybook stories, and the code marks it "Experimental (Sept 2026)"
- **BR-44** (names code): An inline status change from a dashboard badge can trigger a client-facing credit email: after the write, editTaskStatus and editSubTaskStatus fire a fire-and-forget entity credit-threshold check. It runs only while the work is credit-bearing — the task has isInCredit, status ≠ not_started, and is not archived/deleted/draft; for a subtask additionally isActive and subtask status ≠ not_started. The check emails the entity's primaryBillingEmail the highest threshold reached (50% / 90% / 110%), and only when the entity has sendAutomatedEmails, is onboarded, has a client billingCycleDay, a billing email, and a total base above zero; 50% and 90% send at most once per billing cycle, 110% at most once every 48h. Failures are swallowed and logged — the status write still succeeds
- **BR-45** (names code): GET /api/v1/tasks/{taskId} adds a creditDetail object only for the studio-lead tier (internal_studio_lead, internal_systems_admin, internal_admin, internal_owner, resolved by isStudioLeadOrAbove from the user's userType); for every other internal user the key is absent entirely rather than present-and-empty, and the route itself stays open to all internal roles. The object itemises the task's credits: one line per task_asset (credit weight, worked vs billable quantity, the quantity actually priced, size multiplier, capacity), the asset half both stored (assetCredits = tasks.credits) and recomputed from those lines (derivedAssetCredits) — neither including subtask credits — one line per active subtask that is worth credits (hours, per-hour credit weight and its source, isCreditsEdited), subTaskCredits as their sum, and totalCredits = stored asset half + subTaskCredits. Subtasks whose credits are null or zero are omitted from both the lines and subTaskCredits, and subtasks in studios hidden from the viewer are excluded so the breakdown adds up to what that viewer is shown
- **BR-46** (names code): The threshold percentage behind BR-44 is measured against a total base, not the entity's monthly allowance alone: totalBase = baseCredits + available rollover, where available rollover is the newest invoiceFields row's rolloverCredits (floored at 0) while that row's rolloverCreditsStartDate is set and today's UTC date is on or before that date plus 4 calendar months — 0 when the date is null or the window has closed. The percentage is floor(used ÷ totalBase × 100), and both the email body ("You've used X of Y credits") and the HTML template's credit figure show totalBase. The zero-check that skips the whole email is now on totalBase, and it runs after the billing-cycle-day and billing-email gates rather than before them

## entities
- **BR-23** (names code): creditSummary hides the entities the detail route happily serves — by answering 200 with a null body
- **BR-25** (names code): Entities.isOnboarded is the entity-level switch that says a client may be written to at all
- **BR-26** (names code): Entities.sendAutomatedEmails is the per-entity mute for credit-usage mail — and the monthly invoice run un-mutes it

## entities-meetings

## meetings

## peer-review
- **BR-5** (names code): The review detail returns the task's mandatory review unless isMandatory=false is passed; the frontend never passes it
- **BR-20** (names code): Only the author can edit or delete a comment in the UI (matched on the comment's userId vs the signed-in user)
- **BR-24** (names code): The forensic scans card appears only when the checklist contains an item of type siniScans
- **BR-25** (names code): Forensic images are uploaded to Firebase Storage (peer-review/{answerId}/{beforeUrl or afterUrl}/{timestamp}-{name}) and only then persisted via the API; replaced files are deleted from storage after a successful save
- **BR-29** (names code): The page subtitle is {taskId} · {projectNumber} – {projectName}

## recall-ai-connect

## shared/api-client

## shared/components
- **BR-28** (names code): A third Badge recipe becomes a size variant, not a className
- **BR-43** ("MM-" is a rule id, and belongs on the evidence line): Range values are YYYY-MM-DD strings converted browser-local on both sides of the calendar
- **BR-48** (names code): A breadcrumb level is only clickable if the caller gave it an onClick
- **BR-61** (names code): The filter trigger's summary is derived from allValue, not from that count
- **BR-62** (names code): GroupByPopover is generic over the caller's grouping key, and noneValue is the whole definition of "not grouped"
- **BR-67** ("arc" is the system's own dialect): The arc clamps to 0–100 but the colour does not
- **BR-70** (names code): DataTable takes an inline tableStyle for the width values a class cannot express
- **BR-71** (names code): One caller passes tableStyle, and it is a width floor computed from the data
- **BR-74** (names code): savingIndicator is offered by every field variant's type and honoured by exactly one

## shared/context

## shared/hooks

## shared/http

## shared/stores
- **BR-1** (names code): Role flags are always derived from user.userType, never assigned directly

## tasks
- **BR-7** (names code): The deny-by-default scope resolver (dashboard widget) gives subtask assignees full, parent-task assignees taskParent, everyone else — including a signed-out viewer — readOnly
- **BR-12** (names code): Assigning a person from an assignment row always sends isPrimary: true for that user
- **BR-15** (41 words, over the 25-word ceiling): Create-subtask validation runs in order: custom priority text → studio → creator estimate hours → question answers (zod, per studio question set) → task id; deadline is checked last, after file links persist, and the creator estimate is re-parsed after that
- **BR-18** (names code): Priority is high or low or custom; ASAP presets are a flavour of custom whose label travels in priorityCustom, and priorityCustom is only ever sent with custom
- **BR-21** (names code): An edit-mode studio save sends only studioId; the now-invalid team is corrected by the team save that follows
- **BR-23** (names code): The first assignee ever added to an empty subtask becomes primary; existing assignees keep their isPrimary flag
- **BR-24** (36 words, over the 25-word ceiling): 2.5 capacity units (credits) make one hour. Capacity is the stored unit, hours are the displayed one, and the conversion runs hours = capacity ÷ 2.5 (equivalently capacity = hours × 2.5) — the same direction and the same 2.5 on both sides. A capacity of 25 is 10 hours, not 62.5
- **BR-27** ("tiers" is the system's own dialect): Team load tiers: >100% Overloaded, >75% High, >25% Medium, else Light; zero total with any load counts as Overloaded
- **BR-31** ("BR-" is a rule id, and belongs on the evidence line): A task whose status normalizes to completed opens read-only: its fields, its blockers and comments composers, its Add-subtasks button and its subtask rows are all disabled, and Reject / Rollback / Delete / Update are not rendered. The one exception is the header's Re-log button (BR-68)
- **BR-33** (names code): Neither read-only lock is enforced by the server — POST /api/v1/subtasks/task/{taskId}/subTask, PUT /api/v1/subtasks/task/{taskId}/subTask/{subTaskId} and PUT .../status all accept the write regardless of the task's or subtask's completed state
- **BR-34** (37 words, over the 25-word ceiling): Tasks and subtasks are labelled {id} · {name} wherever they are listed — the id is dropped when it is missing or not a positive number, and a label already carrying its own prefix is left alone
- **BR-35** (42 words, over the 25-word ceiling): The two surfaces that already show the id in their own chrome do not repeat it in the name: the task-detail overlay prints TASK-{id} above a bare title, and the subtask modal prints TASK {id} · {project title} over a stripped title
- **BR-37** (32 words, over the 25-word ceiling): The server refuses to reassign a subtask that is in review or finished — status for_review, reviewing, submitted or completed returns 400 Cannot reassign a subtask that is in review or completed
- **BR-38** (names code): A subtask can only be assigned to a team while it has none — the handler looks the subtask up with teamId: null, so re-teaming an already-assigned subtask 404s
- **BR-39** (names code): Subtask priority is validated on the server too: custom without priorityCustom is rejected, and a non-custom priority carrying priorityCustom is rejected
- **BR-42** (names code): A subtask's credits are its hours × its department's rate, derived subtask → studio → department → the one asset type carrying that department → the client's rate row, falling back to that asset type's defaultCreditWeight; any missing link resolves to zero rather than erroring
- **BR-43** (32 words, over the 25-word ceiling): tasks.credits holds the asset half alone — the figure derived from the task's task_asset rows. The department half lives in sub_tasks.credits and is never copied onto the task; the billable total is derived on read as asset half + the live sum of the task's active subtasks
- **BR-45** (names code): The server derives isCompleted from the status it is given and stamps the actor: for_review records submittedAt/submittedBy, completed records completedAt/completedBy
- **BR-46** (names code): Marking a task "needs reassignment" requires team-lead or above, refuses drafted/archived/deleted tasks, and resets the task: needsReassignment: true, isInCredit: false, status back to not_started, existing reassignment rows deactivated
- **BR-47** (names code): Assigning a reassignment to a team requires the task to be flagged needsReassignment, and the caller to be team lead of the task, studio lead of the task, or an Alden owner/admin/systems-admin
- **BR-48** (names code): A queue row is treated as a subtask when it carries a subtaskId, not only when taskType === "subtask" — and it then always carries queueSubtaskId
- **BR-49** (36 words, over the 25-word ceiling): A subtask cannot ask for more of an asset type than its parent task carries: the task's task_asset quantities are a per-asset-type budget that every active subtask of that task draws down through its quantity answers
- **BR-55** (29 words, over the 25-word ceiling): An asset type a subtask has claimed but the task does not carry still appears in the budget with an allowance of 0, and remaining is floored at 0
- **BR-58** (names code): A task asset carries a separate billable quantity: credits price off billableQuantity when it is set and off quantity when it is null, while capacity always prices off quantity
- **BR-60** (names code): Clearing a task asset's billable quantity hands credits back to the worked quantity as a delta, is skipped entirely when the task's credits were set by hand (isCreditsEdited), leaves capacity untouched, and is a no-op on an asset that has none
- **BR-61** (names code): The reset snapshot stores the two halves apart, and the readers no longer add back the same set. TaskInfoAtReset.creditsAtReset is written as the task's asset half alone; subTaskCreditsAtReset carries the rolled-up credits of every active subtask and each SubTaskInfoAtReset.creditsAtReset carries one subtask's own. The billable total is creditsAtReset plus the nested subtask snapshots — but which nested snapshots depends on the reader (BR-92)
- **BR-62** (47 words, over the 25-word ceiling): A subtask that completes under a still-open parent task is not billed in the cycle it completed in — its credits ride into whichever cycle the parent task completes in; and since be#761 a subtask that has not completed is dropped from the History tab's figure altogether
- **BR-63** (names code): A reset freezes the rate card that priced each subtask, not only the figure it produced — one sub_task_asset_info_at_reset row per subtask snapshot (unique on it), recording the asset type, department, billed hours, creditWeight and creditWeightSource. The rate is no longer safe from later rewriting: since be#769 the correction route overwrites every one of those columns from its body and the catalog (BR-70)
- **BR-64** (44 words, over the 25-word ceiling): The snapshot says where the rate came from: entity_override when the client had an active asset_entity row for that department's asset type, department_default otherwise — and the test is !== null, so a negotiated rate of zero is still an override, not a default
- **BR-66** (names code): The frozen quantity is billed hours (capacity ÷ 2.5, BR-24), not capacity — so quantity × creditWeight reconstructs the subtask's creditsAtReset, except on a subtask whose credits were pinned by hand or whose row has since been corrected
- **BR-67** (names code): The task-asset reset snapshot records billableQuantity beside quantity, and every reader of that row now prefers it: the reset-side billableQuantity ?? quantity and, since be#761, the invoice's own per-asset loads
- **BR-68** (names code): Re-log survives the completed lock but not the opener's read-only flag. The Re-log button is gated on canRelogTask, which tests only the nav store's readOnly and that the task loaded — deliberately not the completed status — while every field, composer and other header action stays on readOnly = navReadOnly or  or isCompleted
- **BR-69** (names code): A task's reset snapshot is editable after the fact, and since be#768 the edit is an upsert keyed on the entity's asset association. /api/v1/history/task-info-at-reset/{taskInfoAtResetId}/assets (PATCH) takes {assetEntityId, quantity} (quantity a number >= 0); it resolves that asset_entity row by id, scoped to the snapshot's own entity and active-and-not-deleted, then finds the snapshot asset row by that association's assetTypeId, else creates one from the association's live creditWeight and its asset type's capacityWeight — then writes the figure to quantity and billableQuantity and recomputes the task snapshot's creditsAtReset as Σ over all its asset rows of (billableQuantity ?? quantity) × assetCredits × multiplier — the asset half only — and stamps isCreditsEditedAtReset: true
- **BR-70** (names code): A subtask's frozen rate-card row is now an upsert keyed on the catalog asset type, and the rate comes from the caller. /api/v1/history/subtask-info-at-reset/{subTaskInfoAtResetId}/assets — since be#769 the second path param is gone — takes {assetTypeId, quantity, creditWeight}, all three required, resolves the catalog AssetTypes row, then overwrites the subtask snapshot's single asset slot (assetTypeId, assetName, assetType, departmentId, departmentName, assetCapacity, creditWeight) or creates one, sets the subtask snapshot's creditsAtReset = quantity × creditWeight and capacityAtReset = quantity × 2.5 (BR-24), then rewrites the parent task snapshot: creditsAtReset → its asset half, subTaskCreditsAtReset → the sum of all sibling subtask snapshots, both isCreditsEditedAtReset → true
- **BR-71** (names code): A task-snapshot quantity edit writes the same figure into quantity and billableQuantity, collapsing the billed-vs-worked distinction on that row
- **BR-72** (names code): TaskInfoAtReset.isCreditsEditedAtReset is written but no longer read for billing. be#755 deleted the only consumer that branched on it, so its two incompatible meanings — "the live task's credits were pinned by hand" (written at reset) and "creditsAtReset is asset-only" (written by both edit routes) — no longer collide anywhere on the billing path
- **BR-73** (names code): The rate-card audit trail has readers on both sides: each subtask snapshot's asset row is selected by entityResetHistorySelect, returned by the billing-cycle history read as {subTaskAssetInfoAtResetId, assetTypeId, assetTypeName, assetTypeQuantity}, and normalised by formatEntityResetHistory / mergePeriodProjectsLatestWins into an invoice load line as {assetName, quantity, assetCredits: creditWeight, multiplier: 1}. Since be#769 the billing-cycle read drops any subtask whose snapshot has no asset row, labels the ones it keeps with their studio, and adds a per-project catalog rollup
- **BR-74** (names code): Snapshots written before the be#755 cutover are double-counted. Their creditsAtReset still holds asset half plus the department half, and both readers now add the subtask snapshots on top of it unconditionally (BR-61, BR-72)
- **BR-76** (30 words, over the 25-word ceiling): Capacity precedence is final ?? assignee ?? creator, then the questionnaire, then zero — and the test is strictly !== null, never "greater than zero", so a later stage answering zero wins over an earlier stage's estimate
- **BR-77** (29 words, over the 25-word ceiling): The questionnaire derives capacity only from answered quantity questions that are mapped to an asset type, and the weight comes from that asset type's capacity_weight, not from the question
- **BR-78** (30 words, over the 25-word ceiling): The multiplier is a product with identity 1: the ticked multiplier questions' asset-type weights multiplied together, so an unanswered multiplier question contributes nothing instead of collapsing the subtask to zero
- **BR-79** (36 words, over the 25-word ceiling): A multiplier scales a typed figure exactly as it scales a derived one: capacity = base × multiplier, whoever supplied the base — so what a capacity endpoint returns need not be what the caller sent
- **BR-80** (names code): Four different writes pin a subtask. PUT …/capacity, PUT …/hours and PUT …/dailyCapacity all write final_capacity, and the subtask edit body's capacity field does too — so any of them sets capacity_source = entered and is_capacity_edited = true and takes the subtask off its department's questionnaire permanently
- **BR-81** (names code): A daily-capacity write is stored as the capacity it implies — workingDays × dailyCapacity — and the resolver derives the daily split back out of it; with no working days the two are the same number
- **BR-82** (29 words, over the 25-word ceiling): The daily split is only recomputed while a subtask is capacity-bearing — in_progress, for_review or reviewing and not completed; a parked or finished subtask keeps the daily_capacity it had
- **BR-83** (names code): Every capacity figure may be sent in hours instead of capacity units, but never both — and since be#762 that includes the create. The three staged PUTs take xor(<capacityField>, hours); the subtask edit body takes nand pairs on capacity/hours, creatorsEstimatedCapacity/creatorsEstimatedHours, assigneesEstimatedCapacity/assigneesEstimatedHours; the create body takes a nand pair on creatorsEstimatedCapacity/creatorsEstimatedHours (BR-88). Hours convert at 2.5 (BR-24) before anything is stored
- **BR-84** (names code): A capacity resolve that fails after its input already landed is swallowed, not surfaced. The four capacity PUTs and the status/deadline paths call applySubTaskCapacitySafely, which logs and returns; the subtask create calls the throwing form inside its transaction (so a failure rolls the create back), and the subtask edit calls the throwing form outside one
- **BR-86** (names code): The capacity check answers why a figure is what it is: /api/v1/subtasks/capacityCheck/{subTaskId} returns {capacity, baseCapacity, derivedCapacity, multiplier, capacitySource} and writes nothing
- **BR-87** (names code): The reset snapshot records the whole capacity breakdown, nulls and all, and every field of it is on the wire. SubTaskInfoAtReset now carries derivedCapacityAtReset (the renamed estimated_capacity), finalCapacityAtReset, baseCapacityAtReset, capacityMultiplierAtReset and capacitySourceAtReset; the three estimate/derived columns dropped NOT NULL DEFAULT 0, so "never estimated" and "estimated zero" are finally distinguishable
- **BR-88** (names code): A subtask can be priced at creation. POST /api/v1/subtasks/task/{taskId}/subTask accepts the creator's estimate as creatorsEstimatedCapacity or creatorsEstimatedHours (BR-83), writes it onto the row inside the create transaction, and only then resolves capacity — so the subtask has a figure and credits from the moment it exists rather than at its first capacity edit
- **BR-89** (names code): The subtask create and edit responses echo subtaskHours — the resolved capacity ÷ 2.5, not the figure that was sent
- **BR-90** (names code): The subtask read echoes every capacity figure in hours. GET /api/v1/subtasks/task/{taskId}/subTask/{subTaskId} returns subtaskHours, finalHours, derivedHours, creatorsEstimatedHours, assigneesEstimatedHours and dailyCapacityHours alongside their capacity twins, all at 2.5 (BR-24)
- **BR-91** (names code): The frozen base and multiplier are resolved at reset time, not copied from the row — so base × multiplier need not equal capacityAtReset
- **BR-92** (names code): The two readers of the reset snapshot disagree about incomplete subtasks — and since be#769 the billing-cycle read hides a second population it still counts. The read counts and lists only subtask snapshots flagged isCompleted; the invoice generator counts every subtask snapshot under a completed parent task; and the read then omits from subtasks[] any completed subtask with no asset row while leaving its credits in the total
- **BR-93** (names code): Each hours stage owns one column and one endpoint, and the unit on the wire is hours. Creator Estimate Hours → PUT …/creatorsEstimatedCapacity, Assignee Estimated Hours → PUT …/assigneesEstimatedCapacity, Final Approved Hours → PUT …/hours — each sending { hours } and each reading its own *Hours field off GET-one (BR-90)
- **BR-96** (names code): creditDetail is a leadership field: studio lead and above, or the key is absent. The tier is internal_studio_lead, internal_systems_admin, internal_admin, internal_owner — the same set checkJwtInternalStudioLead admits
- **BR-97** (names code): creditDetail's subtask half is a third population, different from both existing ones: an active subtask whose credits is neither null nor zero, minus the studios the viewer may not see
- **BR-98** (names code): Each half of creditDetail is published stored beside derived, and the headline total uses the stored one. assetCredits is tasks.credits; derivedAssetCredits is Σ over the asset lines of creditWeight × (billableQuantity ?? quantity) × sizeMultiplier; neither contains subtask credits. capacity / derivedCapacity pair the same way, with capacity always priced off quantity (BR-58). totalCredits = stored assetCredits + subTaskCredits
- **BR-99** (names code): The task-detail overlay renders creditDetail as a collapsible read-only Credits section at the foot of the metadata rail, and only for a non-draft task that actually carries the field
- **BR-100** (names code): Six subtask writes can email the client that its credits are running out — after the save, silently, and with nothing on screen to say so. A successful write through PUT /api/v1/subtasks/task/{taskId}/subTask/{subTaskId} (the modal's Save), …/status (the status select and every board drop), …/credits, …/resetCredits, …/activateToggle, or PUT /api/v1/subtasks/department/{departmentId}/repriceCredits fires a credit-usage check on the parent task's entity
