-- "Spec → QA" v2 (CTD-179): three steps instead of five. The plan step goes, and
-- forge-test and forge-implement run back to back as one "build" step on one
-- model, so the red list is the same session's own message; spec and verify are
-- unchanged. forge-implement is read by its file path rather than a second slash
-- command, because only the leading `/skill` of a headless prompt is sure to
-- expand. v1, the five-step shape, stays in the history: Restore v1 in the
-- blueprint editor brings it back as a new version.
--
-- Only a seed nobody has saved is improved (0008's rule): a `user` revision on
-- the row, or a hand-made namesake that kept 0013 from seeding it, leaves it
-- theirs and this changes nothing. `version = 1` makes a rerun a no-op.
UPDATE "foundry"."blueprints" b
   SET "description" = 'Spec the ticket, write its tests red and implement them to green in one step, then verify and report — the QA default for a ticket with acceptance criteria.',
       "steps" = $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; once they are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb,
       "version" = b."version" + 1
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000003'::uuid
   AND b."version" = 1
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user');--> statement-breakpoint
-- Its v2 revision, marked `seed` so a later migration may still improve it, and
-- selected from the row so nothing is written when the update above was skipped.
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'CTD-179: the plan step dropped; test and implement run as one step.'
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000003'::uuid
   AND b."version" = 2
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user')
ON CONFLICT DO NOTHING;
