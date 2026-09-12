# Plan: forge-api, the API and interface lens (CTD-174, slice 3 of CTD-65)

Ticket: CTD-174. Replaces the finished slice-2 plan (in git history at `b145b13`).

## Overview

A lens is a checklist a role applies, not a step a blueprint runs. `forge-api` holds the
contract rules from agent-skills' `api-and-interface-design` — contract first, addition over
modification, one error shape, validation at the boundary, the list/filter/patch shapes, the
TypeScript shapes — rewritten as checks against a diff. `forge-plan` reads it before slicing
when a criterion changes a contract; `forge-verify` applies it as a sixth axis when the diff
touches one; `forge-spec` adds the standing criterion (the published contract stays
backward compatible, or the consumer that changes is named). Nothing runs when no contract
is touched, so a frontend-only ticket costs nothing.

## Architecture decisions

- **Chosen from the diff, not the blueprint.** The ticket's open question; a per-repo
  blueprint is what it is avoiding. "Touches a contract" is defined once, in the lens, and
  the two roles repeat the same test.
- **The lens is read as a file, never invoked.** `~/.claude/skills/forge-api/SKILL.md` is
  what plan and verify open; a lens has no `/forge-api` step and no Handoff files of its own.
  This is the one place a skill names another, and it is a checklist, not a chain.
- **Consumers come from the repo notes.** A backend checkout cannot see who generates a
  client from its document. The lens says where to look (notes, then the ticket) and what to
  write when nobody is named.
- **Guard test learns the two shapes.** A role has `## Step N:` headings between Handoff and
  Finish; a lens has none and is named by at least one role. Same frame otherwise.

## Task list

- T1: `forge-api` skill (lens shape).
- T2: `forge-plan` Step 1 line; `forge-verify` sixth axis + report line; `forge-spec`
  standing criterion.
- T3: guard test: role/lens distinction; README paragraph.
- T4: repo notes for alden-connect-portal-be and alden-portal-fe (the cross-repo path);
  `foundry build`; prove AC1 (backend ticket, request schema) and AC2 (ALD-45, no contract).

## Risks

| Risk | Mitigation |
|---|---|
| The lens fires on every backend diff | "Touches a contract" is a list of concrete things; a handler body change alone is not one |
| A consumer the checkout cannot see | Repo notes name it; absent notes, the Assumption says "consumer not named" rather than "none" |
| Verify's sixth axis becomes a second review | It is one row when applied, with the additive verdict; findings only where a rule is broken |
