-- "Spec → QA" v3 (CTD-186): the build step starts from what its session holds.
-- forge-run.sh resumes one session across a job's steps, so build begins with
-- everything spec read — the runner, the files each criterion touches, the base
-- state. Job 918fa9d9's build step still spent its first 3½ minutes reading them
-- again: forge-test Step 1 says "find the runner before writing a line", and
-- nothing said it already had. The skill stays right for a cold session; the
-- blueprint is what knows the session is warm, so the clause lives here. v2
-- stays in the history: Restore v2 in the blueprint editor brings it back as a
-- new version.
--
-- Only a seed nobody has saved is improved (0008's rule): a `user` revision on
-- the row, or a hand-made namesake that kept 0013 from seeding it, leaves it
-- theirs and this changes nothing. `version = 2` makes a rerun a no-op.
UPDATE "foundry"."blueprints" b
   SET "steps" = $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; the runner, the files each criterion touches and the base state are already in this session from the spec step — start from them and read only what is new; once the tests are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb,
       "version" = b."version" + 1
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000003'::uuid
   AND b."version" = 2
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user');--> statement-breakpoint
-- Its v3 revision, marked `seed` so a later migration may still improve it, and
-- selected from the row so nothing is written when the update above was skipped.
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'CTD-186: the build step starts from what its session already holds.'
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000003'::uuid
   AND b."version" = 3
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user')
ON CONFLICT DO NOTHING;
