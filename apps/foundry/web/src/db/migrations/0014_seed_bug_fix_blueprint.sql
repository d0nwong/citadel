-- Seeds "Bug → Fix" (CTD-173): the bug-shaped sibling of "Spec → QA". Same five
-- slots, two differ: spec runs in bug mode (the reproduction is C1, and a ticket
-- with no reproduction and no failing check stops the run), and forge-debug
-- replaces forge-plan -- reproduce, localise, reduce, then write the plan with
-- the root cause first. Test, implement and verify are the QA blueprint's own
-- steps: the reproduction test goes red, the fix makes it green, the PR body
-- opens with the root cause. Fixed id (BUG_BLUEPRINT_ID in
-- features/blueprints/types.ts), for the same reasons as 0013.
--
-- ON CONFLICT with no target covers both unique constraints: the id on a rerun,
-- and the name where someone hand-made a "Bug → Fix" first -- theirs stays.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000004'::uuid, 'Bug → Fix', 'Reproduce the bug as a failing test, find the root cause, fix it, guard against it — for a ticket with reproduction steps or a failing check.',
     $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec bug: {{task}}"},{"name":"debug","model":"fable","effort":"high","prompt":"/forge-debug the failure in ~/spec.md"},{"name":"test","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md"},{"name":"implement","model":"sonnet","prompt":"/forge-implement the plan at ~/plan.md"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed`, selected from the row so the two can never
-- disagree and nothing is inserted when the row above was skipped (0013's shape).
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-173.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000004'::uuid
ON CONFLICT DO NOTHING;
