-- Seeds "Spec → PR" (CTD-179): the light sibling of "Spec → QA", for a ticket a
-- person could describe in a sentence. Same spec and verify steps; no plan step,
-- and forge-test and forge-implement run back to back as one step on one model,
-- so the red list is the same session's own message. forge-implement is read by
-- its file path rather than a second slash command, because only the leading
-- `/skill` of a headless prompt is sure to expand. Fixed id (SPEC_PR_BLUEPRINT_ID
-- in features/blueprints/types.ts), for the same reasons as 0013; `…0006` went
-- to CTD-170's "Fix failing check".
--
-- ON CONFLICT with no target covers both unique constraints: the id on a rerun,
-- and the name where someone hand-made a "Spec → PR" first -- theirs stays.
INSERT INTO "foundry"."blueprints" ("id", "name", "description", "steps") VALUES
    ('5eeded00-0000-4000-8000-000000000007'::uuid, 'Spec → PR', 'Spec the ticket, write its tests red and implement them to green in one step, verify and report — for a small ticket a person could describe in a sentence.',
     $steps$[{"name":"spec","model":"fable","effort":"high","prompt":"/forge-spec {{task}}"},{"name":"build","model":"sonnet","prompt":"/forge-test for the criteria in ~/spec.md; once they are seen red, implement them to green in this same step per ~/.claude/skills/forge-implement/SKILL.md, and end with both Finishes, the tests' first"},{"name":"verify","model":"opus","effort":"medium","prompt":"/forge-verify the change against ~/spec.md"}]$steps$::jsonb)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Its v1 revision, marked `seed`, selected from the row so the two can never
-- disagree and nothing is inserted when the row above was skipped (0013's shape).
INSERT INTO "foundry"."blueprint_revisions"
  ("blueprint_id", "version", "name", "description", "steps", "source", "note", "created_at")
SELECT b."id", b."version", b."name", b."description", b."steps", 'seed', 'Shipped with CTD-179.', b."created_at"
  FROM "foundry"."blueprints" b
 WHERE b."id" = '5eeded00-0000-4000-8000-000000000007'::uuid
ON CONFLICT DO NOTHING;
