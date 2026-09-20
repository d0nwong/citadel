-- "Plan → Execute" (CTD-285): the default blueprint runs the forge's own
-- skills instead of two inline prose prompts. Those prompts restated in
-- prose what forge-plan and forge-implement already encode — the adversarial
-- re-read of the plan, the slice-by-slice implementation, the refusal to
-- weaken a test — and referenced neither `~/baseline.md` nor the `### Spec:`
-- and `### Arch:` blocks the host carries.
--
-- Both skills now accept a task with no `~/spec.md` (S-57): forge-plan plans
-- from the task text and forge-implement implements that plan with no red
-- tests to start from, each saying in its finish that no approved criteria
-- governed the run rather than writing any. That is what makes this safe:
-- since CTD-283, "Plan → Execute" is the default only for a job with
-- instructions and no ticket — exactly the case with no `~/spec.md` — so
-- pointed at the unpatched skills every such job would have refused here.
--
-- Only a seed nobody has saved is improved (0008's rule): a `user` revision
-- on the row leaves it theirs, and this changes nothing on that host — Liam
-- applies these two steps himself in the blueprint editor. `version = 1`
-- makes a rerun a no-op once it has fired, and a no-op from the start on a
-- row already edited.
UPDATE "foundry"."blueprints" b
   SET "steps" = $steps$[{"name":"plan","model":"fable","effort":"high","prompt":"/forge-plan {{task}}"},{"name":"implement","model":"sonnet","prompt":"/forge-implement the plan at ~/plan.md"}]$steps$::jsonb,
       "version" = b."version" + 1
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000001'::uuid
   AND b."version" = 1
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user');--> statement-breakpoint
-- Its v2 revision, marked `seed` so a later migration may still improve it, and
-- selected from the row so nothing is written when the update above was skipped.
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'CTD-285: runs /forge-plan and /forge-implement instead of two inline prose prompts.'
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000001'::uuid
   AND b."version" = 2
   AND NOT EXISTS (SELECT 1 FROM "foundry"."blueprint_revisions" r WHERE r."blueprint_id" = b."id" AND r."source" = 'user')
ON CONFLICT DO NOTHING;
