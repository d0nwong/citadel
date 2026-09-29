ADMIN PAGE REVAMP - BE STATUS UPDATE #2
Follow-up to the previous status update. Covers what changed after the decisions came back,
what is now fixed, and what is still to come. Each block is standalone.

Status labels
FIXED            done on branch feat/missing-admin-routes, NOT merged or deployed yet - design
                 against it, but until it lands the old behaviour still applies
FIXED (EARLIER)  done on fix/sep25, as reported in the last update
DEFERRED         valid, but moved out of this round. Workaround still applies
ON HOLD          BE to circle back
NOT DOING        decided against, or no longer needed
NO BE WORK       works today, FE-side guidance only

================================================================================
SUMMARY - PERMISSIONS (affects several pages)

"admin+" in the last update now means STUDIO LEAD+. Every admin-level edit is studio lead
and above for now.

FIXED - these routes are now studio lead+:
  POST   /auth/createUser                            (was admin+)
  POST   /auth/createMultipleUsers                   (was admin+)
  PUT    /users/:userId  - editing others, userType, status, workCapacity   (was admin+)
  PUT    /users/:userId/workCapacity                 (was any internal)
  DELETE /users/:userId                              (was admin+)
  POST/PUT/DELETE user role routes                   (was admin+)
  POST/PUT/DELETE /teams                             (was any internal)
  POST/PUT/DELETE /sizeMultiplier                    (was any internal)

FIXED - new rule on user management: nobody can hand out or manage a level above their own.
  _ a studio lead cannot grant admin, or edit / delete an admin
  _ only owner / systems admin can grant owner or systems admin, or edit / delete someone
    who holds one (unchanged from last time)
  Wrong level returns 403. The FE should hide levels the logged-in user cannot grant.

Unchanged:
  PUT /users/:userId/firstTimeLogin - logged-in user only (FIXED EARLIER)
  Question + option write routes - team lead+ (FIXED EARLIER)
  Adding / removing team members and team leads - still any internal, not in scope

================================================================================
1 of 8 - CLIENTS

Fields cannot be cleared
FIXED. PUT /clients/:id accepts null to clear logoUrl, emailDomain, companyWebsite, industry,
cityId. Omitting a field keeps its current value. name and code stay required.
Note: clearing emailDomain marks the client as not valid, the same as before.

No endpoint to edit a client member's isPrimary
DEFERRED. Workaround: remove the member and add them again with the new isPrimary.

PUT /clients/:id resets projectHealthId to 1 when omitted
DEFERRED. FE must always send the current projectHealthId on PUT /clients/:id.

================================================================================
2 of 8 - ENTITIES

Fields cannot be cleared
FIXED. PUT /entity/:id accepts legalName: null to clear it. name and code stay required.

Entity notes cannot be un-flagged
FIXED. PUT /entity/notes/:id now accepts isClientNote: false and isStarred: false.
Omitting either keeps its current value. starToggle still works for the star.

monthlyRetainer writes to invoice_fields.amount
DEFERRED. Stays on the entity edit payload. Label it as the monthly retainer / invoice amount.

PUT /entity/:id resets projectHealthId to 1 when omitted
DEFERRED. FE must always send the current projectHealthId.

assetTypes[] is a full replace
NO BE WORK. Use the per-row asset_entity endpoints and do not send assetTypes[] on
PUT /entity/:id. If you do send it, it must be the complete list every time.

================================================================================
3 of 8 - STUDIOS

No endpoint to remove or deactivate a studio leader
FIXED. DELETE /studios/:studioId/remove/studioHead/:userId (studio lead+).
  _ the user's userType drops to the highest leader level they still hold (e.g. team lead if
    they still lead a team), or back to internal if they lead nothing else
  _ admin / owner / systems admin keep their userType
  _ response: { studioId, userId, userType } - userType is the user's new level
  _ 404 if the user is not an active leader of that studio

colorId not settable on create
NOT DOING. Not needed for this revamp.

studio_restrictions has no API
NOT DOING. Managed in the DB. No admin UI needed.

================================================================================
4 of 8 - TEAMS (AND GROUPS)

Any internal user can create, edit and delete teams
FIXED. Now studio lead+.

No endpoint to remove or demote a team leader
FIXED. DELETE /teams/:teamId/remove/teamLead/:userId (studio lead+).
  _ they stay on the team as a regular member
  _ same userType rule as studio leaders
  _ response: { teamId, userId, userType }
  _ 404 if the user is not an active leader of that team

isGroup not editable after create
NOT DOING. Groups are future work. Leave the Groups tab out of this revamp.

================================================================================
5 of 8 - USERS

Who can edit / create / delete users
FIXED. Studio lead+ (was admin+), with the "no level above your own" rule:
  _ any internal user can edit their OWN firstName, lastName, cityId, language
  _ editing anyone else, or changing userType / status / workCapacity, needs studio lead+
  _ granting admin, or editing / deleting an admin, needs admin+
  _ granting owner / systems admin, or editing / deleting one, needs owner / systems admin

PUT /users/:userId/workCapacity
FIXED. Locked down to studio lead+ (was any internal).

User creation and role assignment
FIXED. Studio lead+. The create rules follow the same "no level above your own" rule.

Editing a user with no city fails
ON HOLD. Until fixed, send a cityId when editing a user with no city.

colorId not in the edit payload
NOT DOING. Not needed for this revamp.

No endpoint to deactivate the Auth0 account
NOT DOING. Managed in Auth0. The portal status field does not lock or unlock login.

First-login form could set another user's password
FIXED EARLIER. Logged-in user only.

================================================================================
6 of 8 - PROJECTS

miroBoardUrlInternal and heavyDate cannot be cleared
FIXED. PUT /projects/:projectId accepts null for both to clear them. Omitting keeps the value.

PUT /projects/:projectId resets projectHealthId to 1 when omitted
DEFERRED. Until fixed, always send the current projectHealthId.

Project notes
NOT DOING. Project notes are no longer part of the app. Remove them from the page.

================================================================================
7 of 8 - DEPARTMENTS AND THE QUESTIONNAIRE

No bulk reorder endpoint
FIXED. PUT /questionAnswers/question/reorder (team lead+)
  body: { "questions": [ { "id": 12, "position": 0 }, { "id": 15, "position": 1 }, ... ] }
  _ send every question in the list with its new position
  _ all positions save together - if any id is missing or deleted, nothing is saved (404)
  _ the same id twice is rejected (400)
  _ response: each question's id, position and departmentId

workCapacityBase
NO BE WORK (correction from last time stands). Show it only on radio/checkbox questions with
isMultiplier set, labelled as the factor. Hide it everywhere else. Warn at 1 or <= 0.

Question type cannot be changed after create
NO BE WORK. Delete and recreate. The editor should say "type cannot be changed later".

Question editing permission
FIXED EARLIER. Team lead+.

department_leaders / review_details
NOT DOING in this revamp. No UI for department_leaders. review_details is read-only.

================================================================================
8 of 8 - ASSET TYPES AND SIZE MULTIPLIERS

Size multiplier writes were any internal
FIXED. Create / edit / delete are now studio lead+.

No usage / impact endpoint
NOT DOING. Use a clear confirm on save for capacityWeight and defaultCreditWeight.

capacityWeight
NO BE WORK (correction from last time stands). It only prices answered quantity questions.
Multiplier questions have no asset type.

================================================================================
DECISIONS - ALL ANSWERED

1. Removing a studio / team leader drops userType     -> Yes (FIXED, see Studios / Teams)
2. Teams create / edit / delete                        -> Studio lead+ (FIXED)
3. Size multiplier create / edit / delete              -> Studio lead+ (FIXED)
4. User creation and role assignment                   -> Studio lead+ (FIXED)
5. PUT /users/:userId/workCapacity                     -> Locked down to studio lead+ (FIXED)
6. Project notes                                       -> Dropped (NOT DOING)

Everything agreed for this round is built. Still outstanding: the DEFERRED items
(projectHealthId reset, client member isPrimary, monthlyRetainer) and the ON HOLD
no-city user edit bug.