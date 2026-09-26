ADMIN PAGE REVAMP - BE BRIEF
8 write-ups, one per admin page. Each block below is standalone, copy it into Slack on its own.

Permission guards used throughout:
  checkJwtInternal            any internal user
  checkJwtInternalTeamLead    team lead and above
  checkJwtInternalStudioLead  studio lead and above
  checkJwtInternalAdmin       admin / owner / systems admin

All routes are under /api/v1. Swagger is live in non-prod at /api-docs.

Two gaps flagged in an earlier draft are now FIXED in the backend and marked as such below:
questionnaire delete / add-option (write-up 7) and asset type department binding (write-up 8).
Both need the pending migration deployed before the endpoints work against a given environment.


================================================================================
1 of 8 - CLIENTS
================================================================================

ADMIN PAGE: CLIENTS

What it is
A client is the top-level company record. It owns entities, and entities own projects.
The client record itself is mostly identity + tier + who from our side looks after it.
Money, credits and asset rates do NOT live here - they live on the entity.

Fields that need to be editable
  name                    required, unique
  code                    alphanumeric, 2-10 chars, unique
  logoUrl                 must be a valid URL
  emailDomain             used to auto-match inbound email to the client
  companyWebsite
  industry
  cityId                  dropdown from cities
  billingCycleDay         1-31, nullable. Day of month the billing cycle rolls
  clientTier              small / standard / major / important / very_important
                          (legacy values regular, enterprise, standard_plus still accepted)
  defaultClientStandard   high / standard / low
  projectHealthId         dropdown from project_health

Toggles (each is its own endpoint, each flips the current value)
  isOnboarded
  isArchived
  isDeleted
  isActive        via deactivate / activate, NOT a simple flag - see rules below

How it works / rules
- clientTier is normally auto-calculated from the sum of active entity invoice amounts
  (thresholds: <2000 small, <5000 standard, <10000 major, <20000 important, else very_important).
  The field is still manually editable as an override, but it gets recalculated whenever an
  entity's retainer amount or active status changes. Make it clear in the UI that it is an
  override, not a stable value.
- defaultClientStandard only SEEDS new projects. Existing projects keep whatever they have.
  The standard itself scales capacity only (high x1.5, standard x1, low x0.8), and only for
  studios that have appliesClientStandards turned on. It never changes what the client is billed.
- Deactivating a client is a heavy cascade, not a flag. Call GET /clients/:id/deactivationSummary
  first and show the user what is about to happen (entities, projects, open tasks, assignees)
  before calling PATCH /clients/:id/deactivate.
- deleteClientToggle, onboardClientToggle and archiveClientToggle all also reset
  projectHealthId to 1 and stamp lastUpdatedHealth. That is intentional but surprising.

Tables touched
  clients                  the main record
  client_members           bridge, client <-> users (isPrimary, isActive)
  cities                   lookup for cityId
  project_health           lookup for projectHealthId
  roles                    client-scoped roles for external users
  software_clients         bridge, client <-> software versions
  entities                 children, edited on their own page

Endpoints
  GET    /clients                          list
  GET    /clients/overview                 list for overview cards
  GET    /clients/:id                      single
  GET    /clients/:id/form                 the edit form payload
  GET    /clients/:id/entities             child entities
  GET    /clients/:id/members              members
  GET    /clients/:clientId/entitynotes    notes rolled up from entities
  GET    /clients/archived                 archived list
  GET    /clients/deactivated              deactivated list
  POST   /clients                          create (studio lead+)
  PUT    /clients/:id                      edit (studio lead+)
  PUT    /clients/:id/add/:userId          add member, body { isPrimary } or { userArray }
  DELETE /clients/:id/remove/:userId       remove member
  PATCH  /clients/:id/onboard              toggle isOnboarded
  PATCH  /clients/:id/archive              toggle isArchived
  DELETE /clients/:id                      toggle isDeleted
  GET    /clients/:id/deactivationSummary  preview before deactivating
  PATCH  /clients/:id/deactivate           cascade deactivate
  PATCH  /clients/:id/activate             cascade reactivate

BE work needed
- Fields cannot be cleared. The edit controller uses truthiness, so sending "" or null for
  emailDomain, industry, companyWebsite etc. leaves the old value in place. If FE needs a
  clear-field action we need to change the controller to check for undefined instead.
- No endpoint to edit an existing client member's isPrimary flag - only add and remove.


================================================================================
2 of 8 - ENTITIES
================================================================================

ADMIN PAGE: ENTITIES

What it is
The entity is the billable unit under a client. Credits, the asset rate card, billing type,
temp credits, notes and files all live here. This is the biggest admin surface of the eight.

Fields that need to be editable
  name                required, unique
  legalName
  code                alphanumeric, 2-10, unique per client
  baseCredits         decimal, the monthly credit allowance
  billingType         flat_rate / project_prorata / per_image / monthly / n_a
  projectHealthId     dropdown from project_health
  monthlyRetainer     decimal - writes to invoice_fields.amount, NOT to entities
  assetTypes[]        the asset rate card, see below

Toggles
  isArchived          PATCH /entity/:id/archive
  isDeleted           DELETE /entity/:id
  isOnboarded         PATCH /entity/:entityId/toggleIsOnboarded
  sendAutomatedEmails PATCH /entity/:entityId/toggleSendAutomatedEmails
  isActive            via deactivate / activate, cascade - see rules

Sub-editors on the same page
  Asset rate card     one row per asset type, each with a creditWeight and an optional name.
                      Drives what the client pays per unit of that asset.
  Size multipliers    many-to-many with size_multiplier. Add/remove only, no edit.
  Temp credits        extra credits for a given month + year, with an approval status
                      (pending / approved / rejected).
  Notes               rich notes with isStarred, isClientNote, and file attachments.
  Files               entity-level file attachments, separate from note attachments.

How it works / rules
- IMPORTANT: sending assetTypes[] on PUT /entity/:id is a FULL REPLACE. Any asset row you
  leave out of the array is soft-deleted. The FE must always send the complete current list,
  not a delta. Department rate rows are the one exception - they are excluded from the
  reconciliation and managed elsewhere.
- You cannot change assetTypeId on an existing asset row. Remove it and add a new one.
- A department-backed asset type is limited to ONE live row per entity. Adding a second is
  rejected with a 400.
- isValid is derived, not editable. It is true only when legalName is set AND baseCredits != 0
  AND the invoice field amount != 0. Show it as a read-only completeness indicator.
- Editing an entity also: recalculates the parent client's tier, re-syncs the invoice field
  setup status, and recalculates client health. Changing monthlyRetainer additionally
  recalculates task priorities for the whole entity. Expect the response to be slow-ish.
- Credit rate resolution for a subtask is: subtask -> studio -> department -> that department's
  asset type -> this entity's asset_entity row. If the entity has no row, the asset type's
  defaultCreditWeight applies. If neither exists, the department simply does not bill.
- Automated credit emails fire at thresholds (50% etc) and are logged in entity_automated_emails.
  sendAutomatedEmails gates them.
- Like clients, deactivation is a cascade. Call GET /entity/:id/deactivationSummary first.

Tables touched
  entities                   main record
  asset_entity               the rate card rows (assetTypeId, creditWeight, name, isActive)
  asset_types                lookup for the rate card
  multiplier_entities        bridge, entity <-> size_multiplier
  size_multiplier            lookup
  temp_credits               credits, month, year, submittedBy, approvedBy, status
  entity_notes               notes
  entity_notes_files         note attachments
  entity_files               entity-level files
  entity_automated_emails    credit threshold email log
  invoice_fields             monthlyRetainer / amount, billing address, recipient emails
  software_entity            bridge, entity <-> software versions
  project_health             lookup

Endpoints
  GET    /entity                                     list
  GET    /entity/:id                                 single
  GET    /entity/:id/form                            edit form payload
  GET    /entity/:id/creditSummary                   credits + projects + tasks rollup
  POST   /entity                                     create (studio lead+)
  PUT    /entity/:id                                 edit (studio lead+)
  DELETE /entity/:id                                 toggle isDeleted
  PATCH  /entity/:id/archive                         toggle isArchived
  PATCH  /entity/:entityId/toggleIsOnboarded
  PATCH  /entity/:entityId/toggleSendAutomatedEmails
  GET    /entity/:id/deactivationSummary
  PATCH  /entity/:id/deactivate
  PATCH  /entity/:id/activate

  Asset rate card
  GET    /entity/:id/assets
  POST   /entity/:id/asset/:assetTypeId              body { creditWeight, name }
  PUT    /entity/:id/assets/:assetEntityId
  DELETE /entity/:id/assets/:assetEntityId

  Size multipliers
  GET    /entity/:id/multipliers
  POST   /entity/:id/multiplier/:multiplierId
  DELETE /entity/:id/multiplier/:multiplierId

  Temp credits
  POST   /entity/:id/tempCredit                      body { credits, month, year, status }
  PUT    /entity/:id/tempCredit/:tempCreditId
  DELETE /entity/:id/tempCredit/:tempCreditId

  Notes and files
  POST   /entity/:id/notes
  GET    /entity/notes/:id
  PUT    /entity/notes/:id
  PUT    /entity/notes/:id/starToggle
  DELETE /entity/notes/:id
  POST   /entity/:entityId/files
  GET    /entity/:entityId/files
  PUT    /entity/files/:entityFileId
  DELETE /entity/files/:entityFileId

BE work needed
- monthlyRetainer is in the entity edit payload but actually writes to invoice_fields.amount.
  Confusing. Either rename it or move it onto a proper billing sub-form.
- The full-replace behaviour of assetTypes[] is undocumented and dangerous. If FE would rather
  do add/edit/remove per row, the per-row endpoints above already exist - consider using those
  and dropping assetTypes[] from the main PUT.
- Same clear-field problem as clients: legalName, code etc cannot be blanked out.


================================================================================
3 of 8 - STUDIOS
================================================================================

ADMIN PAGE: STUDIOS

What it is
A studio is a production unit inside a department, in a city, with a head and leaders,
containing teams. Its department is what decides which questionnaire its subtasks answer.

Fields that need to be editable
  name                    required, 3-100 chars, unique
  code                    alphanumeric, 2-10, unique
  departmentId            required on create. Decides the questionnaire and the rate card
  cityId                  required on create
  studioHeadId            assigns a studio leader, see rules
  colorId                 edit only, not settable on create
  appliesClientStandards  boolean, see rules

Toggles
  isDeleted   DELETE /studios/:studioId

The questions section
This is the part that trips people up: questions are NOT attached to the studio. They hang off
the studio's DEPARTMENT. Two studios in the same department share one questionnaire, and
changing a question changes it for every studio in that department. The UI should say so.
GET /questionAnswers/studio/:studioId/questions returns { studio, questions, teams } - it
resolves the department for you. Full question editing is covered in the Departments write-up.

How it works / rules
- appliesClientStandards is the entire opt-in for client standards. A studio with it off reads
  a multiplier of 1 no matter what the project says. Turning it on, or changing departmentId,
  triggers a reprice of that studio's open capacity (applyStudioClientStandards). Warn the user.
- studioHeadId on the edit payload does NOT just set the column - it calls assignStudioLeader,
  which creates or reactivates a studio_leaders row and demotes any existing primary leader.
  studios.studio_head_id is legacy and only used as a display fallback.
- Studio restrictions: studio_restrictions lets one studio be hidden from members of another.
  It is applied on almost every list endpoint (getHiddenStudioIdsForUser) so what a user sees
  depends on which studios their teams belong to.
- Rendering is special-cased for capacity: subtasks in the Rendering department get an extra
  file-size band multiplier. No other department does.

Tables touched
  studios               main record
  studio_leaders        leaders, with isPrimary and isActive
  studio_restrictions   visibility rules - NO API, see gaps
  departments           lookup, drives questions and rate card
  cities                lookup
  colors                lookup
  teams                 children
  questions             via department

Endpoints
  GET    /studios                              list
  GET    /studios/admin                        admin list
  GET    /studios/:studioId                    single
  GET    /studios/:studioId/teams
  GET    /studios/:studioId/users
  GET    /studios/:studioId/usersTeams
  GET    /studios/chart                        all studios chart data
  GET    /studios/:studioId/chart
  GET    /studios/workload/all
  GET    /studios/workload/:studioId
  POST   /studios                              create (studio lead+)
  PUT    /studios/:studioId                    edit (studio lead+)
  POST   /studios/:studioId/add/studioHead/:userId   assign leader, ?isPrimary=true
  DELETE /studios/:studioId                    toggle isDeleted
  GET    /questionAnswers/studio/:studioId/questions  the questionnaire

BE work needed
- No endpoint to remove or deactivate a studio leader. Only add. If the admin page needs a
  leader list with remove, we have to build it.
- studio_restrictions has no API at all - rows are DB-only today. If admins should manage
  studio visibility from the UI, that is a new set of endpoints.
- colorId is editable but not settable on create - it is commented out of the create schema.


================================================================================
4 of 8 - TEAMS (AND GROUPS)
================================================================================

ADMIN PAGE: TEAMS AND GROUPS

What it is
One table, two things. isGroup = false is a real production team that sits under a studio and
gets assigned to projects. isGroup = true is a loose grouping with different membership rules.
The UI should treat them as two tabs off the same editor.

Fields that need to be editable
  name          required, unique
  code          alphanumeric, 2-10, unique
  studioId      which studio the team sits under
  cityId        required on create
  teamLeadId    assigns a team leader, see rules
  colorId       edit only, not on create
  isGroup       CREATE ONLY - cannot be changed after the fact

Toggles
  isDeleted     DELETE /teams/:teamId

Membership
  Add member, remove member, and toggle a member active/inactive. Members are team_members rows
  with joinedAt, leftAt and isActive rather than hard deletes.

How it works / rules
- A user can be in exactly ONE non-group team at a time. Adding them to a second is rejected
  with "user already a member". Groups are unrestricted except you cannot join the same group
  twice. The add-member call needs ?isGroup=true when adding to a group.
- Assigning a team lead does four things in one transaction: creates/reactivates the
  team_leaders row, promotes the user's userType from internal to internal_team_lead, deactivates
  their membership of every OTHER non-group team, and adds them to this team as a member if they
  are not already. That is a lot of side effects for one click - surface it in a confirm dialog.
- A user must have logged in at least once (firstVisitAt is set) before they can be made a
  team lead.
- teams.team_lead_id is legacy. team_leaders is canonical, with isPrimary then oldest-created
  as the tie-break.
- Studio restrictions apply to team lists too - a user will not see teams belonging to studios
  hidden from them.

Tables touched
  teams                    main record
  team_members             membership, isActive / joinedAt / leftAt
  team_leaders             leaders, isPrimary / isActive
  studios                  lookup
  cities                   lookup
  colors                   lookup
  project_team             bridge, team <-> projects
  preferred_subtask_user   bridge, user <-> project <-> team
  user_roles               roles can be scoped to a team

Endpoints
  GET    /teams                                list (non-group only)
  GET    /teams/admin                          admin list
  GET    /teams/groups                         groups list
  GET    /teams/groups/admin                   groups admin list
  GET    /teams/:teamId                        single
  GET    /teams/:teamId/admin                  single, admin payload
  GET    /teams/leaders                        all team leaders
  GET    /teams/unassigned/InternalUsers       users not in any team
  POST   /teams                                create
  PUT    /teams/:teamId                        edit
  POST   /teams/:teamId/add/:userId            add member, ?isGroup=true for groups
  POST   /teams/:teamId/add/teamLead/:userId   assign lead, ?isPrimary=true
  DELETE /teams/:teamId/remove/:userId         remove member
  PUT    /teams/:teamId/toggleActive/:userId   toggle member active
  DELETE /teams/:teamId                        toggle isDeleted

BE work needed
- No endpoint to remove or demote a team leader, same gap as studios.
- isGroup is not editable after create. If admins need to convert a group to a team we need
  to build it, and decide what happens to the one-team-per-user rule when they do.
- Any internal user can create, edit and delete teams (checkJwtInternal). If that should be
  team lead and above, it is a one-line change - tell us.


================================================================================
5 of 8 - USERS
================================================================================

ADMIN PAGE: USERS

What it is
The people record. Identity, type, capacity, status, and the role assignments that drive what
external users can see. Authentication itself lives in Auth0 - this table mirrors it.

Fields that need to be editable
  firstName
  lastName
  userType      internal / internal_team_lead / internal_studio_lead / internal_systems_admin /
                internal_admin / internal_owner / external
  workCapacity  decimal - the ceiling. Has its own dedicated endpoint too
  status        active / inactive / suspended / pending_verification
  cityId        dropdown from cities
  language      defaults to "en"

Read-only, do NOT put in the form
  email             unique, set at creation, tied to Auth0
  auth0Id           set by the auth flow
  currentCapacity   calculated from assigned tasks and subtasks, never typed in
  firstVisitAt      stamped on first login, gates team/studio lead assignment
  needsGmailReauth  set by the Gmail integration when a refresh token dies. Worth surfacing
                    as a warning badge with a re-connect action

Toggles
  isDeleted   DELETE /users/:userId

Role assignment
Roles are client- and entity-scoped and mainly matter for external users. A user_roles row
carries roleId, optional teamId, assignedBy, validFrom and validUntil - roles can expire.
The page needs add, edit (which really means changing teamId / validUntil) and remove.

How it works / rules
- Users are created through the auth flow, not the users router: POST /auth/createUser or
  POST /auth/createMultipleUsers. Creation can also attach them to a team, studio or client and
  flag them as a lead in the same call.
- userType is not purely a form field. Assigning someone as a team lead or studio lead
  auto-promotes them from internal to internal_team_lead. Editing userType back down by hand
  does not remove their leader rows - the two can drift apart.
- workCapacity is the ceiling; currentCapacity is what is consumed. Capacity units convert to
  hours at 2.5 units per hour if the UI wants to show hours.
- firstTimeLogin (PUT /users/:userId/firstTimeLogin) is the onboarding form, not an admin
  action - it sets name, city, language and password in one go.

Tables touched
  users             main record
  user_roles        role assignments, with validUntil
  roles             lookup, client/entity scoped
  team_members      which team they are in
  team_leaders      where they lead
  studio_leaders    where they lead
  client_members    which clients they look after
  cities            lookup
  colors            lookup for colorId
  app_credentials   Gmail and other integration tokens

Endpoints
  GET    /users                                          list
  GET    /users/internal                                 internal only
  GET    /users/userInformation                          the logged-in user
  GET    /users/:userId                                  single
  GET    /users/available/internal/studioLeaders         eligible studio leads
  GET    /users/available/internal/teamLeaders           eligible team leads
  GET    /users/available/groupLeaders                   eligible group leads
  PUT    /users/:userId                                  edit
  PUT    /users/:userId/workCapacity                     capacity only
  PUT    /users/:userId/firstTimeLogin                   onboarding form
  DELETE /users/:userId                                  toggle isDeleted
  POST   /users/:userId/roleToUser/:roleId               add role
  PUT    /users/:userId/updateUserRole/:roleId           edit role assignment
  DELETE /users/:userId/removeRoleFromUser/:roleId       remove role
  POST   /auth/createUser                                create one
  POST   /auth/createMultipleUsers                       bulk create

BE work needed
- colorId is not in the edit payload. It can only be set at bulk-create time. If the admin page
  should let you change a user's colour, we need to add it.
- Any internal user can edit any other user, including promoting them to owner
  (checkJwtInternal on PUT /users/:userId). That should almost certainly be admin-only.
  Flagging it now so FE does not build a UI that assumes it is locked down.
- No endpoint to deactivate a user's Auth0 account - status here and Auth0 can drift.


================================================================================
6 of 8 - PROJECTS
================================================================================

ADMIN PAGE: PROJECTS

What it is
A project sits under an entity (and therefore a client), is worked by a team, and holds the
tasks. Most of the admin surface is about which team owns it and how it is priced.

Fields that need to be editable
  name
  status                 pending / in_progress / completed / reviewing
  miroBoardUrlExternal   required on create, must be a valid URL
  miroBoardUrlInternal   optional
  imageUrl
  colorId
  projectHealthId
  teamId                 reassigns the primary team, see rules
  entityId               moves the project to another entity, see rules
  clientStandard         high / standard / low
  isHeavy + heavyDate    heavy flag with an optional date

Read-only / generated
  number     GET /projects/nextProjectNumber/:teamId suggests the next one
  code       derived from the team's department: Rendering R, Software Engineering SE,
             Drafting D, Modeling M, 3D Printing 3D
  clientId   derived from the entity, never set directly

Toggles
  isActive     PUT /projects/:projectId/isActive
  isArchived   DELETE /projects/:projectId

Sub-editors
  Teams                  a project can carry several project_team rows, one primary
  Preferred subtask user a per-project, per-team preferred assignee, with a manualOverride flag
  Notes                  project_notes, optionally scoped to a department, with isStarred

How it works / rules
- Changing clientStandard reprices the project's open, underived capacity. It only affects
  studios that have appliesClientStandards on, and it never changes billing. Warn on change.
- New projects inherit clientStandard from the client's defaultClientStandard. Existing ones
  keep their own.
- Passing teamId on PUT deactivates every existing project_team row and creates a new primary
  one. It is a replace, not an add. Use the addTeam / removeTeam endpoints if you want several.
- Moving a project between entities has its own endpoint with a guard - the target entity must
  belong to the same client. PUT /projects/:projectId/reassignToEntity/:entityId.
- The project number generator takes the highest existing number and adds one, globally, not
  per team. It is fragile. Treat the suggestion as a default the user can overwrite.

Tables touched
  projects                 main record
  project_team             bridge, project <-> teams, isPrimary / isActive
  project_notes            notes, optionally department-scoped
  preferred_subtask_user   preferred assignee per project+team
  entities                 parent
  clients                  derived from entity
  project_health           lookup
  colors                   lookup
  tasks                    children
  project_info_at_reset    monthly snapshot, read-only

Endpoints
  GET    /projects                                   list
  GET    /projects/:projectId                        single
  GET    /projects/entity/:entityId                  by entity
  GET    /projects/:projectId/notes
  GET    /projects/:projectId/assignableTeamUsers
  GET    /projects/nextProjectNumber/:teamId         suggested number + code
  GET    /projects/similarProjects/:name/entity/:entityId   duplicate check
  GET    /projects/orphanedProjects                  no team assigned
  GET    /projects/projectsWithoutPreferredSubtaskUser
  POST   /projects                                   create
  PUT    /projects/:projectId                        edit
  PUT    /projects/:projectId/status                 status only
  PUT    /projects/:projectId/isActive               toggle active
  PUT    /projects/:projectId/isHeavy                set heavy + date
  PUT    /projects/:projectId/isNotHeavy             clear heavy
  PUT    /projects/:projectId/projectHealthReset
  PUT    /projects/:projectId/reassignToEntity/:entityId   (studio lead+)
  DELETE /projects/:projectId                        toggle isArchived (team lead+)
  POST   /projects/:projectId/addTeam/:teamId
  DELETE /projects/:projectId/removeTeam/:teamId
  DELETE /projects/:projectId/removeAllTeams
  POST   /projects/:projectId/addPreferredSubtaskUser/:userId   body { teamId }
  DELETE /projects/:projectId/removePreferredSubtaskUser/:userId
  PUT    /projects/toggleManualOverrideForPreferredSubtaskUser/:relationId

BE work needed
- BUG, please design around it until fixed: PUT /projects/:projectId resets projectHealthId to 1
  whenever projectHealthId is omitted from the body. So any partial edit silently wipes project
  health. Either FE always sends the current projectHealthId, or we fix the controller. I would
  rather we fix it - flag it and we will.
- miroBoardUrlInternal and heavyDate cannot be cleared once set (truthiness check again).
- There is no create-project-note endpoint, only GET. If the admin page needs to add notes we
  have to build it.


================================================================================
7 of 8 - DEPARTMENTS AND THE QUESTIONNAIRE
================================================================================

ADMIN PAGE: DEPARTMENTS (AND STUDIO QUESTIONS)

What it is
A department owns two things that matter a lot: the questionnaire that every subtask in its
studios answers, and the capacity model that decides whether capacity is derived from that
questionnaire or typed in by hand. This is where "editing studio questions" actually happens.

Department fields that need to be editable
  name                    required, 3-100 chars
  colorId
  subTaskCapacityModel    questionnaire / direct_entry

Question fields that need to be editable
  name
  type                  textbox / file / date / dateTime / quantity / dimensions /
                        radio / checkbox. CREATE ONLY - not editable afterwards
  position              ordering in the form
  isRequired
  isMultiplier          see rules, this is the important one
  assetTypeId           quantity questions only - links the question to an asset type
  isCustom
  workCapacityBase      still editable, but DEAD - see gaps

Delete / restore
  isDeleted             DELETE /questionAnswers/question/:questionId - a toggle, see rules

Per-type detail, each with its own edit endpoint
  question_text         name
  question_date         name, captureTime
  question_quantity     name, quantifier, minValue, maxValue
  question_dimensions   name, and capture/min/max for height, width and length independently
  question_options      radio and checkbox options - name, position, isCustom, isDeleted.
                        Options can now be added to an existing question and retired individually.

How it works / rules
- Studio -> department -> questions. Editing a question changes it for EVERY studio in that
  department. This must be obvious in the UI.
- subTaskCapacityModel decides where a subtask's capacity comes from:
    questionnaire  = derived from the answers, until a person overrides it
    direct_entry   = there is no derived figure, only what people type
  The model is frozen onto the subtask at creation, so changing it does not retroactively
  rewrite open work.
- Capacity precedence on a subtask, highest first:
    finalCapacity (studio lead at review) > assigneesEstimatedCapacity >
    creatorsEstimatedCapacity > derivedCapacity (the questionnaire)
  They are never summed. One wins.
- Derived capacity = sum over answered quantity questions of
    (that question's asset type capacityWeight) x (the answered value)
  An unanswered question contributes zero.
- Multiplier questions then multiply on top. A ticked multiplier contributes its asset type's
  capacityWeight. A checkbox applies its factor ONCE regardless of how many boxes are ticked.
  An untouched multiplier contributes 1, not 0. A multiplier whose asset type has a weight of
  zero or less is ignored and logged as a warning.
- So: the number that drives capacity is on the ASSET TYPE, not on the question. A question
  without an assetTypeId contributes nothing to capacity at all. The question editor should
  make the asset type link prominent and warn when a quantity or multiplier question has none.
- Quantity questions also draw down the parent task's asset budget - a subtask cannot ask for
  more of an asset type than the task carries. Over-asking returns a 400.
- Deleting a question is a SOFT delete and a toggle - calling DELETE again restores it. The rule
  is deliberately asymmetric, and the UI should say so:
    * a deleted question disappears from the department questionnaire, the studio questionnaire
      and the subtask form, and can no longer be answered (the API returns 400 if something tries);
    * answers it already has are left exactly as they are and keep counting towards subtask
      capacity and credits.
  That second half is on purpose. Capacity is recalculated whenever a subtask's answers change,
  so dropping a retired question from the maths would silently reduce open work's capacity and
  credits the next time anyone edited an unrelated answer. Retiring a question stops it collecting
  NEW answers; it does not reprice work that is already underway. New subtasks are unaffected
  either way since they can never answer it.
- Deleting an option works the same way: it drops out of the form and can no longer be selected,
  but subtasks that already picked it keep their answer.
- department_review_details holds the review checklist per department (name, type, description,
  good/bad example URLs, position, isDefault, isActive). Read-only via API today.

Tables touched
  departments             main record, incl subTaskCapacityModel
  questions               the questionnaire, now with isDeleted
  question_options        radio / checkbox options, now with isDeleted
  question_text           textbox detail
  question_date           date detail, captureTime
  question_quantity       quantity detail, quantifier + min/max
  question_dimensions     dimensions detail, per-axis capture + min/max
  asset_types             where capacityWeight actually lives
  review_details          per-department review checklist
  department_leaders      exists but unused, see gaps
  studios                 children
  colors                  lookup
  answer_* tables         the answers, written by the subtask flow not by admin

Endpoints
  GET    /departments                                     list
  GET    /departments/:id                                 single
  GET    /departments/:id/studios
  GET    /departments/:id/teams
  GET    /departments/chart
  GET    /departments/:departmentId/chart
  POST   /departments                                     create (team lead+)
  PUT    /departments/:id                                 edit (team lead+)

  GET    /questionAnswers/department/:departmentId/questions
  GET    /questionAnswers/studio/:studioId/questions      resolves the department for you
  POST   /questionAnswers/question                        create, body includes questionData
  PUT    /questionAnswers/question/:questionId
  DELETE /questionAnswers/question/:questionId            toggle isDeleted (NEW)
  POST   /questionAnswers/question/:questionId/options    add options to an existing
                                                          radio/checkbox question (NEW)
  PUT    /questionAnswers/question/options/:questionOptionId
  DELETE /questionAnswers/question/options/:questionOptionId  toggle isDeleted (NEW)
  PUT    /questionAnswers/question/text/:questionTextId
  PUT    /questionAnswers/question/date/:questionDateId
  PUT    /questionAnswers/question/quantity/:questionQuantityId
  PUT    /questionAnswers/question/dimensions/:questionDimensionsId

FIXED - safe to design against now
- DELETE /questionAnswers/question/:questionId exists. Soft delete, toggle, answers preserved.
- POST /questionAnswers/question/:questionId/options exists. Append options to a live radio or
  checkbox question. Omit position and it goes to the end of the list. Returns the question's
  full live option list, not just what you added. 400 if the question is deleted or is not a
  radio/checkbox.
- DELETE /questionAnswers/question/options/:questionOptionId exists. Soft delete, toggle.
- questions.isDeleted and question_options.isDeleted are now on the API responses, so the editor
  can show retired items in a collapsed "retired" section with a restore action if you want one.

BE work still needed
- workCapacityBase is still editable on the question but is no longer read by the capacity
  calculation - the weight comes from the linked asset type. Either hide it in the UI or let
  us drop the column.
- Question type cannot be changed after create, and there is no endpoint to create the per-type
  detail row separately, so a question created with the wrong type is stranded. Workaround for
  now: delete it and create a new one, which is a real option since delete exists.
- No endpoint to reorder questions in bulk. Position is editable one question at a time, so a
  drag-to-reorder UI would fire N requests. Say the word and we will add a bulk position endpoint.
- No endpoint to manage department leaders. The department_leaders table exists and is
  completely unused by the codebase - decide whether we build it or drop it.
- review_details has no write endpoints at all.


================================================================================
8 of 8 - ASSET TYPES AND SIZE MULTIPLIERS
================================================================================

ADMIN PAGE: ASSET TYPES AND SIZE MULTIPLIERS

What it is
The rate card. Asset types carry the two numbers that everything else derives from:
capacityWeight (how much work one unit is) and defaultCreditWeight (what one billed hour costs
when a client has no rate row of its own). Size multipliers are a separate, simpler scaling list.

Asset type fields that need to be editable
  name                   required, unique
  capacityWeight         decimal, required on create. Drives DERIVED CAPACITY
  defaultCreditWeight    decimal. Drives BILLING when the entity has no override row
  assetType              quantity / boolean_addition / boolean_multiplier / capacity_rate
  departmentId           binds this asset type as a department's rate card. Nullable, at most
                         one asset type per department. Send null to unbind. See rules

Toggles
  isArchived   PATCH /assetTypes/:id/archive
  isDeleted    DELETE /assetTypes/:id

Size multiplier fields
  name         required, unique
  multiplier   decimal, min 0
  isDeleted    DELETE /sizeMultiplier/:sizeMultiplierId

How it works / rules
- capacityWeight is read by the subtask capacity calculation, per answered quantity, and by
  multiplier questions. A weight of 0 on a multiplier's asset type means the multiplier is
  ignored and a warning is logged - it does NOT zero the subtask. Deliberate.
- defaultCreditWeight is the fallback rate. Resolution order for what a client pays:
  the entity's asset_entity.creditWeight if a live row exists, otherwise this default,
  otherwise nothing bills.
- An asset type with a departmentId is a "department rate type" and behaves differently:
  it is limited to one live rate row per entity, it is excluded from the entity edit screen's
  asset reconciliation, it is hidden from GET /assetTypes (the task asset picker), and it is
  reached by derivation (subtask -> studio -> department) rather than being picked by anyone.
- Setting departmentId is validated before the write, so you get a readable 400 rather than a
  database constraint error:
    * "Department 99 not found" if the department does not exist;
    * 'Department Rendering is already the rate card for asset type 7 "Render hour". Unbind that
      one first.' if something already holds it.
  The conflict check deliberately includes deleted and archived asset types, because the unique
  index does too - the message says "(deleted)" or "(archived)" so an admin knows why a slot
  looks free but is not. Unbind the old one (send departmentId: null) then bind the new one.
- Omitting departmentId leaves an existing binding alone. Sending null clears it. The two are
  different, so the FE must not send null for "unchanged".
- Creating an asset type with an entityId in the body also creates that entity's rate row in
  the same transaction.
- Size multipliers attach to entities (multiplier_entities) and to individual tasks
  (multiplier_tasks). Changing a multiplier's value affects everything referencing it.
- Editing these numbers changes what clients are billed and how much capacity studios carry.
  This page should have confirmation on save, and ideally show what references each row.

Tables touched
  asset_types                    the rate card
  asset_entity                   per-entity overrides of creditWeight
  task_asset                     per-task quantities, the budget subtasks draw from
  questions                      quantity and multiplier questions link here
  departments                    one-to-one via departmentId
  size_multiplier                the multiplier list
  multiplier_entities            bridge, multiplier <-> entity
  multiplier_task                bridge, multiplier <-> task
  asset_multiplier_info_at_reset monthly snapshot, read-only

Endpoints
  GET    /assetTypes                       list
  POST   /assetTypes                       create (team lead+), optional entityId
  PUT    /assetTypes/:id                   edit (team lead+)
  PATCH  /assetTypes/:id/archive           toggle isArchived
  DELETE /assetTypes/:id                   toggle isDeleted

  GET    /sizeMultiplier                   list
  POST   /sizeMultiplier                   create
  PUT    /sizeMultiplier/:sizeMultiplierId edit
  DELETE /sizeMultiplier/:sizeMultiplierId toggle isDeleted

FIXED - safe to design against now
- departmentId is now settable on both POST /assetTypes and PUT /assetTypes/:id, with the
  validation described above. An admin can wire up a new department's billing from the UI
  without a DB change.

BE work still needed
- No usage/impact endpoint. Before someone edits a capacityWeight there is no way to show
  "this is used by N questions across M departments". Worth adding if the page should be safe.
- Size multiplier create and edit are open to any internal user (checkJwtInternal) while asset
  types require team lead. Inconsistent - tell us which is right.
