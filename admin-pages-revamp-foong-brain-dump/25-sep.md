ADMIN PAGE REVAMP - BE WORK NEEDED, STATUS UPDATE
Follow-up to the 8 admin page write-ups. Every "BE work needed" pointer is answered below, per
page, plus a few issues found while checking them. Each block is standalone, copy it into Slack
on its own.

Status labels
  FIXED          done on branch fix/sep25, NOT deployed yet - design against it, but until it
                 lands the old behaviour still applies
  PLANNED        agreed, not built yet. Where it matters, the workaround until then is given
  NOT DOING      decided against, with the reason
  NO BE WORK     works today, FE-side guidance only
  NEEDS DECISION BE is waiting on an answer
  NOT SCHEDULED  valid, but not in the current round
  CORRECTION     the earlier write-up was wrong


================================================================================
SUMMARY - PERMISSION CHANGES (affects several pages)
================================================================================

FIXED - these guards changed. Any FE screen that calls them as a lower-level user will now get
a 401 or 403.

  POST /auth/createUser               was: NO AUTH AT ALL     now: admin+
  POST /auth/createMultipleUsers      was: NO AUTH AT ALL     now: admin+
    and only an owner / systems admin can create an owner or systems admin
  PUT  /users/:userId                 was: any internal       now: see Users block
  PUT  /users/:userId/firstTimeLogin  was: any internal,      now: the logged-in user only
                                      any userId
  DELETE /users/:userId               was: any internal       now: admin+
  POST/PUT/DELETE user role routes    was: any internal       now: admin+
  Question + option write routes (10) was: any internal       now: team lead+

Please check: if studio leads create client users or assign client roles from the FE today,
tell us and we will drop those two to studio lead+. The owner-level rule stays either way.


================================================================================
1 of 8 - CLIENTS
================================================================================

BE WORK NEEDED - STATUS

Fields cannot be cleared
  PLANNED. PUT /clients/:id will accept null to clear the optional fields (logoUrl,
  emailDomain, companyWebsite, industry, cityId). name and code stay required and cannot be
  cleared. Until then, sending "" or null leaves the old value in place.

No endpoint to edit a client member's isPrimary
  PLANNED. A dedicated endpoint to change isPrimary on an existing member. Until then: remove
  the member and add them again with the new isPrimary.

NEW - PUT /clients/:id resets projectHealthId to 1 when it is omitted
  PLANNED. Same bug as projects. It is on the edit, not only the toggles. Until the fix lands,
  FE must always send the current projectHealthId on PUT /clients/:id.


================================================================================
2 of 8 - ENTITIES
================================================================================

BE WORK NEEDED - STATUS

monthlyRetainer writes to invoice_fields.amount
  NOT DOING for now. It stays on the entity edit payload. FE should label it as the monthly
  retainer / invoice amount and know it is stored on invoice_fields, not entities.

assetTypes[] is a full replace
  NO BE WORK. Recommendation: use the per-row asset_entity endpoints
  (POST /entity/:id/asset/:assetTypeId, PUT and DELETE /entity/:id/assets/:assetEntityId) and
  do not send assetTypes[] on PUT /entity/:id at all. If FE does send it, it must be the
  complete current list, every time.

Fields cannot be cleared (legalName, code etc)
  PLANNED. legalName becomes clearable with null. name and code stay required.

NEW - PUT /entity/:id resets projectHealthId to 1 when it is omitted
  PLANNED. Until the fix lands, FE must always send the current projectHealthId.

NEW - entity notes cannot be un-flagged
  PLANNED. PUT /entity/notes/:id ignores isClientNote: false and isStarred: false, so once set
  they stick. Use PUT /entity/notes/:id/starToggle for the star. There is no workaround for
  isClientNote until the fix lands.


================================================================================
3 of 8 - STUDIOS
================================================================================

BE WORK NEEDED - STATUS

No endpoint to remove or deactivate a studio leader
  PLANNED. One question for product first: when someone stops being a leader, should their
  userType drop back to internal? Today it does not, which is how userType and the leader rows
  drift apart.

studio_restrictions has no API
  NOT DOING. Restrictions are managed directly in the DB for now. No admin UI needed.

colorId editable but not settable on create
  PLANNED. Small change, colorId becomes optional on POST /studios.


================================================================================
4 of 8 - TEAMS (AND GROUPS)
================================================================================

BE WORK NEEDED - STATUS

No endpoint to remove or demote a team leader
  PLANNED, together with the studio leader one. Same userType question applies.

isGroup not editable after create
  NOT DOING. Teams and groups will not be converted. The rule stays: a user can be in one
  team and any number of groups. Groups are not used in the app yet, they are for a future
  phase, so the Groups tab can be left out of this revamp.

Any internal user can create, edit and delete teams
  NEEDS DECISION. Our suggestion is team lead+. It is a one-line change once agreed.


================================================================================
5 of 8 - USERS
================================================================================

BE WORK NEEDED - STATUS

colorId not in the edit payload
  PLANNED. colorId will be added to PUT /users/:userId.

Any internal user can edit any user, including promoting them to owner
  FIXED. PUT /users/:userId now works like this:
    * any internal user can edit their OWN firstName, lastName, cityId and language
    * editing anyone else, or changing userType, status or workCapacity, needs admin+
    * granting owner or systems admin, or editing someone who already holds one of those
      levels, needs owner / systems admin
  Wrong level returns 403. The admin page should only offer these controls to admins.

No endpoint to deactivate the Auth0 account
  NOT DOING. Account status is managed in Auth0 directly. Note that the status field in the
  portal does not lock or unlock login - Auth0 does that.

NEW - FIXED - first-login form could set another user's password
  PUT /users/:userId/firstTimeLogin now only works for the logged-in user's own id (403
  otherwise). The onboarding form must send the current user's id, which it should already.

NEW - FIXED - user creation had no auth
  POST /auth/createUser and /auth/createMultipleUsers now need admin+, and only owner /
  systems admin can create owner or systems admin users.

NEW - FIXED - delete and role routes locked down
  DELETE /users/:userId and add / edit / remove role are now admin+.

NEW - editing a user with no city fails
  PLANNED. PUT /users/:userId writes cityId 0 when the user has no city, which the DB rejects.
  Until the fix lands, send a cityId when editing such a user.

OPEN - PUT /users/:userId/workCapacity is still any internal
  Left alone on purpose in case team leads use it. Tell us if it should be locked down.


================================================================================
6 of 8 - PROJECTS
================================================================================

BE WORK NEEDED - STATUS

PUT /projects/:projectId resets projectHealthId to 1 when omitted
  PLANNED, being fixed in BE together with clients and entities, so FE does not need to design
  around it long-term. Until the fix is deployed, always send the current projectHealthId.

miroBoardUrlInternal and heavyDate cannot be cleared
  PLANNED. Both will accept null to clear.

No create-project-note endpoint
  PLANNED. Create, plus edit and delete if the page needs them - tell us which.


================================================================================
7 of 8 - DEPARTMENTS AND THE QUESTIONNAIRE
================================================================================

BE WORK NEEDED - STATUS

"workCapacityBase is no longer read - hide it or drop the column"
  CORRECTION, that pointer was wrong. workCapacityBase IS read: it is the factor for
  radio/checkbox multiplier questions. Do not drop it.
    * Show it only on radio/checkbox questions with isMultiplier set, labelled as the factor.
    * Hide it on every other question type, where it is ignored.
    * Warn when it is left at 1 (does nothing) or set to 0 or less (ignored).
  Also ignore these two lines in the earlier write-ups, they describe the old behaviour:
    * "A ticked multiplier contributes its asset type's capacityWeight" (write-up 7)
    * "capacityWeight is read ... by multiplier questions" (write-up 8)
  The correct rule is in the RESOLVED multiplier section: assetType.capacityWeight prices
  answered quantities, workCapacityBase is the multiplier factor.

Question type cannot be changed after create
  NO BE WORK. If a question is created with the wrong type, delete it and create a new one -
  delete now exists. The editor should say "type cannot be changed later" at create time.

No bulk reorder endpoint
  PLANNED. One endpoint that takes the full list of { id, position } and saves them together,
  so drag-to-reorder is one request.

department_leaders is unused
  NOT DOING for now. The table is kept, no endpoints. No UI needed.

review_details has no write endpoints
  NOT SCHEDULED. Read-only in this revamp.

NEW - FIXED - question editing permission
  Creating, editing and deleting questions and options now needs team lead+, the same as
  departments. Answering questions is unchanged.


================================================================================
8 of 8 - ASSET TYPES AND SIZE MULTIPLIERS
================================================================================

BE WORK NEEDED - STATUS

No usage / impact endpoint
  NOT SCHEDULED. Until it exists, the page should rely on a clear confirm on save for
  capacityWeight and defaultCreditWeight.

Size multiplier writes are any internal, asset types are team lead+
  NEEDS DECISION. Our suggestion is team lead+ for size multipliers too.

CORRECTION
  "capacityWeight is read ... by multiplier questions" and "a weight of 0 on a multiplier's
  asset type means the multiplier is ignored" are out of date. Multiplier questions have no
  asset type. capacityWeight only prices answered quantity questions. See write-up 7.


================================================================================
DECISIONS WE STILL NEED
================================================================================

1. Removing a studio or team leader: should their userType drop back to internal?
2. Teams create / edit / delete: team lead+?
3. Size multiplier create / edit / delete: team lead+?
4. User creation and role assignment: stay admin+, or studio lead+?
5. PUT /users/:userId/workCapacity: keep open to any internal, or lock down?
6. Project notes: create only, or create + edit + delete?
