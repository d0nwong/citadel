-- Seeds "Fix failing check" (CTD-170): the one step the PR watcher's check
-- follow-up runs. No spec step -- the task *is* the failing steps' log, which
-- forge-debug on its own treats as the reproduction to triage: make it fail
-- locally, localise, fix the cause, guard, commit. Fixed id (CHECK_BLUEPRINT_ID
-- in features/blueprints/types.ts) so the watcher finds it, and editable like
-- any blueprint -- the model and effort are a starting point. A follow-up
-- queued after the row is deleted runs CHECK_BLUEPRINT_STEPS, the same list.
--
-- ON CONFLICT with no target covers both unique constraints: the id on a rerun,
-- and the name where someone hand-made a "Fix failing check" first -- theirs stays.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000006'::uuid, 'Fix failing check', 'Triage a failed CI check from its log — reproduce, find the root cause, fix, guard — on the PR branch. What the PR watcher runs when a check goes red.',
     $steps$[{"name":"debug","model":"fable","effort":"high","prompt":"/forge-debug {{task}}"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed`, selected from the row so the two can never
-- disagree and nothing is inserted when the row above was skipped (0013's shape).
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-170.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000006'::uuid
ON CONFLICT DO NOTHING;
