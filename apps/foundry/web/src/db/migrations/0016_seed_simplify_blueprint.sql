-- Seeds "Simplify" (CTD-175): the refactor-shaped sibling of "Spec → QA". Three
-- steps: spec in refactor mode (the unchanged suite is C1 and each simplification
-- the ticket names is a criterion; a ticket naming no file and nothing to remove
-- stops the run), forge-simplify (understand why each piece exists, then remove
-- what the ticket names one change at a time with the suite as the oracle, never
-- touching a test), and the same verify step as the other two, reading the diff
-- for what the reader no longer has to hold. Fixed id (SIMPLIFY_BLUEPRINT_ID in
-- features/blueprints/types.ts), for the same reasons as 0013.
--
-- ON CONFLICT with no target covers both unique constraints: the id on a rerun,
-- and the name where someone hand-made a "Simplify" first -- theirs stays.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000005'::uuid, 'Simplify', 'Remove the complexity a refactor ticket names, one change at a time, with the existing suite as the oracle and behaviour unchanged — for a ticket naming files and what to take out of them.',
     $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec refactor: {{task}}"},{"name":"simplify","model":"sonnet","prompt":"/forge-simplify the criteria in ~/spec.md"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed`, selected from the row so the two can never
-- disagree and nothing is inserted when the row above was skipped (0013's shape).
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-175.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000005'::uuid
ON CONFLICT DO NOTHING;
