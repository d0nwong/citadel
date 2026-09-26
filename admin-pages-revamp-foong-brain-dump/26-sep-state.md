# Admin revamp: FE tickets and their BE blockers (26 Sep)

None of these blockers is on BE `dev` @ `480779bf` yet. `U` = [`Updated.md`](Updated.md), `S` = [`25-sep.md`](25-sep.md), followed by line numbers; each reference links to those lines.

## AP-278 [FE] Clients admin
- **Optional fields can't be cleared.** [S 44–47](25-sep.md#L44-L47) (PLANNED): "PUT /clients/:id will accept null to clear the optional fields". Also [U 104–106](Updated.md#L104-L106).
- **No endpoint to change a member's isPrimary.** [S 49–51](25-sep.md#L49-L51) (PLANNED). Also [U 107](Updated.md#L107).
- **Edit resets project health.** [S 53–55](25-sep.md#L53-L55) (PLANNED): "FE must always send the current projectHealthId on PUT /clients/:id".

## AP-285 [FE] Admin Entities
- **legalName can't be cleared.** [S 74–75](25-sep.md#L74-L75) (PLANNED). Also [U 230](Updated.md#L230).
- **Edit resets project health.** [S 77–78](25-sep.md#L77-L78) (PLANNED).
- **Notes can't be un-flagged.** [S 80–83](25-sep.md#L80-L83) (PLANNED): "There is no workaround for isClientNote until the fix lands".

## AP-279 [FE] Studio page
- **No endpoint to remove a studio leader.** [S 92–95](25-sep.md#L92-L95) (PLANNED, waits on decision 1). Also [U 304–305](Updated.md#L304-L305).
- **Colour can't be set on create.** [S 100–101](25-sep.md#L100-L101) (PLANNED). Also [U 308](Updated.md#L308).

## AP-280 [FE] Team and group pages
- **No endpoint to remove a team leader.** [S 110–111](25-sep.md#L110-L111) (PLANNED, waits on decision 1). Also [U 382](Updated.md#L382).
- **Any internal user can create, edit and delete teams.** [S 118–119](25-sep.md#L118-L119) (NEEDS DECISION, decision 2). Also [U 385–386](Updated.md#L385-L386).

## AP-283 [FE] Users admin
- **colorId isn't in the edit payload.** [S 128–129](25-sep.md#L128-L129) (PLANNED). Also [U 468–469](Updated.md#L468-L469).
- **Editing a user with no city fails.** [S 154–156](25-sep.md#L154-L156) (PLANNED): "writes cityId 0 … which the DB rejects".
- **workCapacity is open to any internal user.** [S 158–159](25-sep.md#L158-L159) (OPEN, decision 5).

## AP-281 [FE] Project About tab editor
- **Edit resets project health.** [S 168–170](25-sep.md#L168-L170) (PLANNED). Also [U 565–568](Updated.md#L565-L568).
- **miroBoardUrlInternal and heavyDate can't be cleared.** [S 172–173](25-sep.md#L172-L173) (PLANNED). Also [U 569](Updated.md#L569).
- **No create-project-note endpoint.** [S 175–176](25-sep.md#L175-L176) (PLANNED, decision 6). Also [U 570–571](Updated.md#L570-L571).

## AP-282 [FE] Department questionnaire editor
- **No bulk reorder endpoint.** [S 201–203](25-sep.md#L201-L203) (PLANNED). Also [U 728–729](Updated.md#L728-L729).

## AP-284 [FE] Asset types and size multipliers
- **No usage / impact endpoint.** [S 222–224](25-sep.md#L222-L224) (NOT SCHEDULED): "the page should rely on a clear confirm on save". Also [U 822–823](Updated.md#L822-L823).
- **Size multiplier writes are open to any internal user.** [S 226–227](25-sep.md#L226-L227) (NEEDS DECISION, decision 3). Also [U 824–825](Updated.md#L824-L825).

## Decisions still needed ([S 235–244](25-sep.md#L235-L244))
1. When a studio or team leader is removed, does their userType drop back to internal? Blocks AP-279 and AP-280.
2. Teams writes: team lead+? Blocks AP-280.
3. Size multiplier writes: team lead+? Blocks AP-284.
4. User creation and role assignment: admin+ or studio lead+? Blocks AP-283.
5. workCapacity: keep open or lock down? Blocks AP-283.
6. Project notes: create only, or also edit and delete? Blocks AP-281.
